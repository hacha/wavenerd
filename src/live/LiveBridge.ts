import { soundMap } from '@strudel/webaudio';
import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { LoudnessMeter } from '../audio/LoudnessMeter';
import { type Mixer } from '../audio/Mixer';
import { SETTINGSMAN } from '../SettingsManager';
import { type StrudelDeck } from '../strudel/StrudelDeck';
import { EventEmittable } from '../utils/EventEmittable';
import { type LiveCompiledEvent, type LiveLevelsEvent, type LivePushEvent, type LiveSlot, type LiveSoundsEvent, type LiveStateEvent } from './liveProtocol';

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
  private readonly __meters: Record<LiveSlot, LoudnessMeter>;
  private readonly __metered: Record<LiveSlot, { activeCodeId: number; playing: boolean }>;

  /**
   * @param sources The outputs of the decks, before the mixer. Their loudness goes to `live/levels.json`
   */
  public constructor({ hot, decks, hostDeck, mixer, sources }: {
    hot: ViteHotContext;
    decks: Record<LiveSlot, StrudelDeck>;
    hostDeck: WavenerdDeck;
    mixer: Mixer;
    sources: Record<LiveSlot, AudioNode>;
  }) {
    super();

    this.__hot = hot;
    this.__decks = decks;
    this.__hostDeck = hostDeck;
    this.__mixer = mixer;

    this.__meters = {
      a: new LoudnessMeter(sources.a.context as AudioContext),
      b: new LoudnessMeter(sources.b.context as AudioContext),
    };
    sources.a.connect(this.__meters.a.input);
    sources.b.connect(this.__meters.b.input);
    this.__metered = {
      a: { activeCodeId: decks.a.activeCodeId, playing: hostDeck.isPlaying },
      b: { activeCodeId: decks.b.activeCodeId, playing: hostDeck.isPlaying },
    };
    setInterval(() => this.__sendLevels(), 1000);

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

  private __sendLevels(): void {
    const playing = this.__hostDeck.isPlaying;
    const round = (value: number | null) => value == null ? null : Math.round(value * 10) / 10;

    const deckLevels = (slot: LiveSlot): LiveLevelsEvent['decks'][LiveSlot] => {
      const { activeCodeId } = this.__decks[slot];
      const metered = this.__metered[slot];

      // measure the code that plays now, from its start
      if (metered.activeCodeId !== activeCodeId || (playing && !metered.playing)) {
        this.__meters[slot].reset();
      }
      metered.activeCodeId = activeCodeId;
      metered.playing = playing;

      const reading = this.__meters[slot].read();
      return {
        activeCodeId,
        seconds: Math.round(reading.seconds),
        integrated: round(reading.integrated),
        shortTerm: round(reading.shortTerm),
        peak: round(reading.peak),
      };
    };

    const event: LiveLevelsEvent = {
      session: this.__session,
      playing,
      decks: { a: deckLevels('a'), b: deckLevels('b') },
    };
    this.__hot.send('wavenerd-live:levels', event);
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
