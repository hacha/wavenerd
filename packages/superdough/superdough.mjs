/*
superdough.mjs - <short description TODO>
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/superdough/superdough.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import './feedbackdelay.mjs';
import './reverb.mjs';
import './vowel.mjs';
import { nanFallback, _mod, cycleToSeconds } from './util.mjs';
import workletsUrl from './worklets.mjs?audioworklet';
import { createFilter, gainNode, getCompressor, getDistortion, getLfo, getWorklet, effectSend } from './helpers.mjs';
import { logger } from './logger.mjs';
import { loadBuffer } from './sampler.mjs';
import { SuperdoughAudioController } from './superdoughoutput.mjs';

// Import AudioContext functions from our local audioContext.mjs (self-contained implementation)
import { getAudioContext, setDefaultAudioContext } from './audioContext.mjs';

// Import nanostores map for soundMap (matching original superdough's implementation)
import { map } from 'nanostores';

// ============================================================================
// Sound Map - Using nanostores map to match original superdough API
// This ensures @strudel/webaudio (via Vite alias) uses the same soundMap instance
// ============================================================================

export const soundMap = map();

export function registerSound(key, onTrigger, data = {}) {
  key = key.toLowerCase().replace(/\s+/g, '_');
  soundMap.setKey(key, { onTrigger, data });
}

export const aliasBank = map();

export const soundAlias = (alias, original, data = {}) => {
  aliasBank.setKey(alias, { original, ...data });
};

export const getSound = (s) => {
  const sounds = soundMap.get();
  if (sounds[s]) {
    return sounds[s];
  }
  // Check for alias
  const aliases = aliasBank.get();
  if (aliases[s]) {
    const { original, ...aliasData } = aliases[s];
    const sound = sounds[original];
    if (sound) {
      return {
        ...sound,
        data: { ...sound.data, ...aliasData },
      };
    }
  }
  return undefined;
};

export const resetLoadedSounds = () => {
  soundMap.set({});
  aliasBank.set({});
};

export const DEFAULT_MAX_POLYPHONY = 128;
const DEFAULT_AUDIO_DEVICE_NAME = 'System Standard';

let maxPolyphony = DEFAULT_MAX_POLYPHONY;

export function setMaxPolyphony(polyphony) {
  maxPolyphony = parseInt(polyphony) ?? DEFAULT_MAX_POLYPHONY;
}

let multiChannelOrbits = false;
export function setMultiChannelOrbits(bool) {
  multiChannelOrbits = bool == true;
}


let gainCurveFunc = (val) => val;

export function applyGainCurve(val) {
  return gainCurveFunc(val);
}

export function setGainCurve(newGainCurveFunc) {
  gainCurveFunc = newGainCurveFunc;
}


export const getAudioDevices = async () => {
  await navigator.mediaDevices.getUserMedia({ audio: true });
  let mediaDevices = await navigator.mediaDevices.enumerateDevices();
  mediaDevices = mediaDevices.filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'default');
  const devicesMap = new Map();
  devicesMap.set(DEFAULT_AUDIO_DEVICE_NAME, '');
  mediaDevices.forEach((device) => {
    devicesMap.set(device.label, device.deviceId);
  });
  return devicesMap;
};

let defaultDefaultValues = {
  s: 'triangle',
  gain: 0.8,
  postgain: 1,
  density: '.03',
  ftype: '12db',
  fanchor: 0,
  resonance: 1,
  hresonance: 1,
  bandq: 1,
  channels: [1, 2],
  phaserdepth: 0.75,
  shapevol: 1,
  distortvol: 1,
  distorttype: 0,
  delay: 0,
  byteBeatExpression: '0',
  delayfeedback: 0.5,
  delaysync: 3 / 16,
  orbit: 1,
  i: 1,
  velocity: 1,
  fft: 8,
};

const defaultDefaultDefaultValues = Object.freeze({ ...defaultDefaultValues });

export function setDefault(control, value) {
  // const main = getControlName(control); // we cant do this because superdough is independent of strudel/core
  defaultDefaultValues[control] = value;
}

export function resetDefaults() {
  defaultDefaultValues = { ...defaultDefaultDefaultValues };
}

let defaultControls = new Map(Object.entries(defaultDefaultValues));

export function setDefaultValue(key, value) {
  defaultControls.set(key, value);
}
export function getDefaultValue(key) {
  return defaultControls.get(key);
}
export function setDefaultValues(defaultsobj) {
  Object.keys(defaultsobj).forEach((key) => {
    setDefaultValue(key, defaultsobj[key]);
  });
}
export function resetDefaultValues() {
  defaultControls = new Map(Object.entries(defaultDefaultValues));
}
export function setVersionDefaults(version) {
  resetDefaultValues();
  if (version === '1.0') {
    setDefaultValue('fanchor', 0.5);
  }
}


let externalWorklets = [];
export function registerWorklet(url) {
  externalWorklets.push(url);
}

let workletsLoading;
function loadWorklets() {
  if (!workletsLoading) {
    const audioCtx = getAudioContext();
    const allWorkletURLs = externalWorklets.concat([workletsUrl]);
    workletsLoading = Promise.all(allWorkletURLs.map((workletURL) => audioCtx.audioWorklet.addModule(workletURL)));
  }

  return workletsLoading;
}

// this function should be called on first user interaction (to avoid console warning)
export async function initAudio(options = {}) {
  console.log('[superdough] initAudio called with options:', options);
  const {
    disableWorklets = false,
    maxPolyphony,
    audioDeviceName = DEFAULT_AUDIO_DEVICE_NAME,
    multiChannelOrbits = false,
    audioContext, // Accept external AudioContext
  } = options;

  setMaxPolyphony(maxPolyphony);
  setMultiChannelOrbits(multiChannelOrbits);
  if (typeof window === 'undefined') {
    console.log('[superdough] window undefined, returning early');
    return;
  }

  // If an external AudioContext is provided, use it instead of creating a new one
  if (audioContext) {
    console.log('[superdough] Using provided AudioContext:', audioContext.state);
    setDefaultAudioContext(audioContext);
  }

  console.log('[superdough] Getting AudioContext...');
  const audioCtx = getAudioContext();
  console.log('[superdough] AudioContext state:', audioCtx.state);

  if (audioDeviceName != null && audioDeviceName != DEFAULT_AUDIO_DEVICE_NAME) {
    try {
      const devices = await getAudioDevices();
      const id = devices.get(audioDeviceName);
      const isValidID = (id ?? '').length > 0;
      if (audioCtx.sinkId !== id && isValidID) {
        await audioCtx.setSinkId(id);
      }
      logger(
        `[superdough] Audio Device set to ${audioDeviceName}, it might take a few seconds before audio plays on all output channels`,
      );
    } catch {
      logger('[superdough] failed to set audio interface', 'warning');
    }
  }

  // Don't block on resume() - it will resolve when user interaction happens
  // This allows initialization to complete even before user gesture
  console.log('[superdough] Calling audioCtx.resume() (non-blocking)...');
  audioCtx.resume().then(() => {
    console.log('[superdough] audioCtx.resume() completed, state:', audioCtx.state);
  }).catch((err) => {
    console.warn('[superdough] audioCtx.resume() failed:', err);
  });

  if (disableWorklets) {
    logger('[superdough]: AudioWorklets disabled with disableWorklets');
    return;
  }
  try {
    console.log('[superdough] Loading worklets...');
    console.log('[superdough] externalWorklets:', externalWorklets.length);
    console.log('[superdough] workletsUrl type:', typeof workletsUrl);
    await loadWorklets();
    console.log('[superdough] AudioWorklets loaded successfully');
    logger('[superdough] AudioWorklets loaded');
  } catch (err) {
    console.error('[superdough] Failed to load AudioWorklet effects:', err);
    console.warn('could not load AudioWorklet effects', err);
  }
  console.log('[superdough] initAudio completed');
  logger('[superdough] ready');
}
let audioReady;
export async function initAudioOnFirstClick(options) {
  if (!audioReady) {
    audioReady = new Promise((resolve) => {
      document.addEventListener('click', async function listener() {
        document.removeEventListener('click', listener);
        await initAudio(options);
        resolve();
      });
    });
  }
  return audioReady;
}

// Multiple controller support for routing to different destinations (e.g., Deck A/B)
const controllers = new Map();
let defaultController = null;

// Get the default controller (for backward compatibility)
function getSuperdoughAudioController() {
  if (defaultController == null) {
    defaultController = new SuperdoughAudioController(getAudioContext());
    controllers.set('default', defaultController);
  }
  return defaultController;
}

// Create a new controller with custom destination
export function createSuperdoughController(id, audioContext, customDestination) {
  const controller = new SuperdoughAudioController(audioContext, customDestination);
  controllers.set(id, controller);
  return controller;
}

// Get a specific controller by ID
export function getSuperdoughController(id) {
  return controllers.get(id);
}

// Get controller by ID, falling back to default
function getControllerById(controllerId) {
  if (controllerId && controllers.has(controllerId)) {
    return controllers.get(controllerId);
  }
  return getSuperdoughAudioController();
}

export function connectToDestination(input, channels) {
  const controller = getSuperdoughAudioController();
  controller.output.connectToDestination(input, channels);
}

function getPhaser(time, end, frequency = 1, depth = 0.5, centerFrequency = 1000, sweep = 2000) {
  const ac = getAudioContext();
  const lfoGain = getLfo(ac, time, end, { frequency, depth: sweep * 2 });

  //filters
  const numStages = 2; //num of filters in series
  let fOffset = 0;
  const filterChain = [];
  for (let i = 0; i < numStages; i++) {
    const filter = ac.createBiquadFilter();
    filter.type = 'notch';
    filter.gain.value = 1;
    filter.frequency.value = centerFrequency + fOffset;
    filter.Q.value = 2 - Math.min(Math.max(depth * 2, 0), 1.9);

    lfoGain.connect(filter.detune);
    fOffset += 282;
    if (i > 0) {
      filterChain[i - 1].connect(filter);
    }
    filterChain.push(filter);
  }
  return filterChain[filterChain.length - 1];
}

function getFilterType(ftype) {
  ftype = ftype ?? 0;
  const filterTypes = ['12db', 'ladder', '24db'];
  return typeof ftype === 'number' ? filterTypes[Math.floor(_mod(ftype, filterTypes.length))] : ftype;
}

export let analysers = {},
  analysersData = {};

export function getAnalyserById(id, fftSize = 1024, smoothingTimeConstant = 0.5) {
  if (!analysers[id]) {
    // make sure this doesn't happen too often as it piles up garbage
    const analyserNode = getAudioContext().createAnalyser();
    analyserNode.fftSize = fftSize;
    analyserNode.smoothingTimeConstant = smoothingTimeConstant;
    // getDestination().connect(analyserNode);
    analysers[id] = analyserNode;
    analysersData[id] = new Float32Array(analysers[id].frequencyBinCount);
  }
  if (analysers[id].fftSize !== fftSize) {
    analysers[id].fftSize = fftSize;
    analysersData[id] = new Float32Array(analysers[id].frequencyBinCount);
  }
  return analysers[id];
}

export function getAnalyzerData(type = 'time', id = 1) {
  const getter = {
    time: () => analysers[id]?.getFloatTimeDomainData(analysersData[id]),
    frequency: () => analysers[id]?.getFloatFrequencyData(analysersData[id]),
  }[type];
  if (!getter) {
    throw new Error(`getAnalyzerData: ${type} not supported. use one of ${Object.keys(getter).join(', ')}`);
  }
  getter();
  return analysersData[id];
}

export function resetGlobalEffects() {
  controller?.reset();
  analysers = {};
  analysersData = {};
}

let activeSoundSources = new Map();
//music programs/audio gear usually increments inputs/outputs from 1, we need to subtract 1 from the input because the webaudio API channels start at 0

function mapChannelNumbers(channels) {
  return (Array.isArray(channels) ? channels : [channels]).map((ch) => ch - 1);
}

export const superdough = async (value, t, hapDuration, cps = 0.5, cycle = 0.5, controllerId = null) => {
  // new: t is always expected to be the absolute target onset time
  const ac = getAudioContext();
  const audioController = getControllerById(controllerId);

  let { stretch } = value;
  if (stretch != null) {
    //account for phase vocoder latency
    const latency = 0.04;
    t = t - latency;
  }
  if (typeof value !== 'object') {
    throw new Error(
      `expected hap.value to be an object, but got "${value}". Hint: append .note() or .s() to the end`,
      'error',
    );
  }

  // duration is passed as value too..
  value.duration = hapDuration;
  // calculate absolute time

  if (t < ac.currentTime) {
    console.warn(
      `[superdough]: cannot schedule sounds in the past (target: ${t.toFixed(2)}, now: ${ac.currentTime.toFixed(2)})`,
    );
    return;
  }
  // destructure
  let {
    tremolo,
    tremolosync,
    tremolodepth = 1,
    tremoloskew,
    tremolophase = 0,
    tremoloshape,
    s = getDefaultValue('s'),
    bank,
    source,
    gain = getDefaultValue('gain'),
    postgain = getDefaultValue('postgain'),
    density = getDefaultValue('density'),
    duckorbit,
    duckonset,
    duckattack,
    duckdepth,
    djf,
    // filters
    fanchor = getDefaultValue('fanchor'),
    drive = 0.69,
    release = 0,
    // low pass
    cutoff,
    lpenv,
    lpattack,
    lpdecay,
    lpsustain,
    lprelease,
    resonance = getDefaultValue('resonance'),
    // high pass
    hpenv,
    hcutoff,
    hpattack,
    hpdecay,
    hpsustain,
    hprelease,
    hresonance = getDefaultValue('hresonance'),
    // band pass
    bpenv,
    bandf,
    bpattack,
    bpdecay,
    bpsustain,
    bprelease,
    bandq = getDefaultValue('bandq'),

    //phaser
    phaserrate: phaser,
    phaserdepth = getDefaultValue('phaserdepth'),
    phasersweep,
    phasercenter,
    //
    coarse,

    crush,
    dry,
    shape,
    shapevol = getDefaultValue('shapevol'),
    distort,
    distortvol = getDefaultValue('distortvol'),
    distorttype = getDefaultValue('distorttype'),
    pan,
    vowel,
    delay = getDefaultValue('delay'),
    delayfeedback = getDefaultValue('delayfeedback'),
    delaysync = getDefaultValue('delaysync'),
    delaytime,
    orbit = getDefaultValue('orbit'),
    room,
    roomfade,
    roomlp,
    roomdim,
    roomsize,
    ir,
    irspeed,
    irbegin,
    i = getDefaultValue('i'),
    velocity = getDefaultValue('velocity'),
    analyze, // analyser wet
    fft = getDefaultValue('fft'), // fftSize 0 - 10
    compressor: compressorThreshold,
    compressorRatio,
    compressorKnee,
    compressorAttack,
    compressorRelease,
  } = value;

  delaytime = delaytime ?? cycleToSeconds(delaysync, cps);

  const orbitChannels = mapChannelNumbers(
    multiChannelOrbits && orbit > 0 ? [orbit * 2 - 1, orbit * 2] : getDefaultValue('channels'),
  );

  const channels = value.channels != null ? mapChannelNumbers(value.channels) : orbitChannels;
  const orbitBus = audioController.getOrbit(orbit, channels);
  if (duckorbit != null) {
    audioController.duck(duckorbit, t, duckonset, duckattack, duckdepth);
  }

  gain = applyGainCurve(nanFallback(gain, 1));
  postgain = applyGainCurve(postgain);
  shapevol = applyGainCurve(shapevol);
  distortvol = applyGainCurve(distortvol);
  delay = applyGainCurve(delay);
  velocity = applyGainCurve(velocity);
  tremolodepth = applyGainCurve(tremolodepth);
  gain *= velocity; // velocity currently only multiplies with gain. it might do other things in the future

  const end = t + hapDuration;
  const endWithRelease = end + release;
  const chainID = Math.round(Math.random() * 1000000);

  // oldest audio nodes will be destroyed if maximum polyphony is exceeded
  for (let i = 0; i <= activeSoundSources.size - maxPolyphony; i++) {
    const ch = activeSoundSources.entries().next();
    const source = ch.value[1];
    const chainID = ch.value[0];
    const endTime = t + 0.25;
    source?.node?.gain?.linearRampToValueAtTime(0, endTime);
    source?.stop?.(endTime);
    activeSoundSources.delete(chainID);
  }

  let audioNodes = [];

  if (['-', '~', '_'].includes(s)) {
    return;
  }
  if (bank && s) {
    s = `${bank}_${s}`;
    value.s = s;
  }

  // get source AudioNode
  let sourceNode;
  if (source) {
    sourceNode = source(t, value, hapDuration, cps);
  } else if (getSound(s)) {
    const { onTrigger } = getSound(s);
    const onEnded = () => {
      audioNodes.forEach((n) => n?.disconnect());
      activeSoundSources.delete(chainID);
    };
    const soundHandle = await onTrigger(t, value, onEnded, cps);

    if (soundHandle) {
      sourceNode = soundHandle.node;
      activeSoundSources.set(chainID, soundHandle);
    }
  } else {
    throw new Error(`sound ${s} not found! Is it loaded?`);
  }
  if (!sourceNode) {
    // if onTrigger does not return anything, we will just silently skip
    // this can be used for things like speed(0) in the sampler
    return;
  }

  if (ac.currentTime > t) {
    logger('[webaudio] skip hap: still loading', ac.currentTime - t);
    return;
  }
  const chain = []; // audio nodes that will be connected to each other sequentially
  chain.push(sourceNode);
  stretch !== undefined && chain.push(getWorklet(ac, 'phase-vocoder-processor', { pitchFactor: stretch }));

  // gain stage
  chain.push(gainNode(gain));

  //filter
  const ftype = getFilterType(value.ftype);
  if (cutoff !== undefined) {
    let lp = () =>
      createFilter(
        ac,
        'lowpass',
        cutoff,
        resonance,
        lpattack,
        lpdecay,
        lpsustain,
        lprelease,
        lpenv,
        t,
        end,
        fanchor,
        ftype,
        drive,
      );
    chain.push(lp());
    if (ftype === '24db') {
      chain.push(lp());
    }
  }

  if (hcutoff !== undefined) {
    let hp = () =>
      createFilter(
        ac,
        'highpass',
        hcutoff,
        hresonance,
        hpattack,
        hpdecay,
        hpsustain,
        hprelease,
        hpenv,
        t,
        end,
        fanchor,
      );
    chain.push(hp());
    if (ftype === '24db') {
      chain.push(hp());
    }
  }

  if (bandf !== undefined) {
    let bp = () =>
      createFilter(ac, 'bandpass', bandf, bandq, bpattack, bpdecay, bpsustain, bprelease, bpenv, t, end, fanchor);
    chain.push(bp());
    if (ftype === '24db') {
      chain.push(bp());
    }
  }

  if (vowel !== undefined) {
    const vowelFilter = ac.createVowelFilter(vowel);
    chain.push(vowelFilter);
  }

  // effects
  coarse !== undefined && chain.push(getWorklet(ac, 'coarse-processor', { coarse }));
  crush !== undefined && chain.push(getWorklet(ac, 'crush-processor', { crush }));
  shape !== undefined && chain.push(getWorklet(ac, 'shape-processor', { shape, postgain: shapevol }));
  distort !== undefined && chain.push(getDistortion(distort, distortvol, distorttype));

  if (tremolosync != null) {
    tremolo = cps * tremolosync;
  }

  if (value.wtPosSynced != null) {
    value.wtPosRate /= cps;
  }

  if (value.wtWarpSynced != null) {
    value.wtWarpRate /= cps;
  }

  if (tremolo !== undefined) {
    // Allow clipping of modulator for more dynamic possiblities, and to prevent speaker overload
    // EX:  a triangle waveform will clip like this /-\ when the depth is above 1
    const gain = Math.max(1 - tremolodepth, 0);
    const amGain = new GainNode(ac, { gain });

    const time = cycle / cps;
    const lfo = getLfo(ac, t, endWithRelease, {
      skew: tremoloskew ?? (tremoloshape != null ? 0.5 : 1),
      frequency: tremolo,
      depth: tremolodepth,
      time,
      dcoffset: 0,
      shape: tremoloshape,
      phaseoffset: tremolophase,
      min: 0,
      max: 1,
      curve: 1.5,
    });
    lfo.connect(amGain.gain);
    chain.push(amGain);
  }

  compressorThreshold !== undefined &&
    chain.push(
      getCompressor(ac, compressorThreshold, compressorRatio, compressorKnee, compressorAttack, compressorRelease),
    );

  // panning
  if (pan !== undefined) {
    const panner = ac.createStereoPanner();
    panner.pan.value = 2 * pan - 1;
    chain.push(panner);
  }
  // phaser
  if (phaser !== undefined && phaserdepth > 0) {
    const phaserFX = getPhaser(t, endWithRelease, phaser, phaserdepth, phasercenter, phasersweep);
    chain.push(phaserFX);
  }

  // last gain
  const post = new GainNode(ac, { gain: postgain });
  chain.push(post);

  // delay
  if (delay > 0 && delaytime > 0 && delayfeedback > 0) {
    orbitBus.getDelay(delaytime, delayfeedback, t);
    orbitBus.sendDelay(post, delay);
  }
  // reverb
  if (room > 0) {
    let roomIR;
    if (ir !== undefined) {
      let url;
      let sample = getSound(ir);
      if (Array.isArray(sample)) {
        url = sample.data.samples[i % sample.data.samples.length];
      } else if (typeof sample === 'object') {
        url = Object.values(sample.data.samples).flat()[i % Object.values(sample.data.samples).length];
      }
      roomIR = await loadBuffer(url, ac, ir, 0);
    }
    orbitBus.getReverb(roomsize, roomfade, roomlp, roomdim, roomIR, irspeed, irbegin);
    orbitBus.sendReverb(post, room);
  }

  if (djf != null) {
    orbitBus.getDjf(djf, t);
  }

  // analyser
  if (analyze) {
    const analyserNode = getAnalyserById(analyze, 2 ** (fft + 5));
    const analyserSend = effectSend(post, analyserNode, 1);
    audioNodes.push(analyserSend);
  }
  if (dry != null) {
    dry = applyGainCurve(dry);
    const dryGain = new GainNode(ac, { gain: dry });
    chain.push(dryGain);
    orbitBus.connectToOutput(dryGain);
  } else {
    orbitBus.connectToOutput(post);
  }

  // connect chain elements together
  chain.slice(1).reduce((last, current) => last.connect(current), chain[0]);
  audioNodes = audioNodes.concat(chain);
};

export const superdoughTrigger = (t, hap, ct, cps, controllerId = null) => {
  superdough(hap, t - ct, hap.duration / cps, cps, 0.5, controllerId);
};
