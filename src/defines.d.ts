declare const COMMIT_HASH: string;
declare const COMMIT_DATE: string;

// Strudel type declarations
declare module '@strudel/core' {
  export interface Hap {
    value: Record<string, unknown>;
    whole?: { begin: { valueOf(): number } };
    ensureObjectValue(): void;
    isActive(time: number): boolean;
  }

  export interface Repl {
    evaluate(code: string, autostart?: boolean): Promise<void>;
    start(): void;
    stop(): void;
    pause(): void;
    toggle(): void;
    setCps(cps: number): void;
    scheduler: unknown;
    state: Record<string, unknown>;
  }

  export type OutputCallback = (hap: Hap, deadline: number, hapDuration: number, cps: number, t: number) => void | Promise<void>;

  export interface ReplOptions {
    getTime?: () => number;
    defaultOutput?: OutputCallback;
    transpiler?: (code: string, options?: Record<string, unknown>) => { output: string; miniLocations?: unknown[]; widgets?: unknown[] };
    afterEval?: (args: { code: string; pattern: unknown; meta?: Record<string, unknown> }) => void;
    onToggle?: (started: boolean) => void;
    id?: string;
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
  export function transpiler(
    input: string,
    options?: {
      wrapAsync?: boolean;
      addReturn?: boolean;
      emitMiniLocations?: boolean;
      emitWidgets?: boolean;
      id?: string;
    }
  ): { output: string; miniLocations?: unknown[]; widgets?: unknown[] };
  export function registerWidgetType(type: string): void;
  export function registerLanguage(type: string, config: unknown): void;
  export function getWidgetID(widgetConfig: unknown): string;
}

declare module '@strudel/codemirror/highlight.mjs' {
  import type { Extension } from '@codemirror/view';
  import type { EditorView } from '@codemirror/view';
  export const highlightExtension: Extension[];
  export function updateMiniLocations(view: EditorView, locations: unknown[]): void;
  export function highlightMiniLocations(view: EditorView, atTime: number, haps: unknown[]): void;
  export function isPatternHighlightingEnabled(on: boolean, config?: unknown): Extension;
}

declare module '@strudel/codemirror/widget.mjs' {
  import type { Extension } from '@codemirror/view';
  import type { EditorView } from '@codemirror/view';
  export const widgetPlugin: Extension[];
  export function updateWidgets(view: EditorView, widgets: unknown[]): void;
  export function registerWidget(type: string, fn: unknown): void;
  export function setWidget(id: string, el: HTMLElement): void;
}

declare module '@strudel/codemirror/flash.mjs' {
  import type { Extension } from '@codemirror/view';
  import type { EditorView } from '@codemirror/view';
  export const flashField: Extension;
  export function flash(view: EditorView, ms?: number): void;
  export function isFlashEnabled(on: boolean): Extension;
}

declare module '@strudel/draw/draw.mjs' {
  export class Drawer {
    visibleHaps: unknown[];
    lastFrame: unknown;
    drawTime: [number, number];
    painters: unknown[];
    constructor(onDraw: (haps: unknown[], time: number, drawer: Drawer, painters: unknown[]) => void, drawTime: [number, number]);
    setDrawTime(drawTime: [number, number]): void;
    invalidate(scheduler?: unknown, t?: number): void;
    start(scheduler: unknown): void;
    stop(): void;
  }
  export class Framer {
    constructor(onFrame: () => void, onError?: (e: unknown) => void);
    start(): void;
    stop(): void;
  }
  export function getDrawContext(id: string, options?: Record<string, unknown>): CanvasRenderingContext2D;
  export function cleanupDraw(clearScreen?: boolean, id?: string): void;
}

declare module '@strudel/tonal' {
  const tonal: Record<string, unknown>;
  export = tonal;
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

  export function samples(path: string): Promise<void>;
}
