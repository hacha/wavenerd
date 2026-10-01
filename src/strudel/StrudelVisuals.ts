import * as coreModule from '@strudel/core';
import * as drawModule from '@strudel/draw';
import * as webaudioModule from '@strudel/webaudio';
import { getWidgetID, registerWidgetType } from '@strudel/transpiler';

const { Pattern, clamp, silence } = coreModule;
const { __pianoroll, getPunchcardPainter, getTheme, pitchwheel, setTheme } = drawModule;
const { drawFrequencyScope, drawTimeScope } = webaudioModule;

type Pattern = any;
type Hap = any;
type Painter = (ctx: CanvasRenderingContext2D, time: number, haps: Hap[], drawTime: [number, number]) => void;

/**
 * The drawings of Strudel, such as `pianoroll`.
 * `fscope` has no inline form, and `wordfall` is a `punchcard`.
 */
export type StrudelVisualKind = 'pianoroll' | 'punchcard' | 'spiral' | 'scope' | 'fscope' | 'spectrum' | 'pitchwheel';

/**
 * A drawing that the code of a deck asks for.
 * An inline one (`._pianoroll()`) is drawn below its line in the editor; the others (`.pianoroll()`) behind the code.
 */
export interface StrudelVisual {
  /**
   * Unique in a deck. An inline one keeps its id across compiles while it is the n-th of its kind,
   * so the editor keeps its canvas. Also the id of the analyser of a scope.
   */
  id: string;
  kind: StrudelVisualKind;

  /** The pattern the method is called on. */
  pattern: Pattern;
  options: Record<string, any>;

  /** For an inline one, the offset in the compiled code where its call ends. `null` behind the code. */
  to: number | null;

  /** Size of an inline one in CSS pixels. The width shrinks to the editor. */
  width: number;
  height: number;

  /** For `punchcard` and `spiral`, which are drawn by painters of Strudel. */
  painter?: Painter;
}

/**
 * Same as the `drawTime` of the Strudel REPL: cycles before and after the current one, for `punchcard` and `spiral`.
 */
const PAINTER_DRAW_TIME: [number, number] = [-2, 2];

const INLINE_KINDS: StrudelVisualKind[] = ['pianoroll', 'punchcard', 'spiral', 'scope', 'spectrum', 'pitchwheel'];

interface VisualCollector {
  deckId: string;
  visuals: StrudelVisual[];
}

/** Set while a deck evaluates code. Evaluations run one by one (`StrudelEngine.enqueueEvaluation`). */
let collector: VisualCollector | null = null;

/**
 * Run an evaluation of a deck and collect the visuals its code asks for.
 */
export async function collectStrudelVisuals<T>(
  deckId: string,
  evaluate: () => Promise<T>,
): Promise<{ result: T; visuals: StrudelVisual[] }> {
  const current: VisualCollector = { deckId, visuals: [] };
  collector = current;
  try {
    const result = await evaluate();
    return { result, visuals: current.visuals };
  } finally {
    collector = null;
  }
}

/**
 * Keep the inline visuals whose call the transpiler found, and give them their place in the code.
 * Inline methods called only at query time, e.g. inside `every`, are not in the code and not drawn.
 */
export function placeStrudelVisuals(
  visuals: StrudelVisual[],
  widgets: { id?: string; to: number; type: string; index: number }[],
): StrudelVisual[] {
  const toById = new Map<string, number>();
  for (const widget of widgets) {
    // `slider` is also a widget of the transpiler
    if (widget.type.startsWith('_')) {
      toById.set(getWidgetID(widget), widget.to);
    }
  }

  return visuals.flatMap((visual) => {
    if (visual.to == null) { return [visual]; }

    const to = toById.get(visual.id);
    return to != null ? [{ ...visual, to }] : [];
  });
}

/**
 * Replace the drawing methods of Strudel, which draw on a canvas over the whole page with the clock of a single REPL.
 * Call it once, before evaluating code.
 */
export function registerStrudelVisuals(): void {
  // the painters of Strudel. take them before replacing the methods
  const spiral = Pattern.prototype.spiral;

  const methods: Record<StrudelVisualKind, (pattern: Pattern, visual: StrudelVisual) => Pattern> = {
    pianoroll: (pattern) => pattern,
    punchcard: (pattern, visual) => {
      visual.painter = getPunchcardPainter(visual.options);
      return pattern;
    },
    spiral: (pattern, visual) => {
      visual.painter = spiral.call(silence, visual.options).getPainters()[0];
      return pattern;
    },
    // the analyser of a scope gets the sound of the haps that have `analyze`
    scope: (pattern, visual) => pattern.analyze(visual.id),
    fscope: (pattern, visual) => pattern.analyze(visual.id),
    spectrum: (pattern, visual) => pattern.analyze(visual.id),
    pitchwheel: (pattern) => pattern,
  };

  for (const kind of Object.keys(methods) as StrudelVisualKind[]) {
    Pattern.prototype[kind] = function (options?: Record<string, any>) {
      return addVisual(this, kind, null, options ?? {}, methods[kind]);
    };
  }

  // `scope` is a copy of the original `tscope`
  Pattern.prototype.tscope = Pattern.prototype.scope;

  for (const kind of INLINE_KINDS) {
    // the transpiler passes the id of the widget as the first argument
    registerWidgetType(`_${kind}`);
    Pattern.prototype[`_${kind}`] = function (id: string, options?: Record<string, any>) {
      return addVisual(this, kind, id, options ?? {}, methods[kind]);
    };
  }
}

function addVisual(
  pattern: Pattern,
  kind: StrudelVisualKind,
  inlineId: string | null,
  options: Record<string, any>,
  method: (pattern: Pattern, visual: StrudelVisual) => Pattern,
): Pattern {
  const current = collector;

  const id = inlineId ?? (current != null
    ? `${current.deckId}_${kind}_${current.visuals.filter((v) => v.kind === kind && v.to == null).length}`
    : `_${kind}`);

  const inline = inlineId != null;
  const visual: StrudelVisual = {
    id,
    kind,
    pattern,
    options,
    to: inline ? 0 : null,
    width: 0,
    height: 0,
  };

  if (inline) {
    // same as the inline widgets of the Strudel REPL (`@strudel/codemirror`)
    if (kind === 'spiral' || kind === 'pitchwheel') {
      // `size` is the size of the canvas here, and that of the drawing in Strudel
      const size = options.size ?? (kind === 'spiral' ? 275 : 200);
      visual.width = options.width ?? size;
      visual.height = options.height ?? size;
      visual.options = { ...options, size: size / 5 };
    } else {
      visual.width = options.width ?? 500;
      visual.height = options.height ?? 60;
      visual.options = kind === 'scope'
        ? { pos: 0.5, scale: 1, ...options }
        : kind === 'pianoroll' || kind === 'punchcard'
          ? { fold: 1, ...options }
          : options;
    }
  }

  const result = method(pattern, visual);

  // called at query time, e.g. inside `every`. the pattern still works, but nothing is drawn
  if (current != null && !current.visuals.some((v) => v.id === id)) {
    current.visuals.push(visual);
  }

  return result;
}

// == drawing ======================================================================================
/**
 * Colors of the drawings that the options do not set. Shared by every deck, like the theme of the app.
 */
export function setStrudelVisualColors(foreground: string, inactive: string): void {
  const theme = getTheme();
  if (theme.foreground === foreground && theme.gutterForeground === inactive) { return; }

  setTheme({ ...theme, foreground, gutterForeground: inactive });
}

/**
 * {@link setStrudelVisualColors} with the colors of the theme of the app (`--color-fore`, `--color-foresub`).
 */
export function setStrudelVisualColorsFromPage(): void {
  const style = getComputedStyle(document.documentElement);
  const fore = style.getPropertyValue('--color-fore').trim();
  const foresub = style.getPropertyValue('--color-foresub').trim();
  if (fore !== '') {
    setStrudelVisualColors(fore, foresub || fore);
  }
}

/** Visuals that failed to draw, reported once. */
const failedVisuals = new WeakSet<StrudelVisual>();

/** The last image of each `spectrum`, which scrolls. */
const spectrumFrames = new WeakMap<HTMLCanvasElement, ImageData>();

/**
 * Make the backing store of the canvas match its size on the page.
 */
export function fitStrudelCanvas(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    spectrumFrames.delete(canvas);
  }
}

/**
 * Draw a visual at the given cycle.
 */
export function drawStrudelVisual(
  visual: StrudelVisual,
  canvas: HTMLCanvasElement,
  cycle: number,
  cps: number,
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: visual.kind === 'spectrum' });
  if (ctx == null) { return; }

  try {
    drawVisual(visual, ctx, cycle, cps);
  } catch (error) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!failedVisuals.has(visual)) {
      failedVisuals.add(visual);
      console.warn(`[strudel] failed to draw ${visual.kind}`, error);
    }
  }
}

function drawVisual(visual: StrudelVisual, ctx: CanvasRenderingContext2D, cycle: number, cps: number): void {
  const { kind, pattern, options, id } = visual;

  switch (kind) {
    case 'pianoroll': {
      const { cycles = 4, playhead = 0.5, hideNegative = false } = options;
      const from = -cycles * playhead;
      const to = cycles * (1 - playhead);
      const haps = queryHaps(pattern, cycle + from, cycle + to, cps)
        .filter((hap) => !hideNegative || hap.whole.begin >= 0);
      // `__pianoroll` draws only the haps tagged with `id` if it is given
      __pianoroll({ ...options, time: cycle, ctx, haps, id: undefined });
      return;
    }
    case 'punchcard':
    case 'spiral': {
      const [lookbehind, lookahead] = PAINTER_DRAW_TIME;
      const haps = queryHaps(pattern, cycle + lookbehind, cycle + lookahead, cps);
      visual.painter?.(ctx, cycle, haps, PAINTER_DRAW_TIME);
      return;
    }
    case 'pitchwheel': {
      const haps = queryHaps(pattern, cycle, cycle + 1.0e-6, cps)
        .filter((hap) => hap.whole.begin <= cycle && cycle < hap.whole.end);
      pitchwheel({ ...options, time: cycle, ctx, haps, id: undefined });
      return;
    }
    case 'scope': {
      clearCanvas(ctx, options.smear);
      drawTimeScope(webaudioModule.analysers[id], { color: getTheme().foreground, ...options, ctx, id });
      return;
    }
    case 'fscope': {
      clearCanvas(ctx, options.smear);
      const analyser = webaudioModule.analysers[id];
      const config: Record<string, any> = { color: getTheme().foreground, ...options, ctx, id };
      if (analyser != null) {
        drawFrequencyScope(analyser, config);
      } else {
      // `drawFrequencyScope` throws without an analyser
        drawFlatLine(ctx, config.color, config.pos ?? 0.75);
      }
      return;
    }
    case 'spectrum':
      drawSpectrum(ctx, webaudioModule.analysers[id], { color: getTheme().foreground, ...options, id });
      return;
  }
}

/**
 * Haps that have a whole, which every drawing needs. Same controls as the scheduler.
 */
function queryHaps(pattern: Pattern, begin: number, end: number, cps: number): Hap[] {
  return pattern.queryArc(begin, end, { _cps: cps }).filter((hap: Hap) => hap.whole != null);
}

function clearCanvas(ctx: CanvasRenderingContext2D, smear = 0): void {
  if (!smear) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  } else {
    ctx.fillStyle = `rgba(0,0,0,${1 - smear})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}

function drawFlatLine(ctx: CanvasRenderingContext2D, color: string, pos: number): void {
  const { canvas } = ctx;
  const y = pos * canvas.height;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(canvas.width, y);
  ctx.stroke();
}

/**
 * `drawSpectrum` of `@strudel/webaudio` (not exported): a spectrogram that scrolls to the left.
 */
function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  analyser: AnalyserNode | undefined,
  { thickness = 3, speed = 1, min = -80, max = 0, id, color }: Record<string, any>,
): void {
  ctx.lineWidth = thickness;
  ctx.strokeStyle = color;

  // nothing is played yet
  if (analyser == null) { return; }

  const { canvas } = ctx;
  const dataArray: Float32Array = webaudioModule.getAnalyzerData('frequency', id);
  const bufferSize = analyser.frequencyBinCount;

  const imageData = spectrumFrames.get(canvas) ?? ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(imageData, -speed, 0);

  ctx.fillStyle = color;
  const x = canvas.width - speed;
  for (let i = 0; i < bufferSize; i++) {
    ctx.globalAlpha = clamp((dataArray[i] - min) / (max - min), 0, 1);
    const y = (Math.log(i + 1) / Math.log(bufferSize)) * canvas.height;
    ctx.fillRect(x, canvas.height - y, speed, 2);
  }
  ctx.globalAlpha = 1;

  spectrumFrames.set(canvas, ctx.getImageData(0, 0, canvas.width, canvas.height));
}
