import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'fs';
import { resolve } from 'path';
import { type Plugin, type ViteDevServer } from 'vite';
import { type LiveCompiledEvent, type LivePushEvent, type LiveSlot, type LiveSoundsEvent, type LiveStateEvent } from '../src/live/liveProtocol';

/**
 * Bridges the files of `live/` and the Strudel decks of the app, so a coding agent such as Claude Code can write code
 * for the decks while someone plays. Dev server only.
 *
 * - `live/A.strudel.js`, `live/B.strudel.js`: a change is sent to the deck and cued. Code cued in the app is written back.
 * - `live/status.json`: the state of the app and the result of the last compile of each deck.
 * - `live/sounds.txt`: the sounds that Strudel code can play.
 *
 * Messages are the `wavenerd-live:*` custom events of the HMR channel (`src/live/liveProtocol.ts`).
 */

type Slot = LiveSlot;

const SLOTS: Slot[] = ['a', 'b'];

/** Relative to the root of the project. */
export const LIVE_DIR = 'live';

const FILE_NAMES: Record<Slot, string> = {
  a: 'A.strudel.js',
  b: 'B.strudel.js',
};

interface SlotState {
  /** The content of the file as we last read or wrote it. */
  content: string | null;
  lastCompile: { hash: string; ok: boolean; error: string | null; at: string } | null;

  /** `codeId` → hash of the code. */
  codeHashes: Map<number, string>;

  /**
   * The file might have changed while no app was open.
   * The next app that starts takes it instead of writing its own code back.
   */
  pending: boolean;
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/** Readers poll the file, so it must never be half written. */
function writeAtomically(path: string, text: string): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export function liveBridge(): Plugin {
  let dir = '';
  let server: ViteDevServer | null = null;
  let clients = 0;
  let appState: LiveStateEvent | null = null;
  let session: string | null = null;

  /** `codeId` of the app counts from 1 again after a reload. */
  const updateSession = (next: string) => {
    if (next === session) { return; }
    session = next;
    for (const slot of SLOTS) {
      slots[slot].codeHashes.clear();
    }
  };

  const slots: Record<Slot, SlotState> = {
    a: { content: null, lastCompile: null, codeHashes: new Map(), pending: false },
    b: { content: null, lastCompile: null, codeHashes: new Map(), pending: false },
  };

  const filePath = (slot: Slot) => resolve(dir, FILE_NAMES[slot]);

  const readFile = (slot: Slot): string | null => {
    try {
      return readFileSync(filePath(slot), 'utf8');
    } catch {
      return null;
    }
  };

  const writeStatus = () => {
    const fileState = (slot: Slot) => {
      const { content, lastCompile, codeHashes } = slots[slot];
      if (content == null) { return 'missing'; }

      const hash = sha1(content);
      const deck = appState?.decks[slot];
      // the deck plays it while the transport runs
      if (deck != null && codeHashes.get(deck.activeCodeId) === hash) { return 'applied'; }
      if (lastCompile?.hash !== hash) { return 'not compiled'; }
      if (!lastCompile.ok) { return 'error'; }
      return 'cued';
    };

    const status = {
      connected: clients > 0,

      // `connected` stays true if the server is killed. readers check that this process lives
      serverPid: process.pid,
      updatedAt: new Date().toISOString(),
      transport: appState && {
        playing: appState.playing,
        bpm: appState.bpm,
        xfader: appState.xfader,
      },
      decks: Object.fromEntries(SLOTS.map((slot) => {
        const deck = appState?.decks[slot];
        return [slot, {
          file: `${LIVE_DIR}/${FILE_NAMES[slot]}`,
          fileState: fileState(slot),
          mode: deck?.mode ?? null,
          cueStatus: deck?.cueStatus ?? null,
          error: deck?.error ?? null,
          lastCompile: slots[slot].lastCompile,
        }];
      })),
    };

    writeAtomically(resolve(dir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  };

  const push = (slot: Slot) => {
    const content = readFile(slot);
    if (content == null || content === slots[slot].content) { return; }

    slots[slot].content = content;
    slots[slot].pending = clients === 0;
    sendPush(slot, content);
    writeStatus();
  };

  const sendPush = (slot: Slot, content: string) => {
    const event: LivePushEvent = { slot, code: content, hash: sha1(content) };
    server?.hot.send('wavenerd-live:push', event);
  };

  return {
    name: 'wavenerd-live-bridge',
    apply: 'serve',

    config() {
      // the app talks to the files by itself. a reload in the middle of a set would lose the transport
      return { server: { watch: { ignored: [`**/${LIVE_DIR}/**`] } } };
    },

    configureServer(devServer) {
      server = devServer;
      dir = resolve(devServer.config.root, LIVE_DIR);
      if (!existsSync(dir)) {
        mkdirSync(dir);
      }

      // the files might have been edited while the server was down
      for (const slot of SLOTS) {
        slots[slot].content = readFile(slot);
        slots[slot].pending = slots[slot].content != null;
      }
      writeStatus();

      // macOS reports a change of a file in the directory as `rename` or `change`, sometimes twice
      const timers = new Map<Slot, ReturnType<typeof setTimeout>>();
      const watcher = watch(dir, (_, fileName) => {
        const slot = SLOTS.find((slot) => FILE_NAMES[slot] === fileName);
        if (slot == null) { return; }

        clearTimeout(timers.get(slot));
        timers.set(slot, setTimeout(() => push(slot), 50));
      });
      devServer.httpServer?.on('close', () => {
        watcher.close();
        clients = 0;
        writeStatus();
      });

      const { hot } = devServer;

      hot.on('vite:client:connect', () => {
        clients++;
        writeStatus();
      });

      hot.on('vite:client:disconnect', () => {
        clients = Math.max(0, clients - 1);
        writeStatus();
      });

      hot.on('wavenerd-live:compiled', (event: LiveCompiledEvent) => {
        updateSession(event.session);
        const slotState = slots[event.slot];

        // pushed code is hashed as the file was read. the editor might have changed its line breaks
        const hash = event.hash ?? sha1(event.code);
        if (event.codeId != null) {
          slotState.codeHashes.set(event.codeId, hash);
        }

        if (event.hash == null && slotState.pending) {
          slotState.pending = false;

          // the app has just started with its own code. give it the file instead
          if (slotState.content != null && event.code !== slotState.content) {
            sendPush(event.slot, slotState.content);
            writeStatus();
            return;
          }
        }

        // cued in the app. the file follows the app
        if (event.hash == null && event.code !== slotState.content) {
          slotState.content = event.code;
          writeAtomically(filePath(event.slot), event.code);
        }

        slotState.lastCompile = {
          hash,
          ok: event.error == null,
          error: event.error,
          at: new Date().toISOString(),
        };
        writeStatus();
      });

      hot.on('wavenerd-live:state', (event: LiveStateEvent) => {
        updateSession(event.session);
        appState = event;
        writeStatus();
      });

      hot.on('wavenerd-live:sounds', (event: LiveSoundsEvent) => {
        writeAtomically(resolve(dir, 'sounds.txt'), event.text);
      });
    },
  };
}
