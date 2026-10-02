import 'symbol-observable';

import { SETTINGSMAN, type Settings } from './SettingsManager';
import { App } from './view/components/App';
import { AudioDestinationRouter } from './audio/AudioDestinationRouter';
import { CueMixer } from './audio/CueMixer';
import { MIDIMAN } from './MIDIManager';
import { Mixer } from './audio/Mixer';
import { Reverb } from './audio/Reverb';
import { WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { createRoot } from 'react-dom/client';
import { Recorder } from './audio/Recorder';
import { WavRecorderNode } from './audio/WavRecorderNode';
import { FullscreenManager } from './FullscreenManager';
import { TimeDomainDataProbeNode } from './audio/TimeDomainDataProbeNode';
import { DCRemovalNode } from './audio/DCRemovalNode';
import { HardClipNode } from './audio/HardClipNode';
import { FrameEmitter } from './FrameEmitter';
import { FirstOrderFilterNode } from './audio/FirstOrderFilterNode';
import { StorageManager } from './StorageManager';
import { loadFileAsImage } from './utils/loadFileAsImage';
import { pathToAssetName } from './utils/pathToAssetName';
import { LookaheadLimiterNode } from './audio/LookaheadLimiterNode';
import { DeckRenderGate } from './audio/DeckRenderGate';
import { DeckSourceSwitch, type DeckSourceMode } from './audio/DeckSourceSwitch';
import { TickNode } from './audio/TickNode';
import { StrudelEngine } from './strudel/StrudelEngine';
import { StrudelDeck } from './strudel/StrudelDeck';
import { type LiveBridge } from './live/LiveBridge';
import './index.css';

// == setup ========================================================================================
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2')!;

const audio = new AudioContext();
audio.suspend();

// install audio worklet modules
await TimeDomainDataProbeNode.addModule(audio);
await DCRemovalNode.addModule(audio);
await HardClipNode.addModule(audio);
await LookaheadLimiterNode.addModule(audio);
await FirstOrderFilterNode.addModule(audio);
await WavRecorderNode.addModule(audio);
await TickNode.addModule(audio);

const master = audio.createGain();

const deckOptions = {
  gl,
  audio,
  latencyBlocks: 32,
};
const deckA = new WavenerdDeck(deckOptions);
const deckB = new WavenerdDeck({ ...deckOptions, hostDeck: deckA });
const mixer = new Mixer(audio);

// strudel
// `?strudelDev&strudelOffline` starts without the network. must be installed before the engine loads the sounds
const strudelDevEnabled = new URLSearchParams(location.search).has('strudelDev');
const strudelOfflineSwitch = strudelDevEnabled
  ? (await import('./strudel/dev/offlineSwitch')).installStrudelOfflineSwitch(
      new URLSearchParams(location.search).has('strudelOffline'),
    )
  : null;

const strudelEngine = new StrudelEngine({ audio, hostDeck: deckA });
const strudelDeckA = new StrudelDeck({ engine: strudelEngine, id: 'deckA' });
const strudelDeckB = new StrudelDeck({ engine: strudelEngine, id: 'deckB' });

// each slot plays either GLSL or Strudel
const sourceSwitchA = new DeckSourceSwitch(audio);
deckA.node.connect(sourceSwitchA.inputGlsl);
strudelDeckA.output.connect(sourceSwitchA.inputStrudel);
sourceSwitchA.output.connect(mixer.inputA);

const sourceSwitchB = new DeckSourceSwitch(audio);
deckB.node.connect(sourceSwitchB.inputGlsl);
strudelDeckB.output.connect(sourceSwitchB.inputStrudel);
sourceSwitchB.output.connect(mixer.inputB);

interface DeckSlot {
  mode: DeckSourceMode;
  renderGate: DeckRenderGate;
  sourceSwitch: DeckSourceSwitch;
  strudelDeck: StrudelDeck;
  strudelStopTimer: ReturnType<typeof setTimeout> | null;
}

const slotA: DeckSlot = {
  mode: 'glsl',
  renderGate: new DeckRenderGate(deckA),
  sourceSwitch: sourceSwitchA,
  strudelDeck: strudelDeckA,
  strudelStopTimer: null,
};
const slotB: DeckSlot = {
  mode: 'glsl',
  renderGate: new DeckRenderGate(deckB),
  sourceSwitch: sourceSwitchB,
  strudelDeck: strudelDeckB,
  strudelStopTimer: null,
};

/**
 * The GLSL deck keeps updating in the Strudel mode, since its BeatManager is the clock.
 * Only its rendering stops.
 */
function setDeckMode(slot: DeckSlot, mode: DeckSourceMode) {
  // settings are applied again on unrelated changes
  if (slot.mode === mode) { return; }
  slot.mode = mode;

  const { renderGate, sourceSwitch, strudelDeck } = slot;

  if (slot.strudelStopTimer != null) {
    clearTimeout(slot.strudelStopTimer);
    slot.strudelStopTimer = null;
  }

  if (mode === 'strudel') {
    renderGate.disable();
    sourceSwitch.setMode('strudel');
    strudelDeck.active = true;
    return;
  }

  // The GLSL deck has silence buffered. Keep Strudel playing until the rendered sound comes out.
  renderGate.enable((time) => {
    sourceSwitch.setMode('glsl', time);

    slot.strudelStopTimer = setTimeout(() => {
      slot.strudelStopTimer = null;
      strudelDeck.active = false;
    }, Math.max(0.0, time - audio.currentTime) * 1000.0);
  });
}

const reverb = new Reverb(audio);
mixer.output.connect(reverb.input);
reverb.connect(master);

const cueMixer = new CueMixer(audio);
mixer.channelA.outputForAnal.connect(cueMixer.inputA);
mixer.channelB.outputForAnal.connect(cueMixer.inputB);
master.connect(cueMixer.inputMaster);

const masterGain = audio.createGain();
master.connect(masterGain);

const recorder = new Recorder(audio);
masterGain.connect(recorder.input);

const router = new AudioDestinationRouter(audio);

router.addSource('master', masterGain);
router.addSource('cue', cueMixer.output);
router.addSource('deckA', sourceSwitchA.output);
router.addSource('deckB', sourceSwitchB.output);

// == updates ======================================================================================
let isUpdatingAudio = false;

async function updateAudio() {
  // `WavenerdDeck.update()` must not overlap itself
  if (isUpdatingAudio) { return; }
  isUpdatingAudio = true;

  try {
    await Promise.all([
      deckA.update(),
      deckB.update(),
    ]);
  } finally {
    isUpdatingAudio = false;
  }
}

async function updateAudioLoop() {
  await updateAudio();

  setTimeout(updateAudioLoop);
}
updateAudioLoop();

// Timers are throttled to once per second when the tab is hidden and silent for a while.
// Ticks from the audio thread keep the decks going in that case.
const tickNode = new TickNode(audio);
tickNode.onTick(() => {
  updateAudio();
  strudelDeckA.poke();
  strudelDeckB.poke();
});

const frameEmitter = new FrameEmitter();

frameEmitter.on('update', ({ deltaTime }) => {
  mixer.updateAnalysers(deltaTime);
});

// == storage ======================================================================================
const storageManager = new StorageManager();
await storageManager.init();

async function handleUpdateStorage(path: string) {
  const name = pathToAssetName(path);

  if (path.startsWith('samples/')) {
    const file = await storageManager.getFile(path);
    const buffer = await file?.arrayBuffer();
    if (buffer == null) {
      console.error(`Failed to load sample: ${path}`);
    } else {
      // before the GLSL deck, in case it detaches the buffer by decoding it
      strudelEngine.userSamples.set(name, buffer);
      deckA.loadSample(name, buffer);
    }
  } else if (path.startsWith('wavetables/')) {
    const file = await storageManager.getFile(path);
    const buffer = await file?.arrayBuffer();
    if (buffer == null) {
      console.error(`Failed to load wavetable: ${path}`);
    } else {
      strudelEngine.userWavetables.set(name, buffer);
      deckA.loadWavetable(name, new Float32Array(buffer));
    }
  } else if (path.startsWith('images/')) {
    const file = await storageManager.getFile(path);
    if (file == null) {
      console.error(`Failed to load image: ${path}`);
    } else {
      const image = await loadFileAsImage(file);
      deckA.loadImage(name, image);
    }
  }
}

function handleDeleteStorage(path: string) {
  const name = pathToAssetName(path);

  if (path.startsWith('samples/')) {
    deckA.deleteSample(name);
    strudelEngine.userSamples.delete(name);
  } else if (path.startsWith('wavetables/')) {
    deckA.deleteWavetable(name);
    strudelEngine.userWavetables.delete(name);
  } else if (path.startsWith('images/')) {
    deckA.deleteImage(name);
  }
}

async function handleInitStorage() {
  const list = await storageManager.listFilesRecursive('');
  for (const path of list || []) {
    handleUpdateStorage(path);
  }
}
handleInitStorage();

storageManager.on('init', handleInitStorage);
storageManager.on('save', ({ path }) => handleUpdateStorage(path));
storageManager.on('delete', ({ path }) => handleDeleteStorage(path));

// == midi =========================================================================================
function applyMidiParam({ paramKey, value }: { paramKey: string; value: number }) {
  if (paramKey === '/mixer/xfader_pos') { mixer.xFaderPos = value; }

  if (paramKey === '/mixer/channel_a/gain') { mixer.channelA.gain = 4.0 * value * value; }
  if (paramKey === '/mixer/channel_a/eq/high') { mixer.channelA.eq.high = 2.0 * value; }
  if (paramKey === '/mixer/channel_a/eq/mid') { mixer.channelA.eq.mid = 2.0 * value; }
  if (paramKey === '/mixer/channel_a/eq/low') { mixer.channelA.eq.low = 2.0 * value; }
  if (paramKey === '/mixer/channel_a/filter') { mixer.channelA.filter.filter = value; }
  if (paramKey === '/mixer/channel_a/volume') { mixer.channelA.volume = value * value; }

  if (paramKey === '/mixer/channel_b/gain') { mixer.channelB.gain = 4.0 * value * value; }
  if (paramKey === '/mixer/channel_b/eq/high') { mixer.channelB.eq.high = 2.0 * value; }
  if (paramKey === '/mixer/channel_b/eq/mid') { mixer.channelB.eq.mid = 2.0 * value; }
  if (paramKey === '/mixer/channel_b/eq/low') { mixer.channelB.eq.low = 2.0 * value; }
  if (paramKey === '/mixer/channel_b/filter') { mixer.channelB.filter.filter = value; }
  if (paramKey === '/mixer/channel_b/volume') { mixer.channelB.volume = value * value; }

  if (paramKey === '/mixer/master/reverb/mix') { reverb.mix = value; }
  if (paramKey === '/mixer/master/volume') { masterGain.gain.value = value * value; }

  if (paramKey === '/cue/channel_a') { cueMixer.gainA = value * value; }
  if (paramKey === '/cue/channel_b') { cueMixer.gainB = value * value; }
  if (paramKey === '/cue/master_mix') { cueMixer.masterMix = value * value; }

  if (paramKey === '/deck_a/knob0') { deckA.setParam('knob0', value); }
  if (paramKey === '/deck_a/knob1') { deckA.setParam('knob1', value); }
  if (paramKey === '/deck_a/knob2') { deckA.setParam('knob2', value); }
  if (paramKey === '/deck_a/knob3') { deckA.setParam('knob3', value); }
  if (paramKey === '/deck_a/knob4') { deckA.setParam('knob4', value); }
  if (paramKey === '/deck_a/knob5') { deckA.setParam('knob5', value); }
  if (paramKey === '/deck_a/knob6') { deckA.setParam('knob6', value); }
  if (paramKey === '/deck_a/knob7') { deckA.setParam('knob7', value); }

  if (paramKey === '/deck_b/knob0') { deckB.setParam('knob0', value); }
  if (paramKey === '/deck_b/knob1') { deckB.setParam('knob1', value); }
  if (paramKey === '/deck_b/knob2') { deckB.setParam('knob2', value); }
  if (paramKey === '/deck_b/knob3') { deckB.setParam('knob3', value); }
  if (paramKey === '/deck_b/knob4') { deckB.setParam('knob4', value); }
  if (paramKey === '/deck_b/knob5') { deckB.setParam('knob5', value); }
  if (paramKey === '/deck_b/knob6') { deckB.setParam('knob6', value); }
  if (paramKey === '/deck_b/knob7') { deckB.setParam('knob7', value); }

  // Strudel decks share the knobs of their slot, whichever mode is active
  const strudelKnob = /^\/deck_([ab])\/(knob[0-7])$/.exec(paramKey);
  if (strudelKnob != null) {
    const strudelDeck = strudelKnob[1] === 'a' ? strudelDeckA : strudelDeckB;
    strudelDeck.setParam(strudelKnob[2], value);
  }
}

MIDIMAN.on('initStorage', () => {
  for (const [paramKey, value] of Object.entries(MIDIMAN.values)) {
    applyMidiParam({ paramKey, value });
  }
});
MIDIMAN.on('paramChange', ({ paramKey, value }) => applyMidiParam({ paramKey, value }));

await MIDIMAN.initStorage(storageManager);

// == settings =====================================================================================
function applySettings(settings: Partial<Settings>) {
  if (settings.channelRouting != null) {
    router.setRouting(settings.channelRouting);
  }

  if (settings.blocksPerRender != null) {
    deckA.blocksPerRender = settings.blocksPerRender;
    deckB.blocksPerRender = settings.blocksPerRender;
  }

  if (settings.latencyBlocks != null) {
    deckA.latencyBlocks = settings.latencyBlocks;
    deckB.latencyBlocks = settings.latencyBlocks;
  }

  if (settings.deckAMode != null) {
    setDeckMode(slotA, settings.deckAMode);
  }

  if (settings.deckBMode != null) {
    setDeckMode(slotB, settings.deckBMode);
  }

  if (settings.masterDCRemoval != null) {
    mixer.dcRemoval = settings.masterDCRemoval;
  }

  if (settings.masterLimiterMode != null) {
    mixer.masterLimiterMode = settings.masterLimiterMode;
  }

  if (settings.eqMode != null) {
    mixer.channelA.replaceEQ(settings.eqMode);
    mixer.channelB.replaceEQ(settings.eqMode);
  }

  if (settings.filterMode != null) {
    mixer.channelA.replaceFilter(settings.filterMode);
    mixer.channelB.replaceFilter(settings.filterMode);
  }
}

SETTINGSMAN.on('initStorage', () => {
  applySettings(SETTINGSMAN.values);
});
SETTINGSMAN.on('change', (settings) => applySettings(settings));

await SETTINGSMAN.initStorage(storageManager);

// == fullscreen ===================================================================================
const fullscreenManager = new FullscreenManager();

document.addEventListener('keydown', (event) => {
  if (event.key === 'F11') {
    event.preventDefault();
    fullscreenManager.requestFullscreen();
  }
});

// == strudel dev tools ============================================================================
if (strudelOfflineSwitch != null) {
  const { installStrudelDevTools } = await import('./strudel/dev/strudelDevTools');
  await installStrudelDevTools({
    audio,
    deckA,
    deckB,
    strudelDeckA,
    strudelDeckB,
    sourceSwitchA,
    sourceSwitchB,
    offlineSwitch: strudelOfflineSwitch,
    frameEmitter,
  });
}

// == live bridge ==================================================================================
// the files of `live/` for coding agents. needs the dev server (`vite/liveBridge.ts`)
let liveBridge: LiveBridge | null = null;
if (import.meta.hot) {
  const { LiveBridge } = await import('./live/LiveBridge');
  liveBridge = new LiveBridge({
    hot: import.meta.hot,
    decks: { a: strudelDeckA, b: strudelDeckB },
    hostDeck: deckA,
    mixer,
  });
}

// == render =======================================================================================
const root = createRoot(document.getElementById('root')!);
root.render(
  <App
    stuff={{
      deckA,
      deckB,
      hostDeck: deckA,
      strudelDeckA,
      strudelDeckB,
      mixer,
      recorder,
      router,
      storageManager,
      fullscreenManager,
      frameEmitter,
      liveBridge,
    }}
  />,
);
