import { type EventListener } from './utils/EventEmittable';

export type CueStatus = 'none' | 'compiling' | 'ready' | 'applying';

export interface CodeDeckEvents {
  changeCueStatus: { cueStatus: CueStatus };
  error: { error: string | null };
}

/**
 * What the deck UI needs from a deck. Implemented by `WavenerdDeck` (GLSL) and `StrudelDeck`.
 */
export interface CodeDeck {
  readonly cueStatus: CueStatus;

  /** Compile the code and cue it. */
  compile(code: string): Promise<void>;

  /** Apply the cue at the next bar. */
  applyCue(): void;

  /** Apply the cue immediately. */
  applyCueImmediately(): void;

  on(type: 'changeCueStatus', listener: EventListener<CodeDeckEvents['changeCueStatus']>): unknown;
  on(type: 'error', listener: EventListener<CodeDeckEvents['error']>): unknown;

  off(type: 'changeCueStatus', listener: EventListener<CodeDeckEvents['changeCueStatus']>): void;
  off(type: 'error', listener: EventListener<CodeDeckEvents['error']>): void;
}
