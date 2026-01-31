declare const COMMIT_HASH: string;
declare const COMMIT_DATE: string;

// Strudel type declarations
declare module '@strudel/core' {
  export interface Hap {
    value: Record<string, unknown>;
    whole?: { begin: { valueOf(): number } };
    ensureObjectValue(): void;
  }

  export interface Repl {
    evaluate(code: string, autostart?: boolean): Promise<void>;
    start(): void;
    stop(): void;
    setCps(cps: number): void;
  }

  export type OutputCallback = (hap: Hap, deadline: number, hapDuration: number, cps: number, t: number) => void | Promise<void>;

  export interface ReplOptions {
    getTime?: () => number;
    defaultOutput?: OutputCallback;
    [key: string]: unknown;
  }

  export const controls: Record<string, unknown>;
  export function evalScope(...args: unknown[]): void;
  export function repl(options?: ReplOptions): Repl;
}

declare module '@strudel/webaudio' {
  import { Repl } from '@strudel/core';
  export { Repl };
  export function webaudioRepl(options?: Record<string, unknown>): Repl;
  export function initAudio(options?: { audioContext?: AudioContext } & Record<string, unknown>): Promise<void>;
  export function getAudioContext(): AudioContext;
  export function registerSynthSounds(): Promise<void>;
}

declare module '@strudel/mini' {
  export const mini: unknown;
  export function note(pattern: string): unknown;
  export function s(pattern: string): unknown;
  export function sound(pattern: string): unknown;
}

declare module '@strudel/transpiler' {
  // Transpiler exports
}

// Wavenerd superdough fork with custom output support
declare module '@wavenerd/superdough' {
  export function superdough(
    value: Record<string, unknown>,
    t: number,
    hapDuration: number,
    cps?: number,
    cycle?: number,
    controllerId?: string | null
  ): Promise<void>;

  export function createSuperdoughController(
    id: string,
    audioContext: AudioContext,
    customDestination: AudioNode
  ): unknown;

  export function getSuperdoughController(id: string): unknown;

  export function getAudioContext(): AudioContext;

  export function initAudio(options?: Record<string, unknown>): Promise<void>;
}
