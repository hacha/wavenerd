import type { EventListener } from './utils/EventEmittable';

export type CueStatus = 'none' | 'compiling' | 'ready' | 'applying';

export interface IDeckEvents {
  changeCueStatus: { cueStatus: CueStatus };
  error: { error: string | null };
  play: void;
  pause: void;
}

export interface IDeck {
  readonly cueStatus: CueStatus;
  readonly isPlaying: boolean;

  compile(code: string): Promise<void>;
  applyCue(): void | Promise<void>;
  applyCueImmediately(): void | Promise<void>;
  setParam(name: string, value: number): void;
  dispose(): void;

  on(type: 'changeCueStatus', listener: EventListener<{ cueStatus: CueStatus }>): EventListener<{ cueStatus: CueStatus }>;
  on(type: 'error', listener: EventListener<{ error: string | null }>): EventListener<{ error: string | null }>;
  on(type: 'play', listener: EventListener<void>): EventListener<void>;
  on(type: 'pause', listener: EventListener<void>): EventListener<void>;

  off(type: 'changeCueStatus', listener: EventListener<{ cueStatus: CueStatus }>): void;
  off(type: 'error', listener: EventListener<{ error: string | null }>): void;
  off(type: 'play', listener: EventListener<void>): void;
  off(type: 'pause', listener: EventListener<void>): void;
}
