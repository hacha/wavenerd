import * as coreModule from '@strudel/core';
import * as webaudioModule from '@strudel/webaudio';
import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { DeckClock } from './DeckClock';
import { prebake } from './prebake';

const { evalScope } = coreModule;
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

    await evalScope(
      coreModule,
      import('@strudel/mini'),
      import('@strudel/tonal'),
      webaudioModule,
    );

    // network. do not block evaluation
    prebake().catch((e: unknown) => {
      console.warn('[strudel] failed to load sounds', e);
    });
  }
}
