/**
 * Dev tools for the Strudel integration. Enable with `?strudelDev`, then use `window.strudelDev` from the console.
 *
 * Timing check: GLSL click on deck A vs Strudel click on deck B.
 *
 * ```js
 * await strudelDev.setupTimingCheck(); // then play
 * strudelDev.timingStats(); // ms, Strudel - GLSL
 * ```
 *
 * Knob isolation check: both decks compile the same code that reads `knob0`.
 *
 * ```js
 * await strudelDev.knobCheck(); // passes when each deck reads its own knob0
 * ```
 *
 * Load check: cost of the GLSL deck that keeps running behind a Strudel deck.
 *
 * ```js
 * await strudelDev.deckA.compile(strudelDev.heavyGlsl(1000)); strudelDev.deckA.applyCueImmediately();
 * await strudelDev.loadCheck(10); // update() times in ms, underruns, scheduler tick gaps, long tasks
 * ```
 */

import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { type StrudelDeck } from '../StrudelDeck';
import onsetProbeProcessorUrl from './OnsetProbeProcessor.js?url';

export const CLICK_GLSL = `vec2 mainAudio(vec4 time) {
  return vec2(time.y < 0.002 ? 0.8 : 0.0);
}
`;

export const CLICK_STRUDEL = 'note("c3").s("square").attack(0).decay(0.05).sustain(0)';

export const SILENT_GLSL = `vec2 mainAudio(vec4 time) {
  return vec2(0.0);
}
`;

/** A shader that sums `n` sines per sample. Its cost grows with `n`. */
export function heavyGlsl(n: number): string {
  return `vec2 mainAudio(vec4 time) {
  vec2 dest = vec2(0.0);
  for (int i = 0; i < ${Math.floor(n)}; i++) {
    float f = float(i + 1);
    dest += sin(6.2831853 * 55.0 * f * time.z + vec2(0.0, f)) / f;
  }
  return 0.1 * dest;
}
`;
}

export const CODE_KNOB = 's("bd*4").lpf(knob0.range(200, 8000))';

export async function installStrudelDevTools({
  audio,
  deckA,
  deckB,
  strudelDeckA,
  strudelDeckB,
}: {
  audio: AudioContext;
  deckA: WavenerdDeck;
  deckB: WavenerdDeck;
  strudelDeckA: StrudelDeck;
  strudelDeckB: StrudelDeck;
}) {
  await audio.audioWorklet.addModule(onsetProbeProcessorUrl);

  const onsets: [number[], number[]] = [[], []];

  /** Record onsets of two nodes; ch0 = `nodeA`, ch1 = `nodeB`. */
  function probe(nodeA: AudioNode, nodeB: AudioNode) {
    const node = new AudioWorkletNode(audio, 'onset-probe-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const merger = audio.createChannelMerger(2);
    nodeA.connect(merger, 0, 0);
    nodeB.connect(merger, 0, 1);
    merger.connect(node);

    const sink = audio.createGain();
    sink.gain.value = 0.0;
    node.connect(sink);
    sink.connect(audio.destination);

    node.port.onmessage = ({ data }: MessageEvent<{ ch: 0 | 1; frame: number }>) => {
      onsets[data.ch].push(data.frame);
    };
  }

  function clearOnsets() {
    onsets[0].length = 0;
    onsets[1].length = 0;
  }

  /** Pair onsets of ch0 and ch1 and return the diffs in ms (ch1 - ch0). */
  function timingStats() {
    const [a, b] = onsets;
    const diffs: number[] = [];
    for (const ta of a) {
      let best: number | null = null;
      for (const tb of b) {
        if (best == null || Math.abs(tb - ta) < Math.abs(best - ta)) { best = tb; }
      }
      if (best != null && Math.abs(best - ta) < audio.sampleRate * 0.5) {
        diffs.push((best - ta) / audio.sampleRate * 1000.0);
      }
    }
    return {
      count: diffs.length,
      onsetsA: a.length,
      onsetsB: b.length,
      mean: diffs.reduce((sum, d) => sum + d, 0) / diffs.length,
      min: Math.min(...diffs),
      max: Math.max(...diffs),
    };
  }

  /** GLSL click on deck A, Strudel click on deck B, and probe both. */
  async function setupTimingCheck() {
    await deckA.compile(CLICK_GLSL);
    deckA.applyCueImmediately();
    await strudelDeckB.compile(CLICK_STRUDEL);
    strudelDeckB.applyCueImmediately();
    strudelDeckB.active = true;
    probe(deckA.node, strudelDeckB.output);
    clearOnsets();
  }

  /** Cutoffs of the cued pattern of a Strudel deck in the first cycle. Reads a private field. */
  function stagedCutoffs(deck: StrudelDeck): number[] {
    const staged = (deck as any).__staged;
    return staged.queryArc(0, 1).map((hap: any) => hap.value.cutoff);
  }

  /** Compile the same knob code on both Strudel decks at once and check each reads its own knob0. */
  async function knobCheck() {
    await Promise.all([
      strudelDeckA.compile(CODE_KNOB),
      strudelDeckB.compile(CODE_KNOB),
    ]);

    strudelDeckA.setParam('knob0', 1.0);
    strudelDeckB.setParam('knob0', 0.0);
    const first = { a: stagedCutoffs(strudelDeckA), b: stagedCutoffs(strudelDeckB) };

    strudelDeckA.setParam('knob0', 0.5);
    const second = { a: stagedCutoffs(strudelDeckA), b: stagedCutoffs(strudelDeckB) };

    const every = (values: number[], expected: number) => values.every((v) => Math.abs(v - expected) < 1e-6);
    const pass = every(first.a, 8000) && every(first.b, 200)
      && every(second.a, 4100) && every(second.b, 200);

    return { pass, first, second };
  }

  function summarize(values: number[]) {
    if (values.length === 0) { return null; }
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const round = (v: number) => Math.round(v * 100.0) / 100.0;
    return {
      count: sorted.length,
      mean: round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
      p50: round(at(0.5)),
      p95: round(at(0.95)),
      max: round(sorted[sorted.length - 1]),
    };
  }

  /**
   * Measure for `seconds`: wall time of each `WavenerdDeck.update()` that rendered (ms), underruns,
   * gaps between ticks of the Strudel schedulers (ms), and long tasks of the main thread (ms).
   * Reads private fields.
   */
  async function loadCheck(seconds = 10) {
    const glslDecks = [deckA, deckB] as const;
    const updates: number[][] = [[], []];
    const underruns = [0, 0];
    const restores: (() => void)[] = [];

    glslDecks.forEach((deck, i) => {
      let rendered = false;
      const onUpdate = () => { rendered = true; };
      const onUnderrun = () => { underruns[i]++; };
      deck.on('update', onUpdate);
      deck.on('underrun', onUnderrun);

      const original = deck.update;
      deck.update = async function (this: WavenerdDeck) {
        const begin = performance.now();
        rendered = false;
        await original.call(this);
        if (rendered) { updates[i].push(performance.now() - begin); }
      };

      restores.push(() => {
        deck.update = original;
        deck.off('update', onUpdate);
        deck.off('underrun', onUnderrun);
      });
    });

    const tickGaps: number[][] = [[], []];
    [strudelDeckA, strudelDeckB].forEach((deck, i) => {
      const scheduler = (deck as any).__scheduler;
      const original = scheduler.tick;
      let last: number | null = null;
      scheduler.tick = function () {
        const now = performance.now();
        if (last != null) { tickGaps[i].push(now - last); }
        last = now;
        original.call(this);
      };
      restores.push(() => { scheduler.tick = original; });
    });

    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) { longTasks.push(entry.duration); }
    });
    observer.observe({ entryTypes: ['longtask'] });
    restores.push(() => observer.disconnect());

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000.0));
    restores.forEach((restore) => restore());

    return {
      seconds,
      // audio covered by one render; an update must stay well below this
      renderMs: Math.round(deckA.framesPerRender / deckA.sampleRate * 100000.0) / 100.0,
      updateA: summarize(updates[0]),
      updateB: summarize(updates[1]),
      underrunsA: underruns[0],
      underrunsB: underruns[1],
      tickGapA: summarize(tickGaps[0]),
      tickGapB: summarize(tickGaps[1]),
      longTasks: summarize(longTasks),
    };
  }

  const handle = {
    audio,
    deckA,
    deckB,
    strudelDeckA,
    strudelDeckB,
    onsets,
    probe,
    clearOnsets,
    timingStats,
    setupTimingCheck,
    knobCheck,
    loadCheck,
    heavyGlsl,
    SILENT_GLSL,
    CLICK_GLSL,
    CLICK_STRUDEL,
  };
  (window as any).strudelDev = handle;
  console.info('[strudelDev] ready: window.strudelDev');

  return handle;
}
