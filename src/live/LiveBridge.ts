import { soundMap } from '@strudel/webaudio';
import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { type Mixer } from '../audio/Mixer';
import { SETTINGSMAN } from '../SettingsManager';
import { type StrudelDeck } from '../strudel/StrudelDeck';
import { EventEmittable } from '../utils/EventEmittable';
import { type LiveCompiledEvent, type LivePushEvent, type LiveSlot, type LiveSoundsEvent, type LiveStateEvent } from './liveProtocol';

export type { LiveSlot };

type ViteHotContext = NonNullable<ImportMeta['hot']>;

export interface LiveBridgeEvents {
  pushA: { code: string; hash: string };
  pushB: { code: string; hash: string };
}

/**
 * The app side of `vite/liveBridge.ts`: the files of `live/` are cued to the Strudel decks,
 * and the code cued in the app goes back to the files.
 */
export class LiveBridge extends EventEmittable<LiveBridgeEvents> {
  private readonly __hot: ViteHotContext;
  private readonly __decks: Record<LiveSlot, StrudelDeck>;
  private readonly __hostDeck: WavenerdDeck;
  private readonly __mixer: Mixer;
  private readonly __errors: Record<LiveSlot, string | null> = { a: null, b: null };
  private __lastState = '';
  private readonly __session = crypto.randomUUID();

  public constructor({ hot, decks, hostDeck, mixer }: {
    hot: ViteHotContext;
    decks: Record<LiveSlot, StrudelDeck>;
    hostDeck: WavenerdDeck;
    mixer: Mixer;
  }) {
    super();

    this.__hot = hot;
    this.__decks = decks;
    this.__hostDeck = hostDeck;
    this.__mixer = mixer;

    hot.on('wavenerd-live:push', ({ slot, code, hash }: LivePushEvent) => {
      this.__emit(slot === 'a' ? 'pushA' : 'pushB', { code, hash });
    });

    for (const slot of ['a', 'b'] as const) {
      decks[slot].on('error', ({ error }) => {
        this.__errors[slot] = error;
        this.__sendState();
      });
      decks[slot].on('changeCueStatus', () => this.__sendState());
    }

    // the transport, the BPM and the crossfader change without events we can use. MIDI moves the crossfader a lot
    setInterval(() => this.__sendState(), 500);

    this.__watchSounds(decks.a);
  }

  /**
   * Tell the result of a compile of a Strudel deck.
   *
   * @param hash The hash of the pushed code, or `null` if the code was cued in the app; then the file takes the code.
   */
  public reportCompiled(slot: LiveSlot, { hash, code }: { hash: string | null; code: string }): void {
    const deck = this.__decks[slot];
    const error = this.__errors[slot];
    const event: LiveCompiledEvent = {
      session: this.__session,
      slot,
      hash,
      code,
      error,
      codeId: error == null ? deck.compiledCode?.id ?? null : null,
    };
    this.__hot.send('wavenerd-live:compiled', event);
    this.__sendState();
  }

  private __sendState(): void {
    const deckState = (slot: LiveSlot): LiveStateEvent['decks'][LiveSlot] => ({
      mode: SETTINGSMAN.values[slot === 'a' ? 'deckAMode' : 'deckBMode'],
      cueStatus: this.__decks[slot].cueStatus,
      error: this.__errors[slot],
      activeCodeId: this.__decks[slot].activeCodeId,
    });

    const event: LiveStateEvent = {
      session: this.__session,
      playing: this.__hostDeck.isPlaying,
      bpm: this.__decks.a.engine.clock.bpm,
      xfader: Math.round(this.__mixer.xFaderPos * 100) / 100,
      decks: { a: deckState('a'), b: deckState('b') },
    };

    const json = JSON.stringify(event);
    if (json === this.__lastState) { return; }
    this.__lastState = json;

    this.__hot.send('wavenerd-live:state', event);
  }

  /**
   * Write the sounds that Strudel code can play to `live/sounds.txt`, so the agent does not guess names.
   * The sounds are loaded from the network after the engine is ready, one by one.
   */
  private async __watchSounds(deck: StrudelDeck): Promise<void> {
    await deck.engine.ready;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      const event: LiveSoundsEvent = { text: soundsText() };
      this.__hot.send('wavenerd-live:sounds', event);
    };

    send();
    soundMap.listen(() => {
      clearTimeout(timer);
      timer = setTimeout(send, 1000);
    });
  }
}

function soundsText(): string {
  const lines = Object.entries(soundMap.get() as Record<string, { data?: Record<string, unknown> }>)
    .map(([name, sound]) => {
      const data = sound.data ?? {};
      const variants = data.samples ?? data.tables ?? data.fonts;
      const count = Array.isArray(variants) ? String(variants.length) : '';
      return [name, data.type ?? '', count].join('\t');
    })
    .sort();

  return [
    '# Sounds that Strudel code can play. Written by the app (src/live/LiveBridge.ts).',
    '# name<TAB>type<TAB>number of variants (`n` 0 .. count-1, if listed)',
    '# Names are lowercase and case-insensitive. `rolandtr909_bd` is played as s("bd").bank("RolandTR909").',
    ...lines,
    '',
  ].join('\n');
}
