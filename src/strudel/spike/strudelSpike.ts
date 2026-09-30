/**
 * M0 spike. Throwaway code; enable with `?strudelSpike`.
 * See doc/strudel-integration.md.
 */

import * as superdoughModule from 'superdough';
import * as webaudioModule from '@strudel/webaudio';
import * as coreModule from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { type Mixer } from '../../audio/Mixer';
import { createDeckOutputController } from '../DeckOutputController';
import { DeckClock } from '../DeckClock';
import { StrudelScheduler } from '../StrudelScheduler';
import onsetProbeProcessorUrl from './OnsetProbeProcessor.js?url';

const {
  getAudioContext,
  getSuperdoughAudioController,
  loadWorklets,
  registerSynthSounds,
  setAudioContext,
  setSuperdoughAudioController,
} = superdoughModule;
const { evalScope, getTrigger } = coreModule;
const { webaudioOutput, webaudioRepl } = webaudioModule;

export const CLICK_GLSL = `vec2 mainAudio(vec4 time) {
  return vec2(time.y < 0.002 ? 0.8 : 0.0);
}
`;

// preloaded so that the ear check works right after the play overlay. synths only, no samples
export const DEFAULT_STRUDEL_A = '$: note("c2 c2 eb2 g1").s("square").lpf(800).decay(.2).sustain(0)';
export const DEFAULT_STRUDEL_B = '$: note("<c5 eb5 g5 bb5>*8").s("triangle").decay(.1).sustain(0)';

export const CLICK_STRUDEL = 'note("c3").s("square").attack(0).decay(0.05).sustain(0)';

export async function startStrudelSpike({
  audio,
  deckA,
  deckB,
  mixer,
}: {
  audio: AudioContext;
  deckA: WavenerdDeck;
  deckB: WavenerdDeck;
  mixer: Mixer;
}) {
  // == init ======================================================================================
  setAudioContext(audio);

  // the default controller (connected to ctx.destination). it must never get any orbit
  const defaultController = getSuperdoughAudioController();

  const identity = {
    setController: superdoughModule.setSuperdoughAudioController === webaudioModule.setSuperdoughAudioController,
    getAudioContext: superdoughModule.getAudioContext === webaudioModule.getAudioContext,
    sameContext: getAudioContext() === audio,
  };
  console.info('[strudelSpike] module identity', identity);

  await loadWorklets().catch((e: unknown) => console.warn('[strudelSpike] loadWorklets failed', e));
  registerSynthSounds();

  await evalScope(
    coreModule,
    import('@strudel/mini'),
    import('@strudel/tonal'),
    webaudioModule,
  );

  const clock = new DeckClock(deckA);

  // serialize evaluate(), since evalScope and Pattern.prototype.p are global
  let evalQueue: Promise<unknown> = Promise.resolve();

  function createStrudelDeck(id: 'A' | 'B', input: AudioNode) {
    const output = audio.createGain();
    output.connect(input);

    const controller = createDeckOutputController(audio, output);

    const defaultOutput = (hap: any, deadline: number, duration: number, cps: number, t: number) => {
      setSuperdoughAudioController(controller);
      return webaudioOutput(hap, deadline, duration, cps, t);
    };

    const scheduler = new StrudelScheduler({
      audio,
      clock,
      onTrigger: getTrigger({ defaultOutput, getTime: () => audio.currentTime }),
    });
    scheduler.start();

    const repl = webaudioRepl({
      id: `deck${id}`,
      transpiler,
      onEvalError: (e: unknown) => console.error(`[strudelSpike] deck ${id} eval error`, e),
    });

    const evaluate = (code: string) => {
      const promise = evalQueue.then(async () => {
        const pattern = await repl.evaluate(code, false);
        if (pattern != null) {
          scheduler.pattern = pattern;
        }
        return pattern;
      });
      evalQueue = promise.catch(() => {});
      return promise;
    };

    return { output, controller, scheduler, repl, evaluate };
  }

  const strudelA = createStrudelDeck('A', mixer.inputA);
  const strudelB = createStrudelDeck('B', mixer.inputB);

  // == timing probe ==============================================================================
  await audio.audioWorklet.addModule(onsetProbeProcessorUrl);
  const probe = new AudioWorkletNode(audio, 'onset-probe-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const probeMerger = audio.createChannelMerger(2);
  deckA.node.connect(probeMerger, 0, 0);
  strudelA.output.connect(probeMerger, 0, 1);
  probeMerger.connect(probe);
  const probeSink = audio.createGain();
  probeSink.gain.value = 0.0;
  probe.connect(probeSink);
  probeSink.connect(audio.destination);

  const onsets: [number[], number[]] = [[], []];
  probe.port.onmessage = ({ data }: MessageEvent<{ ch: 0 | 1; frame: number }>) => {
    onsets[data.ch].push(data.frame);
  };

  /** Pair GLSL (ch0) and Strudel (ch1) onsets and return the diffs in ms (Strudel - GLSL). */
  function timingStats() {
    const [glsl, strudel] = onsets;
    const diffs: number[] = [];
    for (const g of glsl) {
      let best: number | null = null;
      for (const s of strudel) {
        if (best == null || Math.abs(s - g) < Math.abs(best - g)) { best = s; }
      }
      if (best != null && Math.abs(best - g) < audio.sampleRate * 0.5) {
        diffs.push((best - g) / audio.sampleRate * 1000.0);
      }
    }
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return {
      count: diffs.length,
      glslOnsets: glsl.length,
      strudelOnsets: strudel.length,
      mean,
      min: Math.min(...diffs),
      max: Math.max(...diffs),
      diffs: diffs.map((d) => Math.round(d * 100) / 100),
    };
  }

  // mute GLSL decks by default so that only Strudel is heard. unmute for the timing probe
  const muteGlsl = (mute: boolean) => {
    deckA.node.gain.value = mute ? 0.0 : 1.0;
    deckB.node.gain.value = mute ? 0.0 : 1.0;
  };
  muteGlsl(true);

  await strudelA.evaluate(DEFAULT_STRUDEL_A);
  await strudelB.evaluate(DEFAULT_STRUDEL_B);

  // == handle ====================================================================================
  const handle = {
    identity,
    clock,
    strudelA,
    strudelB,
    onsets,
    timingStats,
    muteGlsl,
    clearOnsets: () => { onsets[0].length = 0; onsets[1].length = 0; },
    CLICK_GLSL,
    CLICK_STRUDEL,
    /** Leak check: the controller that is current right now, and the orbit counts of each controller. */
    controllers: () => ({
      current: getSuperdoughAudioController(),
      aOrbits: Object.keys(strudelA.controller.nodes).length,
      bOrbits: Object.keys(strudelB.controller.nodes).length,
      defaultOrbits: Object.keys(defaultController.nodes).length,
    }),
    deckA,
    deckB,
    mixer,
    audio,
  };
  (window as any).strudelSpike = handle;
  console.info('[strudelSpike] ready: window.strudelSpike');

  return handle;
}
