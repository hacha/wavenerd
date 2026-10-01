/**
 * Messages between `vite/liveBridge.ts` (dev server) and `src/live/LiveBridge.ts` (app),
 * sent as the `wavenerd-live:*` custom events of the HMR channel.
 */

export type LiveSlot = 'a' | 'b';

/** `wavenerd-live:push`, server → app: a file of `live/` changed. */
export interface LivePushEvent {
  slot: LiveSlot;
  code: string;
  hash: string;
}

/** `wavenerd-live:compiled`, app → server. */
export interface LiveCompiledEvent {
  /** Changes when the app is reloaded. `codeId` and `activeCodeId` count from 1 again. */
  session: string;

  slot: LiveSlot;

  /** The hash of the pushed code that was compiled. `null` if the code was cued in the app. */
  hash: string | null;

  code: string;
  error: string | null;

  /** `StrudelCompiledCode.id` if it compiled. */
  codeId: number | null;
}

/** `wavenerd-live:state`, app → server. */
export interface LiveStateEvent {
  session: string;
  playing: boolean;
  bpm: number;

  /** 0.0 (A) .. 1.0 (B). */
  xfader: number;

  decks: Record<LiveSlot, {
    mode: 'glsl' | 'strudel';
    cueStatus: string;
    error: string | null;
    activeCodeId: number;
  }>;
}

/** `wavenerd-live:sounds`, app → server: the text of `live/sounds.txt`. */
export interface LiveSoundsEvent {
  text: string;
}
