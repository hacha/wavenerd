import { type ChildProcess, spawn } from 'child_process';
import { readFileSync, renameSync, writeFileSync } from 'fs';
import { relative, resolve } from 'path';
import { type ViteDevServer } from 'vite';
import { type LiveChatEntry, type LiveChatSendEvent, type LiveChatSlotEvent, type LiveChatStateEvent, type LiveSlot } from '../src/live/liveProtocol';

/**
 * The chat panels of the decks talk to a coding agent that runs on this machine, with the subscription it is logged
 * in with (Claude Code: `claude -p`), not with an API key. The agent writes the files of `live/` as in a terminal, so
 * the `strudel-live` skill and the hook of `.claude/settings.json` work the same. Dev server only.
 *
 * - One conversation per deck. The chat of deck A edits only `live/A.strudel.js`; it may read the rest (deck B too).
 * - One run per message. The conversation goes on with `--resume`; its id is kept in `live/chat-<slot>.json`.
 * - One run at a time per deck.
 * - Only from localhost: the agent edits files of this machine.
 */

const SLOTS: LiveSlot[] = ['a', 'b'];
const DECK_FILES: Record<LiveSlot, string> = { a: 'live/A.strudel.js', b: 'live/B.strudel.js' };

const MAX_ENTRIES = 200;
const MAX_TOOL_TEXT = 300;

/** The tools the agent can use. Headless runs cannot ask for permission, so the list is what it can do. */
const TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Skill'];

/** Paths are relative to the root of the project. Edits of other files are denied. */
function allowedTools(slot: LiveSlot): string[] {
  return ['Read', 'Glob', 'Grep', 'Skill', `Edit(${DECK_FILES[slot]})`, `Write(${DECK_FILES[slot]})`];
}

function systemPrompt(slot: LiveSlot): string {
  const other: LiveSlot = slot === 'a' ? 'b' : 'a';
  return [
    `You are talking with the performer through the chat panel of deck ${slot.toUpperCase()} of the wavenerd app in the browser, while they play live.`,
    `This chat writes deck ${slot.toUpperCase()} only: edit ${DECK_FILES[slot]} and no other file.`,
    `You may read ${DECK_FILES[other]} (deck ${other.toUpperCase()}) to fit this deck to it, but never edit it.`,
    'Use the strudel-live skill for anything about the decks.',
    'Reply briefly, in the language the performer writes in. The panel shows plain text, not Markdown.',
  ].join(' ');
}

/** Variables that would make the agent use an API key, or think it runs inside another session of Claude Code. */
function agentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ANTHROPIC_API_KEY' || key === 'ANTHROPIC_AUTH_TOKEN') { continue; }
    if (/^CLAUDE/.test(key) && key !== 'CLAUDE_CONFIG_DIR') { continue; }
    env[key] = value;
  }
  return env;
}

/**
 * The command of a run. The prompt goes to stdin, so it is never read as an option.
 * Another agent (e.g. Codex) would be another function like this, plus its own parsing of the output.
 */
function claudeCommand(slot: LiveSlot, sessionId: string | null): { command: string; args: string[] } {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk',
    '--tools', TOOLS.join(','),
    '--allowedTools', allowedTools(slot).join(','),
    '--append-system-prompt', systemPrompt(slot),
  ];
  const model = process.env.WAVENERD_CHAT_MODEL;
  if (model) {
    args.push('--model', model);
  }
  if (sessionId != null) {
    args.push('--resume', sessionId);
  }
  return { command: process.env.WAVENERD_CHAT_CLAUDE ?? 'claude', args };
}

function isLocalHost(host: string | boolean | undefined): boolean {
  return host == null || host === false || ['localhost', '127.0.0.1', '::1'].includes(host as string);
}

/** A line for a tool use, e.g. `Edit live/B.strudel.js`. */
function toolText(root: string, name: string, input: Record<string, unknown>): string {
  const path = input.file_path ?? input.path;
  const target = typeof path === 'string'
    ? relative(root, path) || path
    : input.pattern ?? input.skill ?? input.command ?? '';
  return `${name} ${String(target)}`.trim();
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

interface Saved {
  sessionId: string | null;
  entries: LiveChatEntry[];
}

interface SlotChat {
  send: (text: string) => void;
  cancel: () => void;
  reset: () => void;
  sendState: () => void;
  kill: () => void;
}

export function setupLiveChat(devServer: ViteDevServer, liveDir: string): void {
  const root = devServer.config.root;
  const { hot } = devServer;

  const host = devServer.config.server.host;
  const disabledReason = isLocalHost(host)
    ? null
    : `The dev server listens on ${String(host)}. The chat works only when it listens on localhost.`;

  const createSlotChat = (slot: LiveSlot): SlotChat => {
    const savePath = resolve(liveDir, `chat-${slot}.json`);

    let saved: Saved = { sessionId: null, entries: [] };
    try {
      saved = JSON.parse(readFileSync(savePath, 'utf8')) as Saved;
    } catch {
      // no chat yet
    }
    let nextId = saved.entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;

    let child: ChildProcess | null = null;
    let cancel = () => {};

    const save = () => {
      const temp = `${savePath}.${process.pid}.tmp`;
      try {
        writeFileSync(temp, JSON.stringify(saved, null, 2) + '\n');
        renameSync(temp, savePath);
      } catch (error) {
        console.warn(`[live] failed to write ${savePath}:`, error);
      }
    };

    const sendState = () => {
      const event: LiveChatStateEvent = { slot, disabledReason, busy: child != null, entries: saved.entries };
      hot.send('wavenerd-live:chat', event);
    };

    const add = (role: LiveChatEntry['role'], text: string) => {
      saved.entries.push({ id: nextId++, role, text });
      if (saved.entries.length > MAX_ENTRIES) {
        saved.entries.splice(0, saved.entries.length - MAX_ENTRIES);
      }
      save();
      sendState();
    };

    const run = (prompt: string) => {
      const { command, args } = claudeCommand(slot, saved.sessionId);
      const proc = spawn(command, args, { cwd: root, env: agentEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      child = proc;
      sendState();

      let cancelled = false;
      let gotResult = false;
      let stdout = '';
      let stderr = '';

      cancel = () => {
        cancelled = true;
        proc.kill();
      };

      // a failed spawn emits `error` instead of `close`; writing to its stdin must not throw
      proc.stdin.on('error', () => {});
      proc.stdin.end(prompt);

      const handleEvent = (event: any) => {
        if (event.session_id != null && event.session_id !== saved.sessionId) {
          saved.sessionId = event.session_id;
          save();
        }

        if (event.type === 'system' && event.subtype === 'init') {
          // `none`: logged in with a subscription. otherwise an API key would be billed
          if (event.apiKeySource !== 'none' && process.env.WAVENERD_CHAT_ALLOW_API_KEY !== '1') {
            cancel();
            add('error', `Stopped: the agent was going to use an API key (${event.apiKeySource}), not the subscription. Log in with \`claude /login\`, or set WAVENERD_CHAT_ALLOW_API_KEY=1.`);
          }
        } else if (event.type === 'assistant') {
          for (const block of event.message?.content ?? []) {
            if (block.type === 'text' && block.text.trim() !== '') {
              add('assistant', block.text.trim());
            } else if (block.type === 'tool_use') {
              add('tool', toolText(root, block.name, block.input ?? {}));
            }
          }
        } else if (event.type === 'user') {
          for (const block of event.message?.content ?? []) {
            if (block.type === 'tool_result' && block.is_error) {
              const content = typeof block.content === 'string'
                ? block.content
                : (block.content ?? []).map((part: any) => part.text ?? '').join('\n');
              add('error', truncate(content.trim(), MAX_TOOL_TEXT));
            }
          }
        } else if (event.type === 'result') {
          gotResult = true;
          if (event.is_error || event.subtype !== 'success') {
            add('error', truncate(String(event.result ?? event.subtype), MAX_TOOL_TEXT));
          }
        }
      };

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        const lines = stdout.split('\n');
        stdout = lines.pop()!;
        for (const line of lines) {
          if (line.trim() === '') { continue; }
          try {
            handleEvent(JSON.parse(line));
          } catch {
            // not an event
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });

      let ended = false;
      const end = (failure: string | null) => {
        if (ended) { return; }
        ended = true;
        child = null;
        cancel = () => {};

        if (cancelled) {
          add('info', 'Stopped');
        } else if (failure != null) {
          // the conversation was deleted. start a new one next time
          if (/no conversation found/i.test(failure)) {
            saved.sessionId = null;
            save();
          }
          add('error', truncate(failure, MAX_TOOL_TEXT));
        } else {
          sendState();
        }
      };

      proc.on('error', (error) => end(`Could not run \`${command}\`: ${error.message}`));
      proc.on('close', (code) => {
        const failed = !gotResult && code !== 0;
        end(failed ? stderr.trim() || `\`${command}\` exited with ${code}` : null);
      });
    };

    return {
      sendState,
      send: (text) => {
        if (disabledReason != null || child != null) { return; }

        const prompt = text.trim();
        if (prompt === '') { return; }

        add('user', prompt);
        run(prompt);
      },
      cancel: () => cancel(),
      reset: () => {
        if (child != null) { return; }
        saved = { sessionId: null, entries: [] };
        save();
        sendState();
      },
      kill: () => child?.kill(),
    };
  };

  const chats: Record<LiveSlot, SlotChat> = { a: createSlotChat('a'), b: createSlotChat('b') };

  hot.on('wavenerd-live:chat-hello', () => SLOTS.forEach((slot) => chats[slot].sendState()));
  hot.on('wavenerd-live:chat-send', ({ slot, text }: LiveChatSendEvent) => chats[slot]?.send(text));
  hot.on('wavenerd-live:chat-cancel', ({ slot }: LiveChatSlotEvent) => chats[slot]?.cancel());
  hot.on('wavenerd-live:chat-reset', ({ slot }: LiveChatSlotEvent) => chats[slot]?.reset());

  devServer.httpServer?.on('close', () => SLOTS.forEach((slot) => chats[slot].kill()));
}
