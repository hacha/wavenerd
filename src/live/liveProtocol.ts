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

/**
 * `wavenerd-live:levels`, app → server, every second: the loudness of the output of each deck,
 * before the trim, the EQ, the faders and the master limiter. LUFS / dBFS, rounded to 0.1.
 * Measured since the deck applied its code or the transport started.
 */
export interface LiveLevelsEvent {
  session: string;
  playing: boolean;
  decks: Record<LiveSlot, {
    activeCodeId: number;
    seconds: number;
    integrated: number | null;
    shortTerm: number | null;
    peak: number | null;
  }>;
}

/** `wavenerd-live:sounds`, app → server: the text of `live/sounds.txt`. */
export interface LiveSoundsEvent {
  text: string;
}

/**
 * A line of the chat with the coding agent (`vite/liveChat.ts`).
 *
 * - `user`: what the performer wrote
 * - `assistant`: the text of the agent
 * - `tool`: a tool the agent used, e.g. `Edit live/B.strudel.js`
 * - `error`: the run failed, or a tool failed
 * - `info`: stopped, new conversation, and so on
 */
export interface LiveChatEntry {
  id: number;
  role: 'user' | 'assistant' | 'tool' | 'error' | 'info';
  text: string;
}

/** `wavenerd-live:chat`, server → app: the whole chat of a deck, whenever it changes or the app asks. */
export interface LiveChatStateEvent {
  slot: LiveSlot;

  /** `null` if the chat can be used. */
  disabledReason: string | null;

  /** The agent is running. Another message is refused until it ends. */
  busy: boolean;

  entries: LiveChatEntry[];
}

/** `wavenerd-live:chat-send`, app → server. */
export interface LiveChatSendEvent {
  slot: LiveSlot;
  text: string;
}

/** `wavenerd-live:chat-cancel` (stop the agent) and `wavenerd-live:chat-reset` (start a new conversation), app → server. */
export interface LiveChatSlotEvent {
  slot: LiveSlot;
}

// `wavenerd-live:chat-hello`, app → server: the app wants the state of both chats. Carries nothing.
