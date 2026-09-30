import * as coreModule from '@strudel/core';
import * as webaudioModule from '@strudel/webaudio';
import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { DeckClock } from './DeckClock';
import { prebake } from './prebake';

const { evalScope, Pattern } = coreModule;

/** Same as the knobs of GLSL decks. */
export const STRUDEL_KNOB_NAMES = [
  'knob0',
  'knob1',
  'knob2',
  'knob3',
  'knob4',
  'knob5',
  'knob6',
  'knob7',
] as const;

export interface StrudelCompletionWords {
  /** Names available in Strudel code, including the knobs. */
  globals: string[];

  /** Methods of patterns. */
  methods: string[];
}
const { loadWorklets, setAudioContext } = webaudioModule;

/**
 * Global Strudel / superdough state shared by every {@link StrudelDeck}.
 */
export class StrudelEngine {
  public readonly audio: AudioContext;
  public readonly clock: DeckClock;

  /**
   * Resolves when Strudel can evaluate code. Does not wait for the sounds to be loaded.
   */
  public readonly ready: Promise<void>;

  private __evalQueue: Promise<unknown> = Promise.resolve();
  private __completionWords: StrudelCompletionWords = { globals: [], methods: [] };

  /**
   * Words for the editor completion. Empty until {@link ready}.
   */
  public get completionWords(): StrudelCompletionWords {
    return this.__completionWords;
  }

  public constructor({ audio, hostDeck }: { audio: AudioContext; hostDeck: WavenerdDeck }) {
    this.audio = audio;

    // before anything touches superdough, otherwise it creates its own AudioContext
    setAudioContext(audio);

    this.clock = new DeckClock(hostDeck);
    this.ready = this.__init();
  }

  /**
   * Run evaluations one by one, since `evalScope` and `Pattern.prototype.p` are global.
   */
  public enqueueEvaluation<T>(evaluate: () => Promise<T>): Promise<T> {
    const promise = this.__evalQueue.then(evaluate);
    this.__evalQueue = promise.catch(() => {});
    return promise;
  }

  private async __init(): Promise<void> {
    await loadWorklets().catch((e: unknown) => {
      console.warn('[strudel] failed to load worklets', e);
    });

    const modules: object[] = [
      coreModule,
      await import('@strudel/mini'),
      await import('@strudel/tonal'),
      webaudioModule,
    ];
    await evalScope(...modules);

    this.__completionWords = createCompletionWords(modules);

    // network. do not block evaluation
    prebake().catch((e: unknown) => {
      console.warn('[strudel] failed to load sounds', e);
    });
  }
}

function isCompletionWord(name: string): boolean {
  return /^[A-Za-z$][\w$]*$/.test(name);
}

function createCompletionWords(modules: object[]): StrudelCompletionWords {
  const globals = new Set<string>(STRUDEL_KNOB_NAMES);
  for (const module of modules) {
    for (const name of Object.keys(module)) {
      if (isCompletionWord(name)) { globals.add(name); }
    }
  }

  const methods = Object.getOwnPropertyNames(Pattern.prototype)
    .filter((name) => name !== 'constructor' && isCompletionWord(name));

  return {
    globals: [...globals].sort(),
    methods: methods.sort(),
  };
}
