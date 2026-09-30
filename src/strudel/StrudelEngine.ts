import * as coreModule from '@strudel/core';
import * as webaudioModule from '@strudel/webaudio';
import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { EventEmittable } from '../utils/EventEmittable';
import { DeckClock } from './DeckClock';
import { prebake } from './prebake';
import { UserSamples } from './UserSamples';

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

export interface StrudelEngineEvents {
  changeFailedSounds: { failedSounds: string[] };
  changeFailedFiles: { failedFiles: string[] };
}

/**
 * Global Strudel / superdough state shared by every {@link StrudelDeck}.
 */
export class StrudelEngine extends EventEmittable<StrudelEngineEvents> {
  public readonly audio: AudioContext;
  public readonly clock: DeckClock;

  /**
   * Samples of the storage. They do not need the network.
   */
  public readonly userSamples: UserSamples;

  /**
   * Resolves when Strudel can evaluate code. Does not wait for the sounds to be loaded.
   */
  public readonly ready: Promise<void>;

  private __evalQueue: Promise<unknown> = Promise.resolve();
  private __completionWords: StrudelCompletionWords = { globals: [], methods: [] };
  private __failedSounds: string[] = [];
  private __failedFiles: string[] = [];
  private __isLoadingSounds = false;
  private __isRetryPending = false;

  /**
   * Names of the sound sources that could not be loaded, usually because the network is down.
   * They are loaded again when the browser goes online.
   * Audio files that fail when they are played are in {@link failedFiles}.
   */
  public get failedSounds(): string[] {
    return this.__failedSounds;
  }

  /**
   * Sounds whose audio file failed to load while playing, such as `bd:3`.
   * superdough keeps the failure, so they stay silent until the page is reloaded.
   */
  public get failedFiles(): string[] {
    return this.__failedFiles;
  }

  /**
   * Words for the editor completion. Empty until {@link ready}.
   */
  public get completionWords(): StrudelCompletionWords {
    return this.__completionWords;
  }

  public constructor({ audio, hostDeck }: { audio: AudioContext; hostDeck: WavenerdDeck }) {
    super();

    this.audio = audio;

    // before anything touches superdough, otherwise it creates its own AudioContext
    setAudioContext(audio);

    this.clock = new DeckClock(hostDeck);
    this.userSamples = new UserSamples(audio);
    this.ready = this.__init();

    window.addEventListener('online', () => {
      this.retryFailedSounds();
    });
  }

  /**
   * Load the sound sources that failed again. Does nothing if none failed.
   */
  public async retryFailedSounds(): Promise<void> {
    if (this.__failedSounds.length === 0) { return; }

    await this.__loadSounds(this.__failedSounds);
  }

  /**
   * Record a sound whose audio file failed to load while playing. Does nothing if it is already recorded.
   */
  public addFailedFile(name: string): void {
    if (this.__failedFiles.includes(name)) { return; }

    this.__failedFiles = [...this.__failedFiles, name];
    this.__emit('changeFailedFiles', { failedFiles: this.__failedFiles });
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
    this.__loadSounds();
  }

  private async __loadSounds(only?: string[]): Promise<void> {
    if (this.__isLoadingSounds) {
      // the network might have come back in the middle of the load. load again after it
      this.__isRetryPending = true;
      return;
    }
    this.__isLoadingSounds = true;
    this.__isRetryPending = false;

    try {
      this.__failedSounds = await prebake(only);
    } catch (e: unknown) {
      // prebake settles each source by itself. should not happen
      console.warn('[strudel] failed to load sounds', e);
    } finally {
      this.__isLoadingSounds = false;
    }

    this.__emit('changeFailedSounds', { failedSounds: this.__failedSounds });

    if (this.__isRetryPending) {
      await this.retryFailedSounds();
    }
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
