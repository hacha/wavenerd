import { map } from 'nanostores';

if (typeof DelayNode !== 'undefined') {
  class FeedbackDelayNode extends DelayNode {
    constructor(ac, wet, time, feedback) {
      super(ac);
      wet = Math.abs(wet);
      this.delayTime.value = time;

      const feedbackGain = ac.createGain();
      feedbackGain.gain.value = Math.min(Math.abs(feedback), 0.995);
      this.feedback = feedbackGain.gain;

      const delayGain = ac.createGain();
      delayGain.gain.value = wet;
      this.delayGain = delayGain;

      this.connect(feedbackGain);
      this.connect(delayGain);
      feedbackGain.connect(this);

      this.connect = (target) => delayGain.connect(target);
      return this;
    }
    start(t) {
      this.delayGain.gain.setValueAtTime(this.delayGain.gain.value, t + this.delayTime.value);
    }
  }

  AudioContext.prototype.createFeedbackDelay = function (wet, time, feedback) {
    return new FeedbackDelayNode(this, wet, time, feedback);
  };
}

// Copyright 2014 Alan deLespinasse
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var reverbGen = {};

/** Generates a reverb impulse response.

 @param {!Object} params TODO: Document the properties.
 @param {!function(!AudioBuffer)} callback Function to call when
  the impulse response has been generated. The impulse response
  is passed to this function as its parameter. May be called
  immediately within the current execution context, or later. */
reverbGen.generateReverb = function (params, callback) {
  var audioContext = params.audioContext || new AudioContext();
  var sampleRate = audioContext.sampleRate;
  var numChannels = params.numChannels || 2;
  // params.decayTime is the -60dB fade time. We let it go 50% longer to get to -90dB.
  var totalTime = params.decayTime * 1.5;
  var decaySampleFrames = Math.round(params.decayTime * sampleRate);
  var numSampleFrames = Math.round(totalTime * sampleRate);
  var fadeInSampleFrames = Math.round((params.fadeInTime || 0) * sampleRate);
  // 60dB is a factor of 1 million in power, or 1000 in amplitude.
  var decayBase = Math.pow(1 / 1000, 1 / decaySampleFrames);
  var reverbIR = audioContext.createBuffer(numChannels, numSampleFrames, sampleRate);
  for (var i = 0; i < numChannels; i++) {
    var chan = reverbIR.getChannelData(i);
    for (var j = 0; j < numSampleFrames; j++) {
      chan[j] = randomSample() * Math.pow(decayBase, j);
    }
    for (var j = 0; j < fadeInSampleFrames; j++) {
      chan[j] *= j / fadeInSampleFrames;
    }
  }

  applyGradualLowpass(reverbIR, params.lpFreqStart || 0, params.lpFreqEnd || 0, params.decayTime, callback);
};

/** Creates a canvas element showing a graph of the given data.


 @param {!Float32Array} data An array of numbers, or a Float32Array.
 @param {number} width Width in pixels of the canvas.
 @param {number} height Height in pixels of the canvas.
 @param {number} min Minimum value of data for the graph (lower edge).
 @param {number} max Maximum value of data in the graph (upper edge).
 @return {!CanvasElement} The generated canvas element. */
reverbGen.generateGraph = function (data, width, height, min, max) {
  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  var gc = canvas.getContext('2d');
  gc.fillStyle = '#000';
  gc.fillRect(0, 0, canvas.width, canvas.height);
  gc.fillStyle = '#fff';
  var xscale = width / data.length;
  var yscale = height / (max - min);
  for (var i = 0; i < data.length; i++) {
    gc.fillRect(i * xscale, height - (data[i] - min) * yscale, 1, 1);
  }
  return canvas;
};

/** Applies a constantly changing lowpass filter to the given sound.

 @private
 @param {!AudioBuffer} input
 @param {number} lpFreqStart
 @param {number} lpFreqEnd
 @param {number} lpFreqEndAt
 @param {!function(!AudioBuffer)} callback May be called
  immediately within the current execution context, or later.*/
var applyGradualLowpass = function (input, lpFreqStart, lpFreqEnd, lpFreqEndAt, callback) {
  if (lpFreqStart == 0) {
    callback(input);
    return;
  }
  var channelData = getAllChannelData(input);
  var context = new OfflineAudioContext(input.numberOfChannels, channelData[0].length, input.sampleRate);
  var player = context.createBufferSource();
  player.buffer = input;
  var filter = context.createBiquadFilter();

  lpFreqStart = Math.min(lpFreqStart, input.sampleRate / 2);
  lpFreqEnd = Math.min(lpFreqEnd, input.sampleRate / 2);

  filter.type = 'lowpass';
  filter.Q.value = 0.0001;
  filter.frequency.setValueAtTime(lpFreqStart, 0);
  filter.frequency.linearRampToValueAtTime(lpFreqEnd, lpFreqEndAt);

  player.connect(filter);
  filter.connect(context.destination);
  player.start();
  context.oncomplete = function (event) {
    callback(event.renderedBuffer);
  };
  context.startRendering();

  window.filterNode = filter;
};

/** @private
 @param {!AudioBuffer} buffer
 @return {!Array.<!Float32Array>} An array containing the Float32Array of each channel's samples. */
var getAllChannelData = function (buffer) {
  var channels = [];
  for (var i = 0; i < buffer.numberOfChannels; i++) {
    channels[i] = buffer.getChannelData(i);
  }
  return channels;
};

/** @private
 @return {number} A random number from -1 to 1. */
var randomSample = function () {
  return Math.random() * 2 - 1;
};

let log = (msg) => console.log(msg);

function errorLogger(e, origin = 'superdough') {
  logger(`[${origin}] error: ${e.message}`);
}

const logger = (...args) => log(...args);

const setLogger = (fn) => {
  log = fn;
};

// currently duplicate with core util.mjs to skip dependency
// TODO: add separate util module?

const tokenizeNote = (note) => {
  if (typeof note !== 'string') {
    return [];
  }
  const [pc, acc = '', oct] = note.match(/^([a-gA-G])([#bsf]*)(-?[0-9]*)$/)?.slice(1) || [];
  if (!pc) {
    return [];
  }
  return [pc, acc, oct ? Number(oct) : undefined];
};
const chromas = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const accs = { '#': 1, b: -1, s: 1, f: -1 };

const noteToMidi = (note, defaultOctave = 3) => {
  const [pc, acc, oct = defaultOctave] = tokenizeNote(note);
  if (!pc) {
    throw new Error('not a note: "' + note + '"');
  }
  const chroma = chromas[pc.toLowerCase()];
  const offset = acc?.split('').reduce((o, char) => o + accs[char], 0) || 0;
  return (Number(oct) + 1) * 12 + chroma + offset;
};
const midiToFreq = (n) => {
  return Math.pow(2, (n - 69) / 12) * 440;
};
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

const freqToMidi = (freq) => {
  return (12 * Math.log(freq / 440)) / Math.LN2 + 69;
};

const valueToMidi = (value, fallbackValue) => {
  if (typeof value !== 'object') {
    throw new Error('valueToMidi: expected object value');
  }
  let { freq, note } = value;
  if (typeof freq === 'number') {
    return freqToMidi(freq);
  }
  if (typeof note === 'string') {
    return noteToMidi(note);
  }
  if (typeof note === 'number') {
    return note;
  }
  if (!fallbackValue) {
    throw new Error('valueToMidi: expected freq or note to be set');
  }
  return fallbackValue;
};

function nanFallback(value, fallback = 0, silent) {
  if (isNaN(Number(value))) {
    !silent && logger(`"${value}" is not a number, falling back to ${fallback}`, 'warning');
    return fallback;
  }
  return value;
}
// modulo that works with negative numbers e.g. _mod(-1, 3) = 2. Works on numbers (rather than patterns of numbers, as @mod@ from pattern.mjs does)
const _mod$1 = (n, m) => ((n % m) + m) % m;

// round to nearest int, negative numbers will output a subtracted index
const getSoundIndex = (n, numSounds) => {
  return _mod$1(Math.round(nanFallback(n, 0)), numSounds);
};

function cycleToSeconds(cycle, cps) {
  return cycle / cps;
}

// deduces relevant info for sample loading from hap.value and sample definition
// it encapsulates the core sampler logic into a pure and synchronous function
// hapValue: Hap.value, bank: sample bank definition for sound "s" (values in strudel.json format)
function getCommonSampleInfo(hapValue, bank) {
  const { s, n = 0 } = hapValue;
  let midi = valueToMidi(hapValue, 36);
  let transpose = midi - 36; // C3 is middle C;
  let url;
  let index = 0;
  if (Array.isArray(bank)) {
    index = getSoundIndex(n, bank.length);
    url = bank[index];
  } else {
    const midiDiff = (noteA) => noteToMidi(noteA) - midi;
    // object format will expect keys as notes
    const closest = Object.keys(bank)
      .filter((k) => !k.startsWith('_'))
      .reduce(
        (closest, key, j) => (!closest || Math.abs(midiDiff(key)) < Math.abs(midiDiff(closest)) ? key : closest),
        null,
      );
    transpose = -midiDiff(closest); // semitones to repitch
    index = getSoundIndex(n, bank[closest].length);
    url = bank[closest][index];
  }
  const label = `${s}:${index}`;
  return { transpose, url, index, midi, label };
}

if (typeof AudioContext !== 'undefined') {
  AudioContext.prototype.adjustLength = function (duration, buffer, speed = 1, offsetAmount = 0) {
    const sampleOffset = Math.floor(clamp(offsetAmount, 0, 1) * buffer.length);
    const newLength = buffer.sampleRate * duration;
    const newBuffer = this.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      let oldData = buffer.getChannelData(channel);
      let newData = newBuffer.getChannelData(channel);

      for (let i = 0; i < newLength; i++) {
        // loop the buffer around to prevent
        let position = (sampleOffset + i * Math.abs(speed)) % oldData.length;
        if (speed < 1) {
          position = position * -1;
        }

        newData[i] = oldData.at(position) || 0;
      }
    }
    return newBuffer;
  };

  AudioContext.prototype.createReverb = function (duration, fade, lp, dim, ir, irspeed, irbegin) {
    const convolver = this.createConvolver();
    convolver.generate = (d = 2, fade = 0.1, lp = 15000, dim = 1000, ir, irspeed, irbegin) => {
      convolver.duration = d;
      convolver.fade = fade;
      convolver.lp = lp;
      convolver.dim = dim;
      convolver.ir = ir;
      convolver.irspeed = irspeed;
      convolver.irbegin = irbegin;
      if (ir) {
        convolver.buffer = this.adjustLength(d, ir, irspeed, irbegin);
      } else {
        reverbGen.generateReverb(
          {
            audioContext: this,
            numChannels: 2,
            decayTime: d,
            fadeInTime: fade,
            lpFreqStart: lp,
            lpFreqEnd: dim,
          },
          (buffer) => {
            convolver.buffer = buffer;
          },
        );
      }
    };
    convolver.generate(duration, fade, lp, dim, ir, irspeed, irbegin);
    return convolver;
  };
}

// credits to webdirt: https://github.com/dktr0/WebDirt/blob/41342e81d6ad694a2310d491fef7b7e8b0929efe/js-src/Graph.js#L597
var vowelFormant = {
  a: { freqs: [660, 1120, 2750, 3000, 3350], gains: [1, 0.5012, 0.0708, 0.0631, 0.0126], qs: [80, 90, 120, 130, 140] },
  e: { freqs: [440, 1800, 2700, 3000, 3300], gains: [1, 0.1995, 0.1259, 0.1, 0.1], qs: [70, 80, 100, 120, 120] },
  i: { freqs: [270, 1850, 2900, 3350, 3590], gains: [1, 0.0631, 0.0631, 0.0158, 0.0158], qs: [40, 90, 100, 120, 120] },
  o: { freqs: [430, 820, 2700, 3000, 3300], gains: [1, 0.3162, 0.0501, 0.0794, 0.01995], qs: [40, 80, 100, 120, 120] },
  u: { freqs: [370, 630, 2750, 3000, 3400], gains: [1, 0.1, 0.0708, 0.0316, 0.01995], qs: [40, 60, 100, 120, 120] },
  ae: { freqs: [650, 1515, 2400, 3000, 3350], gains: [1, 0.5, 0.1008, 0.0631, 0.0126], qs: [80, 90, 120, 130, 140] },
  aa: { freqs: [560, 900, 2570, 3000, 3300], gains: [1, 0.5, 0.0708, 0.0631, 0.0126], qs: [80, 90, 120, 130, 140] },
  oe: { freqs: [500, 1430, 2300, 3000, 3300], gains: [1, 0.2, 0.0708, 0.0316, 0.01995], qs: [40, 60, 100, 120, 120] },
  ue: { freqs: [250, 1750, 2150, 3200, 3300], gains: [1, 0.1, 0.0708, 0.0316, 0.01995], qs: [40, 60, 100, 120, 120] },
  y: { freqs: [400, 1460, 2400, 3000, 3300], gains: [1, 0.2, 0.0708, 0.0316, 0.02995], qs: [40, 60, 100, 120, 120] },
  uh: { freqs: [600, 1250, 2100, 3100, 3500], gains: [1, 0.3, 0.0608, 0.0316, 0.01995], qs: [40, 70, 100, 120, 130] },
  un: { freqs: [500, 1240, 2280, 3000, 3500], gains: [1, 0.1, 0.1708, 0.0216, 0.02995], qs: [40, 60, 100, 120, 120] },
  en: { freqs: [600, 1480, 2450, 3200, 3300], gains: [1, 0.15, 0.0708, 0.0316, 0.02995], qs: [40, 60, 100, 120, 120] },
  an: { freqs: [700, 1050, 2500, 3000, 3300], gains: [1, 0.1, 0.0708, 0.0316, 0.02995], qs: [40, 60, 100, 120, 120] },
  on: { freqs: [500, 1080, 2350, 3000, 3300], gains: [1, 0.1, 0.0708, 0.0316, 0.02995], qs: [40, 60, 100, 120, 120] },
  get æ() {
    return this.ae;
  },
  get ø() {
    return this.oe;
  },
  get ɑ() {
    return this.aa;
  },
  get å() {
    return this.aa;
  },
  get ö() {
    return this.oe;
  },
  get ü() {
    return this.ue;
  },
  get ı() {
    return this.y;
  },
};
if (typeof GainNode !== 'undefined') {
  class VowelNode extends GainNode {
    constructor(ac, letter) {
      super(ac);
      if (!vowelFormant[letter]) {
        throw new Error('vowel: unknown vowel ' + letter);
      }
      const { gains, qs, freqs } = vowelFormant[letter];
      const makeupGain = ac.createGain();
      for (let i = 0; i < 5; i++) {
        const gain = ac.createGain();
        gain.gain.value = gains[i];
        const filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = qs[i];
        filter.frequency.value = freqs[i];
        this.connect(filter);
        filter.connect(gain);
        gain.connect(makeupGain);
      }
      makeupGain.gain.value = 8; // how much makeup gain to add?
      this.connect = (target) => makeupGain.connect(target);
      return this;
    }
  }

  AudioContext.prototype.createVowelFilter = function (letter) {
    return new VowelNode(this, letter);
  };
}

var workletsUrl = "data:text/javascript;base64,dmFyIFRlPU9iamVjdC5kZWZpbmVQcm9wZXJ0eTt2YXIgeWU9KEUsRCxXKT0+RCBpbiBFP1RlKEUsRCx7ZW51bWVyYWJsZTohMCxjb25maWd1cmFibGU6ITAsd3JpdGFibGU6ITAsdmFsdWU6V30pOkVbRF09Vzt2YXIgU3Q9KEUsRCxXKT0+KHllKEUsdHlwZW9mIEQhPSJzeW1ib2wiP0QrIiI6RCxXKSxXKTt2YXIgXz1mdW5jdGlvbihFKXsidXNlIHN0cmljdCI7Y2xhc3MgVyBleHRlbmRzIEF1ZGlvV29ya2xldFByb2Nlc3Nvcntjb25zdHJ1Y3Rvcih0KXtzdXBlcih0KSx0aGlzLnN0YXJ0ZWQ9ITEsdGhpcy5uYklucHV0cz10Lm51bWJlck9mSW5wdXRzLHRoaXMubmJPdXRwdXRzPXQubnVtYmVyT2ZPdXRwdXRzLHRoaXMuYmxvY2tTaXplPXQucHJvY2Vzc29yT3B0aW9ucy5ibG9ja1NpemUsdGhpcy5ob3BTaXplPTEyOCx0aGlzLm5iT3ZlcmxhcHM9dGhpcy5ibG9ja1NpemUvdGhpcy5ob3BTaXplLHRoaXMuaW5wdXRCdWZmZXJzPW5ldyBBcnJheSh0aGlzLm5iSW5wdXRzKSx0aGlzLmlucHV0QnVmZmVyc0hlYWQ9bmV3IEFycmF5KHRoaXMubmJJbnB1dHMpLHRoaXMuaW5wdXRCdWZmZXJzVG9TZW5kPW5ldyBBcnJheSh0aGlzLm5iSW5wdXRzKTtmb3IobGV0IGU9MDtlPHRoaXMubmJJbnB1dHM7ZSsrKXRoaXMuYWxsb2NhdGVJbnB1dENoYW5uZWxzKGUsMSk7dGhpcy5vdXRwdXRCdWZmZXJzPW5ldyBBcnJheSh0aGlzLm5iT3V0cHV0cyksdGhpcy5vdXRwdXRCdWZmZXJzVG9SZXRyaWV2ZT1uZXcgQXJyYXkodGhpcy5uYk91dHB1dHMpO2ZvcihsZXQgZT0wO2U8dGhpcy5uYk91dHB1dHM7ZSsrKXRoaXMuYWxsb2NhdGVPdXRwdXRDaGFubmVscyhlLDEpfXJlYWxsb2NhdGVDaGFubmVsc0lmTmVlZGVkKHQsZSl7Zm9yKGxldCByPTA7cjx0aGlzLm5iSW5wdXRzO3IrKyl7bGV0IHM9dFtyXS5sZW5ndGg7cyE9dGhpcy5pbnB1dEJ1ZmZlcnNbcl0ubGVuZ3RoJiZ0aGlzLmFsbG9jYXRlSW5wdXRDaGFubmVscyhyLHMpfWZvcihsZXQgcj0wO3I8dGhpcy5uYk91dHB1dHM7cisrKXtsZXQgcz1lW3JdLmxlbmd0aDtzIT10aGlzLm91dHB1dEJ1ZmZlcnNbcl0ubGVuZ3RoJiZ0aGlzLmFsbG9jYXRlT3V0cHV0Q2hhbm5lbHMocixzKX19YWxsb2NhdGVJbnB1dENoYW5uZWxzKHQsZSl7dGhpcy5pbnB1dEJ1ZmZlcnNbdF09bmV3IEFycmF5KGUpO2ZvcihsZXQgcj0wO3I8ZTtyKyspdGhpcy5pbnB1dEJ1ZmZlcnNbdF1bcl09bmV3IEZsb2F0MzJBcnJheSh0aGlzLmJsb2NrU2l6ZSsxMjgpLHRoaXMuaW5wdXRCdWZmZXJzW3RdW3JdLmZpbGwoMCk7dGhpcy5pbnB1dEJ1ZmZlcnNIZWFkW3RdPW5ldyBBcnJheShlKSx0aGlzLmlucHV0QnVmZmVyc1RvU2VuZFt0XT1uZXcgQXJyYXkoZSk7Zm9yKGxldCByPTA7cjxlO3IrKyl0aGlzLmlucHV0QnVmZmVyc0hlYWRbdF1bcl09dGhpcy5pbnB1dEJ1ZmZlcnNbdF1bcl0uc3ViYXJyYXkoMCx0aGlzLmJsb2NrU2l6ZSksdGhpcy5pbnB1dEJ1ZmZlcnNUb1NlbmRbdF1bcl09bmV3IEZsb2F0MzJBcnJheSh0aGlzLmJsb2NrU2l6ZSl9YWxsb2NhdGVPdXRwdXRDaGFubmVscyh0LGUpe3RoaXMub3V0cHV0QnVmZmVyc1t0XT1uZXcgQXJyYXkoZSk7Zm9yKGxldCByPTA7cjxlO3IrKyl0aGlzLm91dHB1dEJ1ZmZlcnNbdF1bcl09bmV3IEZsb2F0MzJBcnJheSh0aGlzLmJsb2NrU2l6ZSksdGhpcy5vdXRwdXRCdWZmZXJzW3RdW3JdLmZpbGwoMCk7dGhpcy5vdXRwdXRCdWZmZXJzVG9SZXRyaWV2ZVt0XT1uZXcgQXJyYXkoZSk7Zm9yKGxldCByPTA7cjxlO3IrKyl0aGlzLm91dHB1dEJ1ZmZlcnNUb1JldHJpZXZlW3RdW3JdPW5ldyBGbG9hdDMyQXJyYXkodGhpcy5ibG9ja1NpemUpLHRoaXMub3V0cHV0QnVmZmVyc1RvUmV0cmlldmVbdF1bcl0uZmlsbCgwKX1yZWFkSW5wdXRzKHQpe2lmKHRbMF0ubGVuZ3RoJiZ0WzBdWzBdLmxlbmd0aD09MCl7Zm9yKGxldCBlPTA7ZTx0aGlzLm5iSW5wdXRzO2UrKylmb3IobGV0IHI9MDtyPHRoaXMuaW5wdXRCdWZmZXJzW2VdLmxlbmd0aDtyKyspdGhpcy5pbnB1dEJ1ZmZlcnNbZV1bcl0uZmlsbCgwLHRoaXMuYmxvY2tTaXplKTtyZXR1cm59Zm9yKGxldCBlPTA7ZTx0aGlzLm5iSW5wdXRzO2UrKylmb3IobGV0IHI9MDtyPHRoaXMuaW5wdXRCdWZmZXJzW2VdLmxlbmd0aDtyKyspe2xldCBzPXRbZV1bcl07dGhpcy5pbnB1dEJ1ZmZlcnNbZV1bcl0uc2V0KHMsdGhpcy5ibG9ja1NpemUpfX13cml0ZU91dHB1dHModCl7Zm9yKGxldCBlPTA7ZTx0aGlzLm5iSW5wdXRzO2UrKylmb3IobGV0IHI9MDtyPHRoaXMuaW5wdXRCdWZmZXJzW2VdLmxlbmd0aDtyKyspe2xldCBzPXRoaXMub3V0cHV0QnVmZmVyc1tlXVtyXS5zdWJhcnJheSgwLDEyOCk7dFtlXVtyXS5zZXQocyl9fXNoaWZ0SW5wdXRCdWZmZXJzKCl7Zm9yKGxldCB0PTA7dDx0aGlzLm5iSW5wdXRzO3QrKylmb3IobGV0IGU9MDtlPHRoaXMuaW5wdXRCdWZmZXJzW3RdLmxlbmd0aDtlKyspdGhpcy5pbnB1dEJ1ZmZlcnNbdF1bZV0uY29weVdpdGhpbigwLDEyOCl9c2hpZnRPdXRwdXRCdWZmZXJzKCl7Zm9yKGxldCB0PTA7dDx0aGlzLm5iT3V0cHV0czt0KyspZm9yKGxldCBlPTA7ZTx0aGlzLm91dHB1dEJ1ZmZlcnNbdF0ubGVuZ3RoO2UrKyl0aGlzLm91dHB1dEJ1ZmZlcnNbdF1bZV0uY29weVdpdGhpbigwLDEyOCksdGhpcy5vdXRwdXRCdWZmZXJzW3RdW2VdLnN1YmFycmF5KHRoaXMuYmxvY2tTaXplLTEyOCkuZmlsbCgwKX1wcmVwYXJlSW5wdXRCdWZmZXJzVG9TZW5kKCl7Zm9yKGxldCB0PTA7dDx0aGlzLm5iSW5wdXRzO3QrKylmb3IobGV0IGU9MDtlPHRoaXMuaW5wdXRCdWZmZXJzW3RdLmxlbmd0aDtlKyspdGhpcy5pbnB1dEJ1ZmZlcnNUb1NlbmRbdF1bZV0uc2V0KHRoaXMuaW5wdXRCdWZmZXJzSGVhZFt0XVtlXSl9aGFuZGxlT3V0cHV0QnVmZmVyc1RvUmV0cmlldmUoKXtmb3IobGV0IHQ9MDt0PHRoaXMubmJPdXRwdXRzO3QrKylmb3IobGV0IGU9MDtlPHRoaXMub3V0cHV0QnVmZmVyc1t0XS5sZW5ndGg7ZSsrKWZvcihsZXQgcj0wO3I8dGhpcy5ibG9ja1NpemU7cisrKXRoaXMub3V0cHV0QnVmZmVyc1t0XVtlXVtyXSs9dGhpcy5vdXRwdXRCdWZmZXJzVG9SZXRyaWV2ZVt0XVtlXVtyXS90aGlzLm5iT3ZlcmxhcHN9cHJvY2Vzcyh0LGUscil7Y29uc3QgaT10WzBdWzBdIT09dm9pZCAwO3JldHVybiB0aGlzLnN0YXJ0ZWQmJiFpPyExOih0aGlzLnN0YXJ0ZWQ9aSx0aGlzLnJlYWxsb2NhdGVDaGFubmVsc0lmTmVlZGVkKHQsZSksdGhpcy5yZWFkSW5wdXRzKHQpLHRoaXMuc2hpZnRJbnB1dEJ1ZmZlcnMoKSx0aGlzLnByZXBhcmVJbnB1dEJ1ZmZlcnNUb1NlbmQoKSx0aGlzLnByb2Nlc3NPTEEodGhpcy5pbnB1dEJ1ZmZlcnNUb1NlbmQsdGhpcy5vdXRwdXRCdWZmZXJzVG9SZXRyaWV2ZSxyKSx0aGlzLmhhbmRsZU91dHB1dEJ1ZmZlcnNUb1JldHJpZXZlKCksdGhpcy53cml0ZU91dHB1dHMoZSksdGhpcy5zaGlmdE91dHB1dEJ1ZmZlcnMoKSwhMCl9cHJvY2Vzc09MQSh0LGUscil7Y29uc29sZS5hc3NlcnQoITEsIk5vdCBvdmVycmlkZW4iKX19Y2xhc3Mga3R7Y29uc3RydWN0b3IodCl7aWYodGhpcy5zaXplPXR8MCx0aGlzLnNpemU8PTF8fCh0aGlzLnNpemUmdGhpcy5zaXplLTEpIT09MCl0aHJvdyBuZXcgRXJyb3IoIkZGVCBzaXplIG11c3QgYmUgYSBwb3dlciBvZiB0d28gYW5kIGJpZ2dlciB0aGFuIDEiKTt0aGlzLl9jc2l6ZT10PDwxO2Zvcih2YXIgZT1uZXcgQXJyYXkodGhpcy5zaXplKjIpLHI9MDtyPGUubGVuZ3RoO3IrPTIpe2NvbnN0IGM9TWF0aC5QSSpyL3RoaXMuc2l6ZTtlW3JdPU1hdGguY29zKGMpLGVbcisxXT0tTWF0aC5zaW4oYyl9dGhpcy50YWJsZT1lO2Zvcih2YXIgcz0wLGk9MTt0aGlzLnNpemU+aTtpPDw9MSlzKys7dGhpcy5fd2lkdGg9cyUyPT09MD9zLTE6cyx0aGlzLl9iaXRyZXY9bmV3IEFycmF5KDE8PHRoaXMuX3dpZHRoKTtmb3IodmFyIG89MDtvPHRoaXMuX2JpdHJldi5sZW5ndGg7bysrKXt0aGlzLl9iaXRyZXZbb109MDtmb3IodmFyIGE9MDthPHRoaXMuX3dpZHRoO2ErPTIpe3ZhciBoPXRoaXMuX3dpZHRoLWEtMjt0aGlzLl9iaXRyZXZbb118PShvPj4+YSYzKTw8aH19dGhpcy5fb3V0PW51bGwsdGhpcy5fZGF0YT1udWxsLHRoaXMuX2ludj0wfWZyb21Db21wbGV4QXJyYXkodCxlKXtmb3IodmFyIHI9ZXx8bmV3IEFycmF5KHQubGVuZ3RoPj4+MSkscz0wO3M8dC5sZW5ndGg7cys9MilyW3M+Pj4xXT10W3NdO3JldHVybiByfWNyZWF0ZUNvbXBsZXhBcnJheSgpe2NvbnN0IHQ9bmV3IEFycmF5KHRoaXMuX2NzaXplKTtmb3IodmFyIGU9MDtlPHQubGVuZ3RoO2UrKyl0W2VdPTA7cmV0dXJuIHR9dG9Db21wbGV4QXJyYXkodCxlKXtmb3IodmFyIHI9ZXx8dGhpcy5jcmVhdGVDb21wbGV4QXJyYXkoKSxzPTA7czxyLmxlbmd0aDtzKz0yKXJbc109dFtzPj4+MV0scltzKzFdPTA7cmV0dXJuIHJ9Y29tcGxldGVTcGVjdHJ1bSh0KXtmb3IodmFyIGU9dGhpcy5fY3NpemUscj1lPj4+MSxzPTI7czxyO3MrPTIpdFtlLXNdPXRbc10sdFtlLXMrMV09LXRbcysxXX10cmFuc2Zvcm0odCxlKXtpZih0PT09ZSl0aHJvdyBuZXcgRXJyb3IoIklucHV0IGFuZCBvdXRwdXQgYnVmZmVycyBtdXN0IGJlIGRpZmZlcmVudCIpO3RoaXMuX291dD10LHRoaXMuX2RhdGE9ZSx0aGlzLl9pbnY9MCx0aGlzLl90cmFuc2Zvcm00KCksdGhpcy5fb3V0PW51bGwsdGhpcy5fZGF0YT1udWxsfXJlYWxUcmFuc2Zvcm0odCxlKXtpZih0PT09ZSl0aHJvdyBuZXcgRXJyb3IoIklucHV0IGFuZCBvdXRwdXQgYnVmZmVycyBtdXN0IGJlIGRpZmZlcmVudCIpO3RoaXMuX291dD10LHRoaXMuX2RhdGE9ZSx0aGlzLl9pbnY9MCx0aGlzLl9yZWFsVHJhbnNmb3JtNCgpLHRoaXMuX291dD1udWxsLHRoaXMuX2RhdGE9bnVsbH1pbnZlcnNlVHJhbnNmb3JtKHQsZSl7aWYodD09PWUpdGhyb3cgbmV3IEVycm9yKCJJbnB1dCBhbmQgb3V0cHV0IGJ1ZmZlcnMgbXVzdCBiZSBkaWZmZXJlbnQiKTt0aGlzLl9vdXQ9dCx0aGlzLl9kYXRhPWUsdGhpcy5faW52PTEsdGhpcy5fdHJhbnNmb3JtNCgpO2Zvcih2YXIgcj0wO3I8dC5sZW5ndGg7cisrKXRbcl0vPXRoaXMuc2l6ZTt0aGlzLl9vdXQ9bnVsbCx0aGlzLl9kYXRhPW51bGx9X3RyYW5zZm9ybTQoKXt2YXIgdD10aGlzLl9vdXQsZT10aGlzLl9jc2l6ZSxyPXRoaXMuX3dpZHRoLHM9MTw8cixpPWUvczw8MSxvLGEsaD10aGlzLl9iaXRyZXY7aWYoaT09PTQpZm9yKG89MCxhPTA7bzxlO28rPWksYSsrKXtjb25zdCBtPWhbYV07dGhpcy5fc2luZ2xlVHJhbnNmb3JtMihvLG0scyl9ZWxzZSBmb3Iobz0wLGE9MDtvPGU7bys9aSxhKyspe2NvbnN0IG09aFthXTt0aGlzLl9zaW5nbGVUcmFuc2Zvcm00KG8sbSxzKX12YXIgYz10aGlzLl9pbnY/LTE6MSx1PXRoaXMudGFibGU7Zm9yKHM+Pj0yO3M+PTI7cz4+PTIpe2k9ZS9zPDwxO3ZhciBmPWk+Pj4yO2ZvcihvPTA7bzxlO28rPWkpZm9yKHZhciBwPW8rZixsPW8sZD0wO2w8cDtsKz0yLGQrPXMpe2NvbnN0IG09bCx2PW0rZixiPXYrZixJPWIrZixNPXRbbV0sUD10W20rMV0sdz10W3ZdLHk9dFt2KzFdLFM9dFtiXSxBPXRbYisxXSxPPXRbSV0seD10W0krMV0scT1NLE49UCxrPXVbZF0sRj1jKnVbZCsxXSxWPXcqay15KkYsUj13KkYreSprLFk9dVsyKmRdLEM9Yyp1WzIqZCsxXSx0dD1TKlktQSpDLGV0PVMqQytBKlksc3Q9dVszKmRdLHJ0PWMqdVszKmQrMV0sbnQ9TypzdC14KnJ0LGl0PU8qcnQreCpzdCxvdD1xK3R0LGo9TitldCxaPXEtdHQsYXQ9Ti1ldCxjdD1WK250LCQ9UitpdCxHPWMqKFYtbnQpLHV0PWMqKFItaXQpLGx0PW90K2N0LGd0PWorJCxidD1vdC1jdCxJdD1qLSQsX3Q9Wit1dCxCdD1hdC1HLE10PVotdXQsUHQ9YXQrRzt0W21dPWx0LHRbbSsxXT1ndCx0W3ZdPV90LHRbdisxXT1CdCx0W2JdPWJ0LHRbYisxXT1JdCx0W0ldPU10LHRbSSsxXT1QdH19fV9zaW5nbGVUcmFuc2Zvcm0yKHQsZSxyKXtjb25zdCBzPXRoaXMuX291dCxpPXRoaXMuX2RhdGEsbz1pW2VdLGE9aVtlKzFdLGg9aVtlK3JdLGM9aVtlK3IrMV0sdT1vK2gsZj1hK2MscD1vLWgsbD1hLWM7c1t0XT11LHNbdCsxXT1mLHNbdCsyXT1wLHNbdCszXT1sfV9zaW5nbGVUcmFuc2Zvcm00KHQsZSxyKXtjb25zdCBzPXRoaXMuX291dCxpPXRoaXMuX2RhdGEsbz10aGlzLl9pbnY/LTE6MSxhPXIqMixoPXIqMyxjPWlbZV0sdT1pW2UrMV0sZj1pW2Urcl0scD1pW2UrcisxXSxsPWlbZSthXSxkPWlbZSthKzFdLG09aVtlK2hdLHY9aVtlK2grMV0sYj1jK2wsST11K2QsTT1jLWwsUD11LWQsdz1mK20seT1wK3YsUz1vKihmLW0pLEE9byoocC12KSxPPWIrdyx4PUkreSxxPU0rQSxOPVAtUyxrPWItdyxGPUkteSxWPU0tQSxSPVArUztzW3RdPU8sc1t0KzFdPXgsc1t0KzJdPXEsc1t0KzNdPU4sc1t0KzRdPWssc1t0KzVdPUYsc1t0KzZdPVYsc1t0KzddPVJ9X3JlYWxUcmFuc2Zvcm00KCl7dmFyIHQ9dGhpcy5fb3V0LGU9dGhpcy5fY3NpemUscj10aGlzLl93aWR0aCxzPTE8PHIsaT1lL3M8PDEsbyxhLGg9dGhpcy5fYml0cmV2O2lmKGk9PT00KWZvcihvPTAsYT0wO288ZTtvKz1pLGErKyl7Y29uc3Qgd3Q9aFthXTt0aGlzLl9zaW5nbGVSZWFsVHJhbnNmb3JtMihvLHd0Pj4+MSxzPj4+MSl9ZWxzZSBmb3Iobz0wLGE9MDtvPGU7bys9aSxhKyspe2NvbnN0IHd0PWhbYV07dGhpcy5fc2luZ2xlUmVhbFRyYW5zZm9ybTQobyx3dD4+PjEscz4+PjEpfXZhciBjPXRoaXMuX2ludj8tMToxLHU9dGhpcy50YWJsZTtmb3Iocz4+PTI7cz49MjtzPj49Mil7aT1lL3M8PDE7dmFyIGY9aT4+PjEscD1mPj4+MSxsPXA+Pj4xO2ZvcihvPTA7bzxlO28rPWkpZm9yKHZhciBkPTAsbT0wO2Q8PWw7ZCs9MixtKz1zKXt2YXIgdj1vK2QsYj12K3AsST1iK3AsTT1JK3AsUD10W3ZdLHc9dFt2KzFdLHk9dFtiXSxTPXRbYisxXSxBPXRbSV0sTz10W0krMV0seD10W01dLHE9dFtNKzFdLE49UCxrPXcsRj11W21dLFY9Yyp1W20rMV0sUj15KkYtUypWLFk9eSpWK1MqRixDPXVbMiptXSx0dD1jKnVbMiptKzFdLGV0PUEqQy1PKnR0LHN0PUEqdHQrTypDLHJ0PXVbMyptXSxudD1jKnVbMyptKzFdLGl0PXgqcnQtcSpudCxvdD14Km50K3EqcnQsaj1OK2V0LFo9aytzdCxhdD1OLWV0LGN0PWstc3QsJD1SK2l0LEc9WStvdCx1dD1jKihSLWl0KSxsdD1jKihZLW90KSxndD1qKyQsYnQ9WitHLEl0PWF0K2x0LF90PWN0LXV0O2lmKHRbdl09Z3QsdFt2KzFdPWJ0LHRbYl09SXQsdFtiKzFdPV90LGQ9PT0wKXt2YXIgQnQ9ai0kLE10PVotRzt0W0ldPUJ0LHRbSSsxXT1NdDtjb250aW51ZX1pZihkIT09bCl7dmFyIFB0PWF0LG1lPS1jdCx2ZT1qLGdlPS1aLGJlPS1jKmx0LEllPS1jKnV0LF9lPS1jKkcsQmU9LWMqJCxNZT1QdCtiZSxQZT1tZStJZSx3ZT12ZStCZSxTZT1nZS1fZSxDdD1vK3AtZCxFdD1vK2YtZDt0W0N0XT1NZSx0W0N0KzFdPVBlLHRbRXRdPXdlLHRbRXQrMV09U2V9fX19X3NpbmdsZVJlYWxUcmFuc2Zvcm0yKHQsZSxyKXtjb25zdCBzPXRoaXMuX291dCxpPXRoaXMuX2RhdGEsbz1pW2VdLGE9aVtlK3JdLGg9bythLGM9by1hO3NbdF09aCxzW3QrMV09MCxzW3QrMl09YyxzW3QrM109MH1fc2luZ2xlUmVhbFRyYW5zZm9ybTQodCxlLHIpe2NvbnN0IHM9dGhpcy5fb3V0LGk9dGhpcy5fZGF0YSxvPXRoaXMuX2ludj8tMToxLGE9cioyLGg9ciozLGM9aVtlXSx1PWlbZStyXSxmPWlbZSthXSxwPWlbZStoXSxsPWMrZixkPWMtZixtPXUrcCx2PW8qKHUtcCksYj1sK20sST1kLE09LXYsUD1sLW0sdz1kLHk9djtzW3RdPWIsc1t0KzFdPTAsc1t0KzJdPUksc1t0KzNdPU0sc1t0KzRdPVAsc1t0KzVdPTAsc1t0KzZdPXcsc1t0KzddPXl9fWxldCBEdD1uPT5jb25zb2xlLmxvZyhuKTtjb25zdCB6dD0oLi4ubik9PkR0KC4uLm4pLHF0PShuLHQsZSk9Pk1hdGgubWluKE1hdGgubWF4KG4sdCksZSksVHQ9bj0+bi8oMStuKSxXdD0obix0KT0+KG4ldCt0KSV0LEx0PShuLHQpPT4oMSt0KSpuLygxK3QqTWF0aC5hYnMobikpLEg9KG4sdCk9Pk1hdGgudGFuaChuKigxK3QpKSxZdD0obix0KT0+cXQoKDErdCkqbiwtMSwxKSx5dD0obix0KT0+e2xldCBlPSgxKy41KnQpKm47Y29uc3Qgcj1XdChlKzEsNCk7cmV0dXJuIDEtTWF0aC5hYnMoci0yKX0sSHQ9KG4sdCk9Pk1hdGguc2luKE1hdGguUEkvMip5dChuLHQpKSxVdD0obix0KT0+e2NvbnN0IGU9VHQoTWF0aC5sb2cxcCh0KSkscj0obi1lLzMqbipuKm4pLygxLWUvMyk7cmV0dXJuIEgocix0KX0sQXQ9KG4sdCxlPSExKT0+e2NvbnN0IHI9MSsyKnQscz1UdChNYXRoLmxvZzFwKHQpKSxpPS4wNypzLG89SChuK2ksMip0KSxhPUgoZT9pOi1uK2ksMip0KSxoPW8tYSxjPTEvTWF0aC5jb3NoKHIqaSksdT1jKmMsZj1NYXRoLm1heCgxZS04LChlPzE6Mikqcip1KTtyZXR1cm4gSChoL2YsdCl9LE90PXtzY3VydmU6THQsc29mdDpILGhhcmQ6WXQsY3ViaWM6VXQsZGlvZGU6QXQsYXN5bToobix0KT0+QXQobix0LCEwKSxmb2xkOnl0LHNpbmVmb2xkOkh0LGNoZWJ5c2hldjoobix0KT0+e2NvbnN0IGU9MTAqTWF0aC5sb2cxcCh0KTtsZXQgcj0xLHM9bixpLG89MDtmb3IobGV0IGE9MTthPDY0O2ErKyl7aWYoYTwyKXtvKz1hPT0wP3I6cztjb250aW51ZX1pPTIqbipyLXMscz1yLHI9aSxhJTI9PT0wJiYobys9TWF0aC5taW4oMS4zKmUvYSwyKSppKX1yZXR1cm4gSChvLGUvMjApfX0sUT1PYmplY3QuZnJlZXplKE9iamVjdC5rZXlzKE90KSksS3Q9bj0+e2xldCB0PW47dHlwZW9mIG49PSJzdHJpbmciJiYodD1RLmluZGV4T2YobiksdD09PS0xJiYoenQoYFtzdXBlcmRvdWdoXSBDb3VsZCBub3QgZmluZCB3YXZlc2hhcGluZyBhbGdvcml0aG0gJHtufS4KICAgICAgICBBdmFpbGFibGUgb3B0aW9ucyBhcmUgJHtRLmpvaW4oIiwgIil9LgogICAgICAgIERlZmF1bHRpbmcgdG8gJHtRWzBdfS5gKSx0PTApKTtjb25zdCBlPVFbdCVRLmxlbmd0aF07cmV0dXJuIE90W2VdfSxCPShuLHQsZSk9Pk1hdGgubWluKE1hdGgubWF4KG4sdCksZSkseHQ9KG4sdCk9PihuJXQrdCkldCxqdD0obix0LGUpPT5lKih0LW4pK24sVD0obix0KT0+e3ZhciBlO3JldHVybihlPW5bdF0pIT1udWxsP2U6blswXX0sTD1uPT5uLU1hdGguZmxvb3IobiksZnQ9bj0+bnwwLE50PShuLHQsZSk9Pm48Mj8wOmp0KC10Ki41LHQqLjUsZS8obi0xKSksVT0obix0KT0+bipNYXRoLnBvdygyLHQvMTIpO2Z1bmN0aW9uIEZ0KG4sdD0xKXtyZXR1cm4gbj49dD9uLT10Om48MCYmKG4rPXQpLG59Y29uc3QgSz0xMjg7ZnVuY3Rpb24gWnQobix0KXtyZXR1cm4gdD1NYXRoLm1pbih0LDEtdCksbjx0PyhuLz10LG4rbi1uKm4tMSk6bj4xLXQ/KG49KG4tMSkvdCxuKm4rbituKzEpOjB9Y29uc3QgcHQ9e3RyaShuLHQ9LjUpe2NvbnN0IGU9MS10O3JldHVybiBuPj10PzEvZS1uL2U6bi90fSxzaW5lKG4pe3JldHVybiBNYXRoLnNpbihNYXRoLlBJKjIqbikqLjUrLjV9LHJhbXAobil7cmV0dXJuIG59LHNhdyhuKXtyZXR1cm4gMS1ufSxzcXVhcmUobix0PS41KXtyZXR1cm4gbj49dD8wOjF9LGN1c3RvbShuLHQ9WzAsMV0pe2NvbnN0IGU9dC5sZW5ndGgtMSxyPU1hdGguZmxvb3IobiplKSxzPTEvZSxpPUIodFtyXSwwLDEpLGE9Qih0W3IrMV0sMCwxKSxoPWksYz0wLHU9cztyZXR1cm4oYS1oKS8odS1jKSoobi1zKnIpK2l9LHNhd2JsZXAobix0KXtyZXR1cm4gMipuLTEtWnQobix0KX19O2Z1bmN0aW9uIEoobix0KXtyZXR1cm4gdC5sZW5ndGg+MT90W25dOnRbMF19Y29uc3QgJHQ9T2JqZWN0LmtleXMocHQpO2NsYXNzIEd0IGV4dGVuZHMgQXVkaW9Xb3JrbGV0UHJvY2Vzc29ye3N0YXRpYyBnZXQgcGFyYW1ldGVyRGVzY3JpcHRvcnMoKXtyZXR1cm5be25hbWU6ImJlZ2luIixkZWZhdWx0VmFsdWU6MH0se25hbWU6InRpbWUiLGRlZmF1bHRWYWx1ZTowfSx7bmFtZToiZW5kIixkZWZhdWx0VmFsdWU6MH0se25hbWU6ImZyZXF1ZW5jeSIsZGVmYXVsdFZhbHVlOi41fSx7bmFtZToic2tldyIsZGVmYXVsdFZhbHVlOi41fSx7bmFtZToiZGVwdGgiLGRlZmF1bHRWYWx1ZToxfSx7bmFtZToicGhhc2VvZmZzZXQiLGRlZmF1bHRWYWx1ZTowfSx7bmFtZToic2hhcGUiLGRlZmF1bHRWYWx1ZTowfSx7bmFtZToiY3VydmUiLGRlZmF1bHRWYWx1ZToxfSx7bmFtZToiZGNvZmZzZXQiLGRlZmF1bHRWYWx1ZTowfSx7bmFtZToibWluIixkZWZhdWx0VmFsdWU6MH0se25hbWU6Im1heCIsZGVmYXVsdFZhbHVlOjF9XX1jb25zdHJ1Y3Rvcigpe3N1cGVyKCksdGhpcy5waGFzZX1pbmNyZW1lbnRQaGFzZSh0KXt0aGlzLnBoYXNlKz10LHRoaXMucGhhc2U+MSYmKHRoaXMucGhhc2U9dGhpcy5waGFzZS0xKX1wcm9jZXNzKHQsZSxyKXt2YXIgSTtjb25zdCBzPXIuYmVnaW5bMF07aWYoY3VycmVudFRpbWU+PXIuZW5kWzBdKXJldHVybiExO2lmKGN1cnJlbnRUaW1lPD1zKXJldHVybiEwO2NvbnN0IGk9ZVswXSxvPXIuZnJlcXVlbmN5WzBdLGE9ci50aW1lWzBdLGg9ci5kZXB0aFswXSxjPXIuc2tld1swXSx1PXIucGhhc2VvZmZzZXRbMF0sZj1yLmN1cnZlWzBdLHA9ci5kY29mZnNldFswXSxsPXIubWluWzBdLGQ9ci5tYXhbMF0sbT0kdFtyLnNoYXBlWzBdXSx2PShJPWlbMF0ubGVuZ3RoKSE9bnVsbD9JOjA7dGhpcy5waGFzZT09bnVsbCYmKHRoaXMucGhhc2U9eHQoYSpvK3UsMSkpO2NvbnN0IGI9by9zYW1wbGVSYXRlO2ZvcihsZXQgTT0wO008djtNKyspe2ZvcihsZXQgUD0wO1A8aS5sZW5ndGg7UCsrKXtsZXQgdz0ocHRbbV0odGhpcy5waGFzZSxjKStwKSpoO3c9TWF0aC5wb3codyxmKSxpW1BdW01dPUIodyxsLGQpfXRoaXMuaW5jcmVtZW50UGhhc2UoYil9cmV0dXJuITB9fXJlZ2lzdGVyUHJvY2Vzc29yKCJsZm8tcHJvY2Vzc29yIixHdCk7Y2xhc3MgUXQgZXh0ZW5kcyBBdWRpb1dvcmtsZXRQcm9jZXNzb3J7c3RhdGljIGdldCBwYXJhbWV0ZXJEZXNjcmlwdG9ycygpe3JldHVyblt7bmFtZToiY29hcnNlIixkZWZhdWx0VmFsdWU6MX1dfWNvbnN0cnVjdG9yKCl7c3VwZXIoKSx0aGlzLnN0YXJ0ZWQ9ITF9cHJvY2Vzcyh0LGUscil7dmFyIGg7Y29uc3Qgcz10WzBdLGk9ZVswXSxvPXNbMF0hPT12b2lkIDA7aWYodGhpcy5zdGFydGVkJiYhbylyZXR1cm4hMTt0aGlzLnN0YXJ0ZWQ9bztsZXQgYT0oaD1yLmNvYXJzZVswXSkhPW51bGw/aDowO2E9TWF0aC5tYXgoMSxhKTtmb3IobGV0IGM9MDtjPEs7YysrKWZvcihsZXQgdT0wO3U8cy5sZW5ndGg7dSsrKWlbdV1bY109YyVhPT09MD9zW3VdW2NdOmlbdV1bYy0xXTtyZXR1cm4hMH19cmVnaXN0ZXJQcm9jZXNzb3IoImNvYXJzZS1wcm9jZXNzb3IiLFF0KTtjbGFzcyBKdCBleHRlbmRzIEF1ZGlvV29ya2xldFByb2Nlc3NvcntzdGF0aWMgZ2V0IHBhcmFtZXRlckRlc2NyaXB0b3JzKCl7cmV0dXJuW3tuYW1lOiJjcnVzaCIsZGVmYXVsdFZhbHVlOjB9XX1jb25zdHJ1Y3Rvcigpe3N1cGVyKCksdGhpcy5zdGFydGVkPSExfXByb2Nlc3ModCxlLHIpe3ZhciBoO2NvbnN0IHM9dFswXSxpPWVbMF0sbz1zWzBdIT09dm9pZCAwO2lmKHRoaXMuc3RhcnRlZCYmIW8pcmV0dXJuITE7dGhpcy5zdGFydGVkPW87bGV0IGE9KGg9ci5jcnVzaFswXSkhPW51bGw/aDo4O2E9TWF0aC5tYXgoMSxhKTtmb3IobGV0IGM9MDtjPEs7YysrKWZvcihsZXQgdT0wO3U8cy5sZW5ndGg7dSsrKXtjb25zdCBmPU1hdGgucG93KDIsYS0xKTtpW3VdW2NdPU1hdGgucm91bmQoc1t1XVtjXSpmKS9mfXJldHVybiEwfX1yZWdpc3RlclByb2Nlc3NvcigiY3J1c2gtcHJvY2Vzc29yIixKdCk7Y2xhc3MgWHQgZXh0ZW5kcyBBdWRpb1dvcmtsZXRQcm9jZXNzb3J7c3RhdGljIGdldCBwYXJhbWV0ZXJEZXNjcmlwdG9ycygpe3JldHVyblt7bmFtZToic2hhcGUiLGRlZmF1bHRWYWx1ZTowfSx7bmFtZToicG9zdGdhaW4iLGRlZmF1bHRWYWx1ZToxfV19Y29uc3RydWN0b3IoKXtzdXBlcigpLHRoaXMuc3RhcnRlZD0hMX1wcm9jZXNzKHQsZSxyKXtjb25zdCBzPXRbMF0saT1lWzBdLG89c1swXSE9PXZvaWQgMDtpZih0aGlzLnN0YXJ0ZWQmJiFvKXJldHVybiExO3RoaXMuc3RhcnRlZD1vO2xldCBhPXIuc2hhcGVbMF07YT1hPDE/YTouOTk5OTk5OTk5NixhPTIqYS8oMS1hKTtjb25zdCBoPU1hdGgubWF4KC4wMDEsTWF0aC5taW4oMSxyLnBvc3RnYWluWzBdKSk7Zm9yKGxldCBjPTA7YzxLO2MrKylmb3IobGV0IHU9MDt1PHMubGVuZ3RoO3UrKylpW3VdW2NdPSgxK2EpKnNbdV1bY10vKDErYSpNYXRoLmFicyhzW3VdW2NdKSkqaDtyZXR1cm4hMH19cmVnaXN0ZXJQcm9jZXNzb3IoInNoYXBlLXByb2Nlc3NvciIsWHQpO2NsYXNzIFZ0e2NvbnN0cnVjdG9yKCl7U3QodGhpcywiczAiLDApO1N0KHRoaXMsInMxIiwwKX11cGRhdGUodCxlLHI9MCl7cj1CKHIsMCwxKSxlPUIoZSwwLHNhbXBsZVJhdGUvMi0xKTtjb25zdCBzPUIoMipNYXRoLnNpbihlKihkdC9zYW1wbGVSYXRlKSksMCwxLjE0KSxpPU1hdGgucG93KC41LChyKy4xMjUpLy4xMjUpLG89MS1pKnM7cmV0dXJuIHRoaXMuczA9byp0aGlzLnMwLXMqdGhpcy5zMStzKnQsdGhpcy5zMT1vKnRoaXMuczErcyp0aGlzLnMwLHRoaXMuczF9fWNsYXNzIHRlIGV4dGVuZHMgQXVkaW9Xb3JrbGV0UHJvY2Vzc29ye3N0YXRpYyBnZXQgcGFyYW1ldGVyRGVzY3JpcHRvcnMoKXtyZXR1cm5be25hbWU6InZhbHVlIixkZWZhdWx0VmFsdWU6LjV9XX1jb25zdHJ1Y3Rvcigpe3N1cGVyKCksdGhpcy5maWx0ZXJzPVtuZXcgVnQsbmV3IFZ0XX1wcm9jZXNzKHQsZSxyKXtjb25zdCBzPXRbMF0saT1lWzBdLG89c1swXSE9PXZvaWQgMDt0aGlzLnN0YXJ0ZWQ9bztjb25zdCBhPUIoci52YWx1ZVswXSwwLDEpO2xldCBoPSJub25lIixjLHU9MTthPi41MT8oaD0iaGlwYXNzIix1PShhLS41KSoyKTphPC40OSYmKGg9ImxvcGFzcyIsdT1hKjIpLGM9TWF0aC5wb3codSoxMSw0KTtmb3IobGV0IGY9MDtmPHMubGVuZ3RoO2YrKylmb3IobGV0IHA9MDtwPEs7cCsrKWg9PSJub25lIj9pW2ZdW3BdPXNbZl1bcF06KHRoaXMuZmlsdGVyc1tmXS51cGRhdGUoc1tmXVtwXSxjLC4xKSxoPT09ImxvcGFzcyI/aVtmXVtwXT10aGlzLmZpbHRlcnNbZl0uczE6aD09PSJoaXBhc3MiP2lbZl1bcF09c1tmXVtwXS10aGlzLmZpbHRlcnNbZl0uczE6aVtmXVtwXT1zW2ZdW3BdKTtyZXR1cm4hMH19cmVnaXN0ZXJQcm9jZXNzb3IoImRqZi1wcm9jZXNzb3IiLHRlKTtmdW5jdGlvbiB6KG4pe2NvbnN0IHQ9bipuO3JldHVybiBuKigyNyt0KS8oMjcrOSp0KX1jb25zdCBkdD0zLjE0MTU5MjY1MzU5O2NsYXNzIGVlIGV4dGVuZHMgQXVkaW9Xb3JrbGV0UHJvY2Vzc29ye3N0YXRpYyBnZXQgcGFyYW1ldGVyRGVzY3JpcHRvcnMoKXtyZXR1cm5be25hbWU6ImZyZXF1ZW5jeSIsZGVmYXVsdFZhbHVlOjUwMH0se25hbWU6InEiLGRlZmF1bHRWYWx1ZToxfSx7bmFtZToiZHJpdmUiLGRlZmF1bHRWYWx1ZTouNjl9XX1jb25zdHJ1Y3Rvcigpe3N1cGVyKCksdGhpcy5zdGFydGVkPSExLHRoaXMucDA9WzAsMF0sdGhpcy5wMT1bMCwwXSx0aGlzLnAyPVswLDBdLHRoaXMucDM9WzAsMF0sdGhpcy5wMzI9WzAsMF0sdGhpcy5wMzM9WzAsMF0sdGhpcy5wMzQ9WzAsMF19cHJvY2Vzcyh0LGUscil7Y29uc3Qgcz10WzBdLGk9ZVswXSxvPXNbMF0hPT12b2lkIDA7aWYodGhpcy5zdGFydGVkJiYhbylyZXR1cm4hMTt0aGlzLnN0YXJ0ZWQ9bztjb25zdCBhPXIucVswXSxoPUIoTWF0aC5leHAoci5kcml2ZVswXSksLjEsMmUzKTtsZXQgYz1yLmZyZXF1ZW5jeVswXTtjPWMqMipkdC9zYW1wbGVSYXRlLGM9Yz4xPzE6Yztjb25zdCB1PU1hdGgubWluKDgsYSouMTMpO2xldCBmPTEvaCpNYXRoLm1pbigxLjc1LDErdSk7Zm9yKGxldCBwPTA7cDxLO3ArKylmb3IobGV0IGw9MDtsPHMubGVuZ3RoO2wrKyl7Y29uc3QgZD10aGlzLnAzW2xdKi4zNjA4OTErdGhpcy5wMzJbbF0qLjQxNzI5K3RoaXMucDMzW2xdKi4xNzc4OTYrdGhpcy5wMzRbbF0qLjA0Mzk3MjU7dGhpcy5wMzRbbF09dGhpcy5wMzNbbF0sdGhpcy5wMzNbbF09dGhpcy5wMzJbbF0sdGhpcy5wMzJbbF09dGhpcy5wM1tsXSx0aGlzLnAwW2xdKz0oeihzW2xdW3BdKmgtdSpkKS16KHRoaXMucDBbbF0pKSpjLHRoaXMucDFbbF0rPSh6KHRoaXMucDBbbF0pLXoodGhpcy5wMVtsXSkpKmMsdGhpcy5wMltsXSs9KHoodGhpcy5wMVtsXSkteih0aGlzLnAyW2xdKSkqYyx0aGlzLnAzW2xdKz0oeih0aGlzLnAyW2xdKS16KHRoaXMucDNbbF0pKSpjLGlbbF1bcF09ZCpmfXJldHVybiEwfX1yZWdpc3RlclByb2Nlc3NvcigibGFkZGVyLXByb2Nlc3NvciIsZWUpO2NsYXNzIHNlIGV4dGVuZHMgQXVkaW9Xb3JrbGV0UHJvY2Vzc29ye3N0YXRpYyBnZXQgcGFyYW1ldGVyRGVzY3JpcHRvcnMoKXtyZXR1cm5be25hbWU6ImRpc3RvcnQiLGRlZmF1bHRWYWx1ZTowfSx7bmFtZToicG9zdGdhaW4iLGRlZmF1bHRWYWx1ZToxfV19Y29uc3RydWN0b3Ioe3Byb2Nlc3Nvck9wdGlvbnM6dH0pe3N1cGVyKCksdGhpcy5zdGFydGVkPSExLHRoaXMuYWxnb3JpdGhtPUt0KHQuYWxnb3JpdGhtKX1wcm9jZXNzKHQsZSxyKXtjb25zdCBzPXRbMF0saT1lWzBdLG89c1swXSE9PXZvaWQgMDtpZih0aGlzLnN0YXJ0ZWQmJiFvKXJldHVybiExO3RoaXMuc3RhcnRlZD1vO2ZvcihsZXQgYT0wO2E8SzthKyspe2NvbnN0IGg9QihUKHIucG9zdGdhaW4sYSksLjAwMSwxKSxjPU1hdGguZXhwbTEoVChyLmRpc3RvcnQsYSkpO2ZvcihsZXQgdT0wO3U8cy5sZW5ndGg7dSsrKXtjb25zdCBmPXNbdV1bYV07aVt1XVthXT1oKnRoaXMuYWxnb3JpdGhtKGYsYyl9fXJldHVybiEwfX1yZWdpc3RlclByb2Nlc3NvcigiZGlzdG9ydC1wcm9jZXNzb3IiLHNlKTtjbGFzcyByZSBleHRlbmRzIEF1ZGlvV29ya2xldFByb2Nlc3Nvcntjb25zdHJ1Y3Rvcigpe3N1cGVyKCksdGhpcy5waGFzZT1bXX1zdGF0aWMgZ2V0IHBhcmFtZXRlckRlc2NyaXB0b3JzKCl7cmV0dXJuW3tuYW1lOiJiZWdpbiIsZGVmYXVsdFZhbHVlOjAsbWF4Ok51bWJlci5QT1NJVElWRV9JTkZJTklUWSxtaW46MH0se25hbWU6ImVuZCIsZGVmYXVsdFZhbHVlOjAsbWF4Ok51bWJlci5QT1NJVElWRV9JTkZJTklUWSxtaW46MH0se25hbWU6ImZyZXF1ZW5jeSIsZGVmYXVsdFZhbHVlOjQ0MCxtaW46TnVtYmVyLkVQU0lMT059LHtuYW1lOiJwYW5zcHJlYWQiLGRlZmF1bHRWYWx1ZTouNCxtaW46MCxtYXg6MX0se25hbWU6ImZyZXFzcHJlYWQiLGRlZmF1bHRWYWx1ZTouMixtaW46MH0se25hbWU6ImRldHVuZSIsZGVmYXVsdFZhbHVlOjAsbWluOjB9LHtuYW1lOiJ2b2ljZXMiLGRlZmF1bHRWYWx1ZTo1LG1pbjoxfV19cHJvY2Vzcyh0LGUscil7dmFyIGk7aWYoY3VycmVudFRpbWU8PXIuYmVnaW5bMF0pcmV0dXJuITA7aWYoY3VycmVudFRpbWU+PXIuZW5kWzBdKXJldHVybiExO2NvbnN0IHM9ZVswXTtmb3IobGV0IG89MDtvPHNbMF0ubGVuZ3RoO28rKyl7Y29uc3QgYT1UKHIuZGV0dW5lLG8pLGg9VChyLnZvaWNlcyxvKSxjPVQoci5mcmVxc3ByZWFkLG8pLHU9VChyLnBhbnNwcmVhZCxvKSouNSsuNSxmPU1hdGguc3FydCgxLXUpLHA9TWF0aC5zcXJ0KHUpO2xldCBsPVQoci5mcmVxdWVuY3ksbyk7bD1VKGwsYS8xMDApO2ZvcihsZXQgZD0wO2Q8aDtkKyspe2NvbnN0IG09KGQmMSk9PTE7bGV0IHY9ZixiPXA7bSYmKHY9cCxiPWYpO2NvbnN0IEk9VShsLE50KGgsYyxkKSksTT14dChJL3NhbXBsZVJhdGUsMSk7dGhpcy5waGFzZVtkXT0oaT10aGlzLnBoYXNlW2RdKSE9bnVsbD9pOk1hdGgucmFuZG9tKCk7Y29uc3QgUD1wdC5zYXdibGVwKHRoaXMucGhhc2VbZF0sTSk7c1swXVtvXT1zWzBdW29dK1AqdixzWzFdW29dPXNbMV1bb10rUCpiLHRoaXMucGhhc2VbZF09RnQodGhpcy5waGFzZVtkXStNKX19cmV0dXJuITB9fXJlZ2lzdGVyUHJvY2Vzc29yKCJzdXBlcnNhdy1vc2NpbGxhdG9yIixyZSk7Y29uc3QgbmU9MjA0ODtmdW5jdGlvbiBpZShuKXtsZXQgdD1uZXcgRmxvYXQzMkFycmF5KG4pO2Zvcih2YXIgZT0wO2U8bjtlKyspdFtlXT0uNSooMS1NYXRoLmNvcygyKk1hdGguUEkqZS9uKSk7cmV0dXJuIHR9Y2xhc3Mgb2UgZXh0ZW5kcyBXe3N0YXRpYyBnZXQgcGFyYW1ldGVyRGVzY3JpcHRvcnMoKXtyZXR1cm5be25hbWU6InBpdGNoRmFjdG9yIixkZWZhdWx0VmFsdWU6MX1dfWNvbnN0cnVjdG9yKHQpe3QucHJvY2Vzc29yT3B0aW9ucz17YmxvY2tTaXplOm5lfSxzdXBlcih0KSx0aGlzLmZmdFNpemU9dGhpcy5ibG9ja1NpemUsdGhpcy50aW1lQ3Vyc29yPTAsdGhpcy5oYW5uV2luZG93PWllKHRoaXMuYmxvY2tTaXplKSx0aGlzLmZmdD1uZXcga3QodGhpcy5mZnRTaXplKSx0aGlzLmZyZXFDb21wbGV4QnVmZmVyPXRoaXMuZmZ0LmNyZWF0ZUNvbXBsZXhBcnJheSgpLHRoaXMuZnJlcUNvbXBsZXhCdWZmZXJTaGlmdGVkPXRoaXMuZmZ0LmNyZWF0ZUNvbXBsZXhBcnJheSgpLHRoaXMudGltZUNvbXBsZXhCdWZmZXI9dGhpcy5mZnQuY3JlYXRlQ29tcGxleEFycmF5KCksdGhpcy5tYWduaXR1ZGVzPW5ldyBGbG9hdDMyQXJyYXkodGhpcy5mZnRTaXplLzIrMSksdGhpcy5wZWFrSW5kZXhlcz1uZXcgSW50MzJBcnJheSh0aGlzLm1hZ25pdHVkZXMubGVuZ3RoKSx0aGlzLm5iUGVha3M9MH1wcm9jZXNzT0xBKHQsZSxyKXtsZXQgcz1yLnBpdGNoRmFjdG9yW3IucGl0Y2hGYWN0b3IubGVuZ3RoLTFdO3M8MCYmKHM9cyouMjUpLHM9TWF0aC5tYXgoMCxzKzEpO2Zvcih2YXIgaT0wO2k8dGhpcy5uYklucHV0cztpKyspZm9yKHZhciBvPTA7bzx0W2ldLmxlbmd0aDtvKyspe3ZhciBhPXRbaV1bb10saD1lW2ldW29dO3RoaXMuYXBwbHlIYW5uV2luZG93KGEpLHRoaXMuZmZ0LnJlYWxUcmFuc2Zvcm0odGhpcy5mcmVxQ29tcGxleEJ1ZmZlcixhKSx0aGlzLmNvbXB1dGVNYWduaXR1ZGVzKCksdGhpcy5maW5kUGVha3MoKSx0aGlzLnNoaWZ0UGVha3MocyksdGhpcy5mZnQuY29tcGxldGVTcGVjdHJ1bSh0aGlzLmZyZXFDb21wbGV4QnVmZmVyU2hpZnRlZCksdGhpcy5mZnQuaW52ZXJzZVRyYW5zZm9ybSh0aGlzLnRpbWVDb21wbGV4QnVmZmVyLHRoaXMuZnJlcUNvbXBsZXhCdWZmZXJTaGlmdGVkKSx0aGlzLmZmdC5mcm9tQ29tcGxleEFycmF5KHRoaXMudGltZUNvbXBsZXhCdWZmZXIsaCksdGhpcy5hcHBseUhhbm5XaW5kb3coaCl9dGhpcy50aW1lQ3Vyc29yKz10aGlzLmhvcFNpemV9YXBwbHlIYW5uV2luZG93KHQpe2Zvcih2YXIgZT0wO2U8dGhpcy5ibG9ja1NpemU7ZSsrKXRbZV09dFtlXSp0aGlzLmhhbm5XaW5kb3dbZV0qMS42Mn1jb21wdXRlTWFnbml0dWRlcygpe2Zvcih2YXIgdD0wLGU9MDt0PHRoaXMubWFnbml0dWRlcy5sZW5ndGg7KXtsZXQgcj10aGlzLmZyZXFDb21wbGV4QnVmZmVyW2VdLHM9dGhpcy5mcmVxQ29tcGxleEJ1ZmZlcltlKzFdO3RoaXMubWFnbml0dWRlc1t0XT1yKioyK3MqKjIsdCs9MSxlKz0yfX1maW5kUGVha3MoKXt0aGlzLm5iUGVha3M9MDt2YXIgdD0yO2xldCBlPXRoaXMubWFnbml0dWRlcy5sZW5ndGgtMjtmb3IoO3Q8ZTspe2xldCByPXRoaXMubWFnbml0dWRlc1t0XTtpZih0aGlzLm1hZ25pdHVkZXNbdC0xXT49cnx8dGhpcy5tYWduaXR1ZGVzW3QtMl0+PXIpe3QrKztjb250aW51ZX1pZih0aGlzLm1hZ25pdHVkZXNbdCsxXT49cnx8dGhpcy5tYWduaXR1ZGVzW3QrMl0+PXIpe3QrKztjb250aW51ZX10aGlzLnBlYWtJbmRleGVzW3RoaXMubmJQZWFrc109dCx0aGlzLm5iUGVha3MrKyx0Kz0yfX1zaGlmdFBlYWtzKHQpe3RoaXMuZnJlcUNvbXBsZXhCdWZmZXJTaGlmdGVkLmZpbGwoMCk7Zm9yKHZhciBlPTA7ZTx0aGlzLm5iUGVha3M7ZSsrKXtsZXQgbz10aGlzLnBlYWtJbmRleGVzW2VdLGE9TWF0aC5yb3VuZChvKnQpO2lmKGE+dGhpcy5tYWduaXR1ZGVzLmxlbmd0aClicmVhazt2YXIgcj0wLHM9dGhpcy5mZnRTaXplO2lmKGU+MCl7bGV0IHU9dGhpcy5wZWFrSW5kZXhlc1tlLTFdO3I9by1NYXRoLmZsb29yKChvLXUpLzIpfWlmKGU8dGhpcy5uYlBlYWtzLTEpe2xldCB1PXRoaXMucGVha0luZGV4ZXNbZSsxXTtzPW8rTWF0aC5jZWlsKCh1LW8pLzIpfWxldCBoPXItbyxjPXMtbztmb3IodmFyIGk9aDtpPGM7aSsrKXtsZXQgdT1vK2ksZj1hK2k7aWYoZj49dGhpcy5tYWduaXR1ZGVzLmxlbmd0aClicmVhaztsZXQgcD0yKk1hdGguUEkqKGYtdSkvdGhpcy5mZnRTaXplLGw9TWF0aC5jb3MocCp0aGlzLnRpbWVDdXJzb3IpLGQ9TWF0aC5zaW4ocCp0aGlzLnRpbWVDdXJzb3IpLG09dSoyLHY9bSsxLGI9dGhpcy5mcmVxQ29tcGxleEJ1ZmZlclttXSxJPXRoaXMuZnJlcUNvbXBsZXhCdWZmZXJbdl0sTT1iKmwtSSpkLFA9YipkK0kqbCx3PWYqMix5PXcrMTt0aGlzLmZyZXFDb21wbGV4QnVmZmVyU2hpZnRlZFt3XSs9TSx0aGlzLmZyZXFDb21wbGV4QnVmZmVyU2hpZnRlZFt5XSs9UH19fX1yZWdpc3RlclByb2Nlc3NvcigicGhhc2Utdm9jb2Rlci1wcm9jZXNzb3IiLG9lKTtjbGFzcyBhZSBleHRlbmRzIEF1ZGlvV29ya2xldFByb2Nlc3Nvcntjb25zdHJ1Y3Rvcigpe3N1cGVyKCksdGhpcy5waT1kdCx0aGlzLnBoaT0tdGhpcy5waSx0aGlzLlkwPTAsdGhpcy5ZMT0wLHRoaXMuUFc9dGhpcy5waSx0aGlzLkI9Mi4zLHRoaXMuZHBoaWY9MCx0aGlzLmVudmY9MH1zdGF0aWMgZ2V0IHBhcmFtZXRlckRlc2NyaXB0b3JzKCl7cmV0dXJuW3tuYW1lOiJiZWdpbiIsZGVmYXVsdFZhbHVlOjAsbWF4Ok51bWJlci5QT1NJVElWRV9JTkZJTklUWSxtaW46MH0se25hbWU6ImVuZCIsZGVmYXVsdFZhbHVlOjAsbWF4Ok51bWJlci5QT1NJVElWRV9JTkZJTklUWSxtaW46MH0se25hbWU6ImZyZXF1ZW5jeSIsZGVmYXVsdFZhbHVlOjQ0MCxtaW46TnVtYmVyLkVQU0lMT059LHtuYW1lOiJkZXR1bmUiLGRlZmF1bHRWYWx1ZTowLG1pbjpOdW1iZXIuTkVHQVRJVkVfSU5GSU5JVFksbWF4Ok51bWJlci5QT1NJVElWRV9JTkZJTklUWX0se25hbWU6InB1bHNld2lkdGgiLGRlZmF1bHRWYWx1ZToxLG1pbjowLG1heDpOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFl9XX1wcm9jZXNzKHQsZSxyKXt2YXIgYTtpZih0aGlzLmRpc2Nvbm5lY3RlZClyZXR1cm4hMTtpZihjdXJyZW50VGltZTw9ci5iZWdpblswXSlyZXR1cm4hMDtpZihjdXJyZW50VGltZT49ci5lbmRbMF0pcmV0dXJuITE7Y29uc3Qgcz1lWzBdO2xldCBpPTEsbztmb3IobGV0IGg9MDtoPCgoYT1zWzBdLmxlbmd0aCkhPW51bGw/YTowKTtoKyspe2NvbnN0IGM9KDEtQihKKGgsci5wdWxzZXdpZHRoKSwtLjk5LC45OSkpKnRoaXMucGksdT1KKGgsci5kZXR1bmUpLGY9VShKKGgsci5mcmVxdWVuY3kpLHUvMTAwKTtvPWYqKHRoaXMucGkvKHNhbXBsZVJhdGUqLjUpKSx0aGlzLmRwaGlmKz0uMSooby10aGlzLmRwaGlmKSxpKj0uOTk5OCx0aGlzLmVudmYrPS4xKihpLXRoaXMuZW52ZiksdGhpcy5CPTIuMyooMS0xZS00KmYpLHRoaXMuQjwwJiYodGhpcy5CPTApLHRoaXMucGhpKz10aGlzLmRwaGlmLHRoaXMucGhpPj10aGlzLnBpJiYodGhpcy5waGktPTIqdGhpcy5waSk7bGV0IHA9TWF0aC5jb3ModGhpcy5waGkrdGhpcy5CKnRoaXMuWTApO3RoaXMuWTA9LjUqKHArdGhpcy5ZMCk7bGV0IGw9TWF0aC5jb3ModGhpcy5waGkrdGhpcy5CKnRoaXMuWTErYyk7dGhpcy5ZMT0uNSoobCt0aGlzLlkxKTtmb3IobGV0IGQ9MDtkPHMubGVuZ3RoO2QrKylzW2RdW2hdPS4xNSoocC1sKSp0aGlzLmVudmZ9cmV0dXJuITB9fXJlZ2lzdGVyUHJvY2Vzc29yKCJwdWxzZS1vc2NpbGxhdG9yIixhZSk7Y29uc3QgbXQ9e2JpdEM6ZnVuY3Rpb24obix0LGUpe3JldHVybiBuJnQ/ZTowfSxicjpmdW5jdGlvbihuLHQ9OCl7aWYodD4zMil0aHJvdyBuZXcgRXJyb3IoImJyKCkgU2l6ZSBjYW5ub3QgYmUgZ3JlYXRlciB0aGFuIDMyIik7e2xldCBlPTA7Zm9yKGxldCByPTA7cjx0LTA7cisrKWUrPW10LmJpdEMobiwyKipyLDIqKih0LShyKzEpKSk7cmV0dXJuIGV9fSxzaW5mOmZ1bmN0aW9uKG4pe3JldHVybiBNYXRoLnNpbihuLygxMjgvTWF0aC5QSSkpfSxjb3NmOmZ1bmN0aW9uKG4pe3JldHVybiBNYXRoLmNvcyhuLygxMjgvTWF0aC5QSSkpfSx0YW5mOmZ1bmN0aW9uKG4pe3JldHVybiBNYXRoLnRhbihuLygxMjgvTWF0aC5QSSkpfSxyZWdHOmZ1bmN0aW9uKG4sdCl7cmV0dXJuIHQudGVzdChuLnRvU3RyaW5nKDIpKX19O2xldCBYLGh0O2Z1bmN0aW9uIGNlKG4pe2lmKChYfHxodCk9PW51bGwpe1g9T2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoTWF0aCksaHQ9WC5tYXAocj0+TWF0aFtyXSk7Y29uc3QgdD1PYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhtdCksZT10Lm1hcChyPT5tdFtyXSk7WC5wdXNoKCJpbnQiLCJ3aW5kb3ciLC4uLnQpLGh0LnB1c2goTWF0aC5mbG9vcixnbG9iYWxUaGlzLC4uLmUpfXJldHVybiBuZXcgRnVuY3Rpb24oLi4uWCwidCIsYHJldHVybiAwLAoke258fDB9O2ApLmJpbmQoZ2xvYmFsVGhpcywuLi5odCl9Y2xhc3MgdWUgZXh0ZW5kcyBBdWRpb1dvcmtsZXRQcm9jZXNzb3J7Y29uc3RydWN0b3IoKXtzdXBlcigpLHRoaXMucG9ydC5vbm1lc3NhZ2U9dD0+e2xldHtjb2RlVGV4dDplfT10LmRhdGE7Y29uc3R7Ynl0ZUJlYXRTdGFydFRpbWU6cn09dC5kYXRhO3IhPW51bGwmJih0aGlzLnQ9MCx0aGlzLmluaXRpYWxPZmZzZXQ9TWF0aC5mbG9vcihyKSksZT1lLnRyaW0oKS5yZXBsYWNlKC9eZXZhbFwodW5lc2NhcGVcKGVzY2FwZSg/OmB8XCgnfFwoInxcKGApKC4qPykoPzpgfCdcKXwiXCl8YFwpKS5yZXBsYWNlXChcL3VcKFwuXC5cKVwvZyxbIidgXVwkMSVbIidgXVwpXClcKSQvLChzLGkpPT51bmVzY2FwZShlc2NhcGUoaSkucmVwbGFjZSgvdSguLikvZywiJDElIikpKSx0aGlzLmZ1bmM9Y2UoZSl9LHRoaXMuaW5pdGlhbE9mZnNldD1udWxsLHRoaXMudD1udWxsLHRoaXMuZnVuYz1udWxsfXN0YXRpYyBnZXQgcGFyYW1ldGVyRGVzY3JpcHRvcnMoKXtyZXR1cm5be25hbWU6ImJlZ2luIixkZWZhdWx0VmFsdWU6MCxtYXg6TnVtYmVyLlBPU0lUSVZFX0lORklOSVRZLG1pbjowfSx7bmFtZToiZnJlcXVlbmN5IixkZWZhdWx0VmFsdWU6NDQwLG1pbjpOdW1iZXIuRVBTSUxPTn0se25hbWU6ImRldHVuZSIsZGVmYXVsdFZhbHVlOjAsbWluOk51bWJlci5ORUdBVElWRV9JTkZJTklUWSxtYXg6TnVtYmVyLlBPU0lUSVZFX0lORklOSVRZfSx7bmFtZToiZW5kIixkZWZhdWx0VmFsdWU6MCxtYXg6TnVtYmVyLlBPU0lUSVZFX0lORklOSVRZLG1pbjowfV19cHJvY2Vzcyh0LGUscil7aWYodGhpcy5kaXNjb25uZWN0ZWQpcmV0dXJuITE7aWYoY3VycmVudFRpbWU8PXIuYmVnaW5bMF0pcmV0dXJuITA7aWYoY3VycmVudFRpbWU+PXIuZW5kWzBdKXJldHVybiExO3RoaXMudD09bnVsbCYmKHRoaXMudD1yLmJlZ2luWzBdKnNhbXBsZVJhdGUpO2NvbnN0IHM9ZVswXTtmb3IobGV0IGk9MDtpPHNbMF0ubGVuZ3RoO2krKyl7Y29uc3Qgbz1KKGksci5kZXR1bmUpLGE9VShKKGksci5mcmVxdWVuY3kpLG8vMTAwKTtsZXQgaD10aGlzLnQvKHNhbXBsZVJhdGUvMjU2KSphK3RoaXMuaW5pdGlhbE9mZnNldDtjb25zdCBmPSgodGhpcy5mdW5jKGgpJjI1NSkvMTI3LjUtMSkqLjI7Zm9yKGxldCBwPTA7cDxzLmxlbmd0aDtwKyspc1twXVtpXT1CKGYsLS40LC40KTt0aGlzLnQ9dGhpcy50KzF9cmV0dXJuITB9fXJlZ2lzdGVyUHJvY2Vzc29yKCJieXRlLWJlYXQtcHJvY2Vzc29yIix1ZSk7Y29uc3QgZz1PYmplY3QuZnJlZXplKHtOT05FOjAsQVNZTToxLE1JUlJPUjoyLEJFTkRQOjMsQkVORE06NCxCRU5ETVA6NSxTWU5DOjYsUVVBTlQ6NyxGT0xEOjgsUFdNOjksT1JCSVQ6MTAsU1BJTjoxMSxDSEFPUzoxMixQUklNRVM6MTMsQklOQVJZOjE0LEJST1dOSUFOOjE1LFJFQ0lQUk9DQUw6MTYsV09STUhPTEU6MTcsTE9HSVNUSUM6MTgsU0lHTU9JRDoxOSxGUkFDVEFMOjIwLEZMSVA6MjF9KTtmdW5jdGlvbiBoZShuKXtyZXR1cm4gbj1uKzIxMjc5MTIyMTQrKG48PDEyKSxuPW5eMzM0NTA3MjcwMF5uPj4+MTksbj1uKzM3NDc2MTM5Mysobjw8NSksbj1uKzM1NTA2MzUxMTZebjw8OSxuPW4rNDI1MTk5Mzc5Nysobjw8Myksbj1uXjMwNDI1OTQ1Njlebj4+PjE2LG4+Pj4wfWNvbnN0IFJ0PW49PihoZShuKT4+PjgpLzE2Nzc3MjE2O2Z1bmN0aW9uIGxlKG4sdCl7bGV0IGU9MDtmb3IobGV0IHI9MDtyPHQ7cisrKWU9ZTw8MXxuJjEsbj4+Pj0xO3JldHVybiBlfWZ1bmN0aW9uIGZlKG4pe2NvbnN0IHQ9TWF0aC5mbG9vcihuKSxlPW4tdCxyPVJ0KHQpLHM9UnQodCsxKTtyZXR1cm4gcisocy1yKSplfWZ1bmN0aW9uIHBlKG4sdD00KXtsZXQgZT0uNSxyPTAscz0wLGk9MTtmb3IobGV0IG89MDtvPHQ7bysrKXIrPWUqZmUobippKSxzKz1lLGUqPS41LGkqPTI7cmV0dXJuIHIvcyoyLTF9Y29uc3QgdnQ9e307Y2xhc3MgZGUgZXh0ZW5kcyBBdWRpb1dvcmtsZXRQcm9jZXNzb3J7c3RhdGljIGdldCBwYXJhbWV0ZXJEZXNjcmlwdG9ycygpe3JldHVyblt7bmFtZToiYmVnaW4iLGRlZmF1bHRWYWx1ZTowLG1pbjowLG1heDpOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFl9LHtuYW1lOiJlbmQiLGRlZmF1bHRWYWx1ZTowLG1pbjowLG1heDpOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFl9LHtuYW1lOiJmcmVxdWVuY3kiLGRlZmF1bHRWYWx1ZTo0NDAsbWluOk51bWJlci5FUFNJTE9OfSx7bmFtZToiZGV0dW5lIixkZWZhdWx0VmFsdWU6MH0se25hbWU6ImZyZXFzcHJlYWQiLGRlZmF1bHRWYWx1ZTouMTgsbWluOjB9LHtuYW1lOiJwb3NpdGlvbiIsZGVmYXVsdFZhbHVlOjAsbWluOjAsbWF4OjF9LHtuYW1lOiJ3YXJwIixkZWZhdWx0VmFsdWU6MCxtaW46MCxtYXg6MX0se25hbWU6IndhcnBNb2RlIixkZWZhdWx0VmFsdWU6MH0se25hbWU6InZvaWNlcyIsZGVmYXVsdFZhbHVlOjEsbWluOjF9LHtuYW1lOiJwYW5zcHJlYWQiLGRlZmF1bHRWYWx1ZTouNyxtaW46MCxtYXg6MX0se25hbWU6InBoYXNlcmFuZCIsZGVmYXVsdFZhbHVlOjAsbWluOjAsbWF4OjF9XX1jb25zdHJ1Y3Rvcih0KXtzdXBlcih0KSx0aGlzLmZyYW1lTGVuPTAsdGhpcy5udW1GcmFtZXM9MCx0aGlzLnBoYXNlPVtdLHRoaXMuaW52U1I9MS9zYW1wbGVSYXRlLHRoaXMucG9ydC5vbm1lc3NhZ2U9ZT0+e2NvbnN0e3R5cGU6cixwYXlsb2FkOnN9PWUuZGF0YXx8e307aWYocj09PSJ0YWJsZSIpe2NvbnN0IGk9cy5rZXk7aWYodGhpcy5mcmFtZUxlbj1zLmZyYW1lTGVuLCF2dFtpXSl7Y29uc3Qgbz1bcy5mcmFtZXNdO2xldCBhPW9bMF07Zm9yKGxldCBoPTE7aDwxO2grKyl7Y29uc3QgYz1hLmxlbmd0aD4+MSx1PWEubWFwKGY9Pntjb25zdCBwPW5ldyBGbG9hdDMyQXJyYXkoYyk7Zm9yKGxldCBsPTA7bDxjO2wrKylwW2xdPShmWzIqbF0rZlsyKmwrMV0pLzI7cmV0dXJuIHB9KTtpZihvLnB1c2godSksYT11LGM8PTMyKWJyZWFrfXZ0W2ldPW99dGhpcy50YWJsZXM9dnRbaV0sdGhpcy5udW1GcmFtZXM9dGhpcy50YWJsZXNbMF0ubGVuZ3RofX19X21pcnJvcih0KXtyZXR1cm4gMS1NYXRoLmFicygyKnQtMSl9X3RvQml0cyh0LGU9MixyPTEyKXtjb25zdCBzPXIrKGUtcikqdDtyZXR1cm57YjpzLG46TWF0aC5yb3VuZChNYXRoLnBvdygyLHMpKX19X3dhcnBQaGFzZSh0LGUscil7c3dpdGNoKHIpe2Nhc2UgZy5OT05FOnJldHVybiB0O2Nhc2UgZy5BU1lNOntjb25zdCBzPS4wMSsuOTkqZTtyZXR1cm4gdDxzPy41KnQvczouNSsuNSoodC1zKS8oMS1zKX1jYXNlIGcuTUlSUk9SOnJldHVybiB0aGlzLl9taXJyb3IodGhpcy5fd2FycFBoYXNlKHQsZSxnLkFTWU0pKTtjYXNlIGcuQkVORFA6cmV0dXJuIE1hdGgucG93KHQsMSszKmUpO2Nhc2UgZy5CRU5ETTpyZXR1cm4gTWF0aC5wb3codCwxLygxKzMqZSkpO2Nhc2UgZy5CRU5ETVA6cmV0dXJuIGU8LjU/dGhpcy5fd2FycFBoYXNlKHQsMS0yKmUsMyk6dGhpcy5fd2FycFBoYXNlKHQsMiplLTEsMik7Y2FzZSBnLlNZTkM6e2NvbnN0IHM9TWF0aC5wb3coMTYsZSplKTtyZXR1cm4gdCpzJTF9Y2FzZSBnLlFVQU5UOntjb25zdHtuOnN9PXRoaXMuX3RvQml0cyhlKTtyZXR1cm4gZnQodCpzKS9zfWNhc2UgZy5GT0xEOntjb25zdCBpPTErTWF0aC5tYXgoMSxNYXRoLnJvdW5kKDcqZSkpO3JldHVybiBNYXRoLmFicyhMKGkqdCktLjUpKjJ9Y2FzZSBnLlBXTTp7Y29uc3Qgcz1CKC41Ky40OSooMiplLTEpLDAsMSk7cmV0dXJuIHQ8cz90L3MqLjU6LjUrKHQtcykvKDEtcykqLjV9Y2FzZSBnLk9SQklUOntjb25zdCBzPS41KmUsaT0zO3JldHVybiBMKHQrcypNYXRoLnNpbigyKk1hdGguUEkqaSp0KSl9Y2FzZSBnLlNQSU46e2NvbnN0IHM9LjUqZSx7bjppfT10aGlzLl90b0JpdHMoZSwxLDYpO3JldHVybiBMKHQrcypNYXRoLnNpbigyKk1hdGguUEkqaSp0KSl9Y2FzZSBnLkNIQU9TOntjb25zdCBpPSgzLjcrLjMqZSkqdCooMS10KTtyZXR1cm4gQigoMS1lKSp0K2UqaSwwLDEpfWNhc2UgZy5QUklNRVM6e2NvbnN0IHM9bz0+e2lmKG88MilyZXR1cm4hMTtpZihvJTI9PT0wKXJldHVybiBvPT09Mjtmb3IobGV0IGE9MzthKmE8PW87YSs9MilpZihvJWE9PT0wKXJldHVybiExO3JldHVybiEwfTtsZXR7bjppfT10aGlzLl90b0JpdHMoZSwzKTtmb3IoOyFzKGkpOylpKys7cmV0dXJuIGZ0KHQqaSkvaX1jYXNlIGcuQklOQVJZOntsZXR7YjpzfT10aGlzLl90b0JpdHMoZSwzKTtzPU1hdGgucm91bmQocyk7Y29uc3QgaT0xPDxzLG89ZnQodCppKTtyZXR1cm4gbGUobyxzKS9pfWNhc2UgZy5NT0RVTEFSOntjb25zdHtuOnN9PXRoaXMuX3RvQml0cyhlKSxpPS41KmUsbz1MKHQqcykvcztyZXR1cm4gTCh0K2kqbyl9Y2FzZSBnLkJST1dOSUFOOntjb25zdCBzPS4yNSplKnBlKDY0KnQsNCk7cmV0dXJuIEwodCtzKX1jYXNlIGcuUkVDSVBST0NBTDp7Y29uc3Qgcz0yKzQqZSxpPXQqcyxvPXQrKDEtdCkqcyxhPW8+MWUtMTI/aS9vOjA7cmV0dXJuIEIoYSwwLDEpfWNhc2UgZy5XT1JNSE9MRTp7Y29uc3Qgcz1CKC44KmUsMCwxKSxpPS41KigxLXMpLG89LjUqKDErcyk7cmV0dXJuIHQ8aT90L2kqLjU6dD5vPy41KigxKyh0LW8pLygxLW8pKTouNX1jYXNlIGcuTE9HSVNUSUM6e2xldCBzPXQ7Y29uc3QgaT0zLjYrLjQqZSxvPTErTWF0aC5yb3VuZCgyKmUpO2ZvcihsZXQgYT0wO2E8bzthKyspcz1pKnMqKDEtcyk7cmV0dXJuIEIocywwLDEpfWNhc2UgZy5TSUdNT0lEOntjb25zdCBzPTErMTAqZSxpPXQtLjUsbz0xLygxK01hdGguZXhwKC1zKmkpKSxhPTEvKDErTWF0aC5leHAoLjUqcykpLGg9MS8oMStNYXRoLmV4cCgtLjUqcykpO3JldHVybihvLWEpLyhoLWEpfWNhc2UgZy5GUkFDVEFMOntjb25zdCBzPS41Kk1hdGguc2luKDIqTWF0aC5QSSp0KSplO3JldHVybiBMKHQrcyl9Y2FzZSBnLkZMSVA6cmV0dXJuIHQ7ZGVmYXVsdDpyZXR1cm4gdH19X3NhbXBsZUZyYW1lKHQsZSl7Y29uc3Qgcj10Lmxlbmd0aCxzPWUqcjtsZXQgaT1zfDA7aT49ciYmKGk9MCk7Y29uc3Qgbz1zLWksYT10W2ldO2xldCBoPWkrMTtoPj1yJiYoaD0wKTtjb25zdCBjPXRbaF07cmV0dXJuIGErKGMtYSkqb31fY2hvb3NlTWlwKHQpe3ZhciBzO2NvbnN0IGU9Qih0LDFlLTYsNjQpO2xldCByPTA7Zm9yKDtyKzE8KCgocz10aGlzLnRhYmxlcyk9PW51bGw/dm9pZCAwOnMubGVuZ3RoKXx8MSkmJmU8dGhpcy50YWJsZXNbcl1bMF0ubGVuZ3RoLzg7KXIrKztyZXR1cm4gcn1wcm9jZXNzKHQsZSxyKXt2YXIgbztpZihjdXJyZW50VGltZT49ci5lbmRbMF0pcmV0dXJuITE7aWYoY3VycmVudFRpbWU8PXIuYmVnaW5bMF0pcmV0dXJuITA7Y29uc3Qgcz1lWzBdWzBdLGk9ZVswXVsxXXx8ZVswXVswXTtpZighdGhpcy50YWJsZXMpcmV0dXJuIHMuZmlsbCgwKSxpIT09cyYmaS5zZXQocyksITA7Zm9yKGxldCBhPTA7YTxzLmxlbmd0aDthKyspe2NvbnN0IGg9VChyLmRldHVuZSxhKSxjPVQoci5mcmVxc3ByZWFkLGEpLGY9QihUKHIucG9zaXRpb24sYSksMCwxKSoodGhpcy5udW1GcmFtZXMtMSkscD1mfDAsbD1mLXAsZD1CKFQoci53YXJwLGEpLDAsMSksbT1UKHIud2FycE1vZGUsYSksdj1UKHIudm9pY2VzLGEpLGI9QihUKHIucGhhc2VyYW5kLGEpLDAsMSksST12PjE/QihUKHIucGFuc3ByZWFkLGEpLDAsMSk6MCxNPU1hdGguc3FydCguNS0uNSpJKSxQPU1hdGguc3FydCguNSsuNSpJKTtsZXQgdz1UKHIuZnJlcXVlbmN5LGEpO3c9VSh3LGgvMTAwKTtjb25zdCB5PTEvTWF0aC5zcXJ0KHYpO2ZvcihsZXQgUz0wO1M8djtTKyspe2NvbnN0IEE9KFMmMSk9PTE7bGV0IE89TSx4PVA7QSYmKE89UCx4PU0pO2NvbnN0IE49VSh3LE50KHYsYyxTKSkqdGhpcy5pbnZTUixrPXRoaXMuX2Nob29zZU1pcChOKSxGPXRoaXMudGFibGVzW2tdO3RoaXMucGhhc2VbU109KG89dGhpcy5waGFzZVtTXSkhPW51bGw/bzpNYXRoLnJhbmRvbSgpKmI7Y29uc3QgVj10aGlzLl93YXJwUGhhc2UodGhpcy5waGFzZVtTXSxkLG0pLFI9dGhpcy5fc2FtcGxlRnJhbWUoRltwXSxWKSxZPXRoaXMuX3NhbXBsZUZyYW1lKEZbTWF0aC5taW4odGhpcy5udW1GcmFtZXMtMSxwKzEpXSxWKTtsZXQgQz1SKyhZLVIpKmw7bT09PWcuRkxJUCYmdGhpcy5waGFzZVtTXTxkJiYoQz0tQyksc1thXSs9QypPKnksaVthXSs9Qyp4KnksdGhpcy5waGFzZVtTXT1GdCh0aGlzLnBoYXNlW1NdK04pfX1yZXR1cm4hMH19cmV0dXJuIHJlZ2lzdGVyUHJvY2Vzc29yKCJ3YXZldGFibGUtb3NjaWxsYXRvci1wcm9jZXNzb3IiLGRlKSxFLldhcnBNb2RlPWcsT2JqZWN0LmRlZmluZVByb3BlcnRpZXMoRSx7X19lc01vZHVsZTp7dmFsdWU6ITB9LFtTeW1ib2wudG9TdHJpbmdUYWddOnt2YWx1ZToiTW9kdWxlIn19KSxFfSh7fSk7Cg==";

/*
audioContext.mjs - AudioContext management for wavenerd-superdough fork
This fork manages its own AudioContext to ensure all Strudel components share the same instance.
*/

let audioContext;

const getAudioContext = () => {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
};

const setDefaultAudioContext = (ac) => {
  audioContext = ac;
  return audioContext;
};

// Alias expected by @strudel/webaudio >=1.2.6
const setAudioContext = setDefaultAudioContext;

function getAudioContextCurrentTime() {
  return getAudioContext().currentTime;
}

let noiseCache = {};

// lazy generates noise buffers and keeps them forever
function getNoiseBuffer(type, density) {
  const ac = getAudioContext();
  if (noiseCache[type]) {
    return noiseCache[type];
  }
  const bufferSize = 2 * ac.sampleRate;
  const noiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  let lastOut = 0;
  let b0, b1, b2, b3, b4, b5, b6;
  b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;

  for (let i = 0; i < bufferSize; i++) {
    if (type === 'white') {
      output[i] = Math.random() * 2 - 1;
    } else if (type === 'brown') {
      let white = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
    } else if (type === 'pink') {
      let white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.11;
      b6 = white * 0.115926;
    } else if (type === 'crackle') {
      const probability = density * 0.01;
      if (Math.random() < probability) {
        output[i] = Math.random() * 2 - 1;
      } else {
        output[i] = 0;
      }
    }
  }

  // Prevent caching to randomize crackles
  if (type !== 'crackle') noiseCache[type] = noiseBuffer;
  return noiseBuffer;
}

// expects one of noises as type
function getNoiseOscillator(type = 'white', t, density = 0.02) {
  const ac = getAudioContext();
  const o = ac.createBufferSource();
  o.buffer = getNoiseBuffer(type, density);
  o.loop = true;
  o.start(t);
  return {
    node: o,
    stop: (time) => o.stop(time),
  };
}

function getNoiseMix(inputNode, wet, t) {
  const noiseOscillator = getNoiseOscillator('pink', t);
  const noiseMix = drywet(inputNode, noiseOscillator.node, wet);
  return {
    node: noiseMix,
    stop: (time) => noiseOscillator?.stop(time),
  };
}

const noises = ['pink', 'white', 'brown', 'crackle'];

function gainNode(value) {
  const node = getAudioContext().createGain();
  node.gain.value = value;
  return node;
}

function effectSend(input, effect, wet) {
  const send = gainNode(wet);
  input.connect(send);
  send.connect(effect);
  return send;
}

const getSlope = (y1, y2, x1, x2) => {
  const denom = x2 - x1;
  if (denom === 0) {
    return 0;
  }
  return (y2 - y1) / (x2 - x1);
};

function getWorklet(ac, processor, params, config) {
  const node = new AudioWorkletNode(ac, processor, config);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      node.parameters.get(key).value = value;
    }
  });
  return node;
}

const getParamADSR = (
  param,
  attack,
  decay,
  sustain,
  release,
  min,
  max,
  begin,
  end,
  //exponential works better for frequency modulations (such as filter cutoff) due to human ear perception
  curve = 'exponential',
) => {
  attack = nanFallback(attack);
  decay = nanFallback(decay);
  sustain = nanFallback(sustain);
  release = nanFallback(release);
  const ramp = curve === 'exponential' ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime';
  if (curve === 'exponential') {
    min = min === 0 ? 0.001 : min;
    max = max === 0 ? 0.001 : max;
  }
  const range = max - min;
  const peak = max;
  const sustainVal = min + sustain * range;
  const duration = end - begin;

  const envValAtTime = (time) => {
    let val;
    if (attack > time) {
      let slope = getSlope(min, peak, 0, attack);
      val = time * slope + (min > peak ? min : 0);
    } else {
      val = (time - attack) * getSlope(peak, sustainVal, 0, decay) + peak;
    }
    if (curve === 'exponential') {
      val = val || 0.001;
    }
    return val;
  };

  param.setValueAtTime(min, begin);
  if (attack > duration) {
    //attack
    param[ramp](envValAtTime(duration), end);
  } else if (attack + decay > duration) {
    //attack
    param[ramp](envValAtTime(attack), begin + attack);
    //decay
    param[ramp](envValAtTime(duration), end);
  } else {
    //attack
    param[ramp](envValAtTime(attack), begin + attack);
    //decay
    param[ramp](envValAtTime(attack + decay), begin + attack + decay);
    //sustain
    param.setValueAtTime(sustainVal, end);
  }
  //release
  param[ramp](min, end + release);
};

function getModulationShapeInput(val) {
  if (typeof val === 'number') {
    return val % 5;
  }
  return { tri: 0, triangle: 0, sine: 1, ramp: 2, saw: 3, square: 4 }[val] ?? 0;
}

function getLfo(audioContext, begin, end, properties = {}) {
  const { shape = 0, ...props } = properties;
  const { dcoffset = -0.5, depth = 1 } = properties;
  const lfoprops = {
    frequency: 1,
    depth,
    skew: 0.5,
    phaseoffset: 0,
    time: begin,
    begin,
    end,
    shape: getModulationShapeInput(shape),
    dcoffset,
    min: dcoffset * depth,
    max: dcoffset * depth + depth,
    curve: 1,
    ...props,
  };

  return getWorklet(audioContext, 'lfo-processor', lfoprops);
}

function getCompressor(ac, threshold, ratio, knee, attack, release) {
  const options = {
    threshold: threshold ?? -3,
    ratio: ratio ?? 10,
    knee: knee ?? 10,
    attack: attack ?? 0.005,
    release: release ?? 0.05,
  };
  return new DynamicsCompressorNode(ac, options);
}

// changes the default values of the envelope based on what parameters the user has defined
// so it behaves more like you would expect/familiar as other synthesis tools
// ex: sound(val).decay(val) will behave as a decay only envelope. sound(val).attack(val).decay(val) will behave like an "ad" env, etc.

const getADSRValues = (params, curve = 'linear', defaultValues) => {
  const envmin = curve === 'exponential' ? 0.001 : 0.001;
  const releaseMin = 0.01;
  const envmax = 1;
  const [a, d, s, r] = params;
  if (a == null && d == null && s == null && r == null) {
    return defaultValues ?? [envmin, envmin, envmax, releaseMin];
  }
  const sustain = s != null ? s : (a != null && d == null) || (a == null && d == null) ? envmax : envmin;
  return [Math.max(a ?? 0, envmin), Math.max(d ?? 0, envmin), Math.min(sustain, envmax), Math.max(r ?? 0, releaseMin)];
};

// helper utility for applying standard modulators to a parameter
function applyParameterModulators(audioContext, param, start, end, envelopeValues, lfoValues) {
  let { amount, offset, defaultAmount = 1, curve = 'linear', values, holdEnd, defaultValues } = envelopeValues;

  if (amount == null) {
    const hasADSRParams = values.some((p) => p != null);
    amount = hasADSRParams ? defaultAmount : 0;
  }

  const min = offset ?? 0;
  const max = amount + min;
  const diff = Math.abs(max - min);
  if (diff) {
    const [attack, decay, sustain, release] = getADSRValues(values, curve, defaultValues);
    getParamADSR(param, attack, decay, sustain, release, min, max, start, holdEnd, curve);
  }
  let lfo;
  let { defaultDepth = 1, depth, dcoffset, ...getLfoInputs } = lfoValues;

  if (depth == null) {
    const hasLFOParams = Object.values(getLfoInputs).some((v) => v != null);
    depth = hasLFOParams ? defaultDepth : 0;
  }
  if (depth) {
    lfo = getLfo(audioContext, start, end, {
      depth,
      dcoffset,
      ...getLfoInputs,
    });
    lfo.connect(param);
  }

  return { lfo, disconnect: () => lfo?.disconnect() };
}

function createFilter(context, type, frequency, Q, att, dec, sus, rel, fenv, start, end, fanchor, model, drive) {
  const curve = 'exponential';
  const [attack, decay, sustain, release] = getADSRValues([att, dec, sus, rel], curve, [0.005, 0.14, 0, 0.1]);
  let filter;
  let frequencyParam;
  if (model === 'ladder') {
    filter = getWorklet(context, 'ladder-processor', { frequency, q: Q, drive });
    frequencyParam = filter.parameters.get('frequency');
  } else {
    filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = Q;
    filter.frequency.value = frequency;
    frequencyParam = filter.frequency;
  }

  // envelope is active when any of these values is set
  const hasEnvelope = att ?? dec ?? sus ?? rel ?? fenv;
  // Apply ADSR to filter frequency
  if (hasEnvelope !== undefined) {
    fenv = nanFallback(fenv, 1, true);
    fanchor = nanFallback(fanchor, 0, true);
    const fenvAbs = Math.abs(fenv);
    const offset = fenvAbs * fanchor;
    let min = clamp(2 ** -offset * frequency, 0, 20000);
    let max = clamp(2 ** (fenvAbs - offset) * frequency, 0, 20000);
    if (fenv < 0) [min, max] = [max, min];
    getParamADSR(frequencyParam, attack, decay, sustain, release, min, max, start, end, curve);
    return filter;
  }
  return filter;
}

// stays 1 until .5, then fades out
let wetfade = (d) => (d < 0.5 ? 1 : 1 - (d - 0.5) / 0.5);

// mix together dry and wet nodes. 0 = only dry 1 = only wet
// still not too sure about how this could be used more generally...
function drywet(dry, wet, wetAmount = 0) {
  const ac = getAudioContext();
  if (!wetAmount) {
    return dry;
  }
  let dry_gain = ac.createGain();
  let wet_gain = ac.createGain();
  dry.connect(dry_gain);
  wet.connect(wet_gain);
  dry_gain.gain.value = wetfade(wetAmount);
  wet_gain.gain.value = wetfade(1 - wetAmount);
  let mix = ac.createGain();
  dry_gain.connect(mix);
  wet_gain.connect(mix);
  return mix;
}

let curves = ['linear', 'exponential'];
function getPitchEnvelope(param, value, t, holdEnd) {
  // envelope is active when any of these values is set
  const hasEnvelope = value.pattack ?? value.pdecay ?? value.psustain ?? value.prelease ?? value.penv;
  if (hasEnvelope === undefined) {
    return;
  }
  const penv = nanFallback(value.penv, 1, true);
  const curve = curves[value.pcurve ?? 0];
  let [pattack, pdecay, psustain, prelease] = getADSRValues(
    [value.pattack, value.pdecay, value.psustain, value.prelease],
    curve,
    [0.2, 0.001, 1, 0.001],
  );
  let panchor = value.panchor ?? psustain;
  const cents = penv * 100; // penv is in semitones
  const min = 0 - cents * panchor;
  const max = cents - cents * panchor;
  getParamADSR(param, pattack, pdecay, psustain, prelease, min, max, t, holdEnd, curve);
}

function getVibratoOscillator(param, value, t) {
  const { vibmod = 0.5, vib } = value;
  let vibratoOscillator;
  if (vib > 0) {
    vibratoOscillator = getAudioContext().createOscillator();
    vibratoOscillator.frequency.value = vib;
    const gain = getAudioContext().createGain();
    // Vibmod is the amount of vibrato, in semitones
    gain.gain.value = vibmod * 100;
    vibratoOscillator.connect(gain);
    gain.connect(param);
    vibratoOscillator.start(t);
    return vibratoOscillator;
  }
}
// ConstantSource inherits AudioScheduledSourceNode, which has scheduling abilities
// a bit of a hack, but it works very well :)
function webAudioTimeout(audioContext, onComplete, startTime, stopTime) {
  const constantNode = new ConstantSourceNode(audioContext);

  // Certain browsers requires audio nodes to be connected in order for their onended events
  // to fire, so we _mute it_ and then connect it to the destination
  const zeroGain = gainNode(0);
  zeroGain.connect(audioContext.destination);
  constantNode.connect(zeroGain);

  // Schedule the `onComplete` callback to occur at `stopTime`
  constantNode.onended = () => {
    // Ensure garbage collection
    try {
      zeroGain.disconnect();
    } catch {
      // pass
    }
    try {
      constantNode.disconnect();
    } catch {
      // pass
    }
    onComplete();
  };
  constantNode.start(startTime);
  constantNode.stop(stopTime);
  return constantNode;
}
const mod = (freq, range = 1, type = 'sine') => {
  const ctx = getAudioContext();
  let osc;
  if (noises.includes(type)) {
    osc = ctx.createBufferSource();
    osc.buffer = getNoiseBuffer(type, 2);
    osc.loop = true;
  } else {
    osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
  }

  osc.start();
  const g = new GainNode(ctx, { gain: range });
  osc.connect(g); // -range, range
  return { node: g, stop: (t) => osc.stop(t) };
};
const fm = (frequencyparam, harmonicityRatio, modulationIndex, wave = 'sine') => {
  const carrfreq = frequencyparam.value;
  const modfreq = carrfreq * harmonicityRatio;
  const modgain = modfreq * modulationIndex;
  return mod(modfreq, modgain, wave);
};
function applyFM(param, value, begin) {
  const {
    fmh: fmHarmonicity = 1,
    fmi: fmModulationIndex,
    fmenv: fmEnvelopeType = 'exp',
    fmattack: fmAttack,
    fmdecay: fmDecay,
    fmsustain: fmSustain,
    fmrelease: fmRelease,
    fmvelocity: fmVelocity,
    fmwave: fmWaveform = 'sine',
    duration,
  } = value;
  let modulator;
  let stop = () => {};

  if (fmModulationIndex) {
    const ac = getAudioContext();
    const envGain = ac.createGain();
    const fmmod = fm(param, fmHarmonicity, fmModulationIndex, fmWaveform);

    modulator = fmmod.node;
    stop = fmmod.stop;
    if (![fmAttack, fmDecay, fmSustain, fmRelease, fmVelocity].some((v) => v !== undefined)) {
      // no envelope by default
      modulator.connect(param);
    } else {
      const [attack, decay, sustain, release] = getADSRValues([fmAttack, fmDecay, fmSustain, fmRelease]);
      const holdEnd = begin + duration;
      getParamADSR(
        envGain.gain,
        attack,
        decay,
        sustain,
        release,
        0,
        1,
        begin,
        holdEnd,
        fmEnvelopeType === 'exp' ? 'exponential' : 'linear',
      );
      modulator.connect(envGain);
      envGain.connect(param);
    }
  }
  return { stop };
}

// Saturation curves

const __squash = (x) => x / (1 + x); // [0, inf) to [0, 1)
const _mod = (n, m) => ((n % m) + m) % m;

const _scurve = (x, k) => ((1 + k) * x) / (1 + k * Math.abs(x));
const _soft = (x, k) => Math.tanh(x * (1 + k));
const _hard = (x, k) => clamp((1 + k) * x, -1, 1);

const _fold = (x, k) => {
  // Closed form folding for audio rate
  let y = (1 + 0.5 * k) * x;
  const window = _mod(y + 1, 4);
  return 1 - Math.abs(window - 2);
};

const _sineFold = (x, k) => Math.sin((Math.PI / 2) * _fold(x, k));

const _cubic = (x, k) => {
  const t = __squash(Math.log1p(k));
  const cubic = (x - (t / 3) * x * x * x) / (1 - t / 3); // normalized to go from (-1, 1)
  return _soft(cubic, k);
};

const _diode = (x, k, asym = false) => {
  const g = 1 + 2 * k; // gain
  const t = __squash(Math.log1p(k));
  const bias = 0.07 * t;
  const pos = _soft(x + bias, 2 * k);
  const neg = _soft(asym ? bias : -x + bias, 2 * k);
  const y = pos - neg;
  // We divide by the derivative at 0 so that the distortion is roughly
  // the identity map near 0 => small values are preserved and undistorted
  const sech = 1 / Math.cosh(g * bias);
  const sech2 = sech * sech; // derivative of soft (i.e. tanh) is sech^2
  const denom = Math.max(1e-8, (asym ? 1 : 2) * g * sech2); // g from chain rule; 2 if both pos/neg have x
  return _soft(y / denom, k);
};

const _asym = (x, k) => _diode(x, k, true);

const _chebyshev = (x, k) => {
  const kl = 10 * Math.log1p(k);
  let tnm1 = 1;
  let tnm2 = x;
  let tn;
  let y = 0;
  for (let i = 1; i < 64; i++) {
    if (i < 2) {
      // Already set inital conditions
      y += i == 0 ? tnm1 : tnm2;
      continue;
    }
    tn = 2 * x * tnm1 - tnm2; // https://en.wikipedia.org/wiki/Chebyshev_polynomials#Recurrence_definition
    tnm2 = tnm1;
    tnm1 = tn;
    if (i % 2 === 0) {
      y += Math.min((1.3 * kl) / i, 2) * tn;
    }
  }
  // Soft clip
  return _soft(y, kl / 20);
};

const distortionAlgorithms = {
  scurve: _scurve,
  soft: _soft,
  hard: _hard,
  cubic: _cubic,
  diode: _diode,
  asym: _asym,
  fold: _fold,
  sinefold: _sineFold,
  chebyshev: _chebyshev,
};
const _algoNames = Object.freeze(Object.keys(distortionAlgorithms));

const getDistortionAlgorithm = (algo) => {
  let index = algo;
  if (typeof algo === 'string') {
    index = _algoNames.indexOf(algo);
    if (index === -1) {
      logger(`[superdough] Could not find waveshaping algorithm ${algo}.
        Available options are ${_algoNames.join(', ')}.
        Defaulting to ${_algoNames[0]}.`);
      index = 0;
    }
  }
  const name = _algoNames[index % _algoNames.length]; // allow for wrapping if algo was a number
  return distortionAlgorithms[name];
};

const getDistortion = (distort, postgain, algorithm) => {
  return getWorklet(getAudioContext(), 'distort-processor', { distort, postgain }, { processorOptions: { algorithm } });
};

const getFrequencyFromValue = (value, defaultNote = 36) => {
  let { note, freq } = value;
  note = note || defaultNote;
  if (typeof note === 'string') {
    note = noteToMidi(note); // e.g. c3 => 48
  }
  // get frequency
  if (!freq && typeof note === 'number') {
    freq = midiToFreq(note); // + 48);
  }

  return Number(freq);
};

const destroyAudioWorkletNode = (node) => {
  if (node == null) {
    return;
  }
  node.disconnect();
  node.parameters.get('end')?.setValueAtTime(0, 0);
};

const bufferCache = {}; // string: Promise<ArrayBuffer>
const loadCache$1 = {}; // string: Promise<ArrayBuffer>

const getCachedBuffer = (url) => bufferCache[url];

function humanFileSize$1(bytes, si) {
  var thresh = si ? 1000 : 1024;
  if (bytes < thresh) return bytes + ' B';
  var units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  var u = -1;
  do {
    bytes /= thresh;
    ++u;
  } while (bytes >= thresh);
  return bytes.toFixed(1) + ' ' + units[u];
}

function getSampleInfo(hapValue, bank) {
  const { speed = 1.0 } = hapValue;
  const { transpose, url, index, midi, label } = getCommonSampleInfo(hapValue, bank);
  let playbackRate = Math.abs(speed) * Math.pow(2, transpose / 12);
  return { transpose, url, index, midi, label, playbackRate };
}

// takes hapValue and returns buffer + playbackRate.
const getSampleBuffer = async (hapValue, bank, resolveUrl) => {
  let { url: sampleUrl, label, playbackRate } = getSampleInfo(hapValue, bank);
  if (resolveUrl) {
    sampleUrl = await resolveUrl(sampleUrl);
  }
  const ac = getAudioContext();
  const buffer = await loadBuffer$1(sampleUrl, ac, label);

  if (hapValue.unit === 'c') {
    playbackRate = playbackRate * buffer.duration;
  }
  return { buffer, playbackRate };
};

// creates playback ready AudioBufferSourceNode from hapValue
const getSampleBufferSource = async (hapValue, bank, resolveUrl) => {
  let { buffer, playbackRate } = await getSampleBuffer(hapValue, bank, resolveUrl);
  if (hapValue.speed < 0) {
    // should this be cached?
    buffer = reverseBuffer(buffer);
  }
  const ac = getAudioContext();
  const bufferSource = ac.createBufferSource();
  bufferSource.buffer = buffer;
  bufferSource.playbackRate.value = playbackRate;

  const { loopBegin = 0, loopEnd = 1, begin = 0, end = 1 } = hapValue;

  // "The computation of the offset into the sound is performed using the sound buffer's natural sample rate,
  // rather than the current playback rate, so even if the sound is playing at twice its normal speed,
  // the midway point through a 10-second audio buffer is still 5."
  const offset = begin * bufferSource.buffer.duration;

  const loop = hapValue.loop;
  if (loop) {
    bufferSource.loop = true;
    bufferSource.loopStart = loopBegin * bufferSource.buffer.duration - offset;
    bufferSource.loopEnd = loopEnd * bufferSource.buffer.duration - offset;
  }
  const bufferDuration = bufferSource.buffer.duration / bufferSource.playbackRate.value;
  const sliceDuration = (end - begin) * bufferDuration;
  return { bufferSource, offset, bufferDuration, sliceDuration };
};

const loadBuffer$1 = (url, ac, s, n = 0) => {
  const label = s ? `sound "${s}:${n}"` : 'sample';
  url = url.replace('#', '%23');
  if (!loadCache$1[url]) {
    logger(`[sampler] load ${label}..`, 'load-sample', { url });
    const timestamp = Date.now();
    loadCache$1[url] = fetch(url)
      .then((res) => res.arrayBuffer())
      .then(async (res) => {
        const took = Date.now() - timestamp;
        const size = humanFileSize$1(res.byteLength);
        // const downSpeed = humanFileSize(res.byteLength / took);
        logger(`[sampler] load ${label}... done! loaded ${size} in ${took}ms`, 'loaded-sample', { url });
        const decoded = await ac.decodeAudioData(res);
        bufferCache[url] = decoded;
        return decoded;
      });
  }
  return loadCache$1[url];
};

function reverseBuffer(buffer) {
  const ac = getAudioContext();
  const reversed = ac.createBuffer(buffer.numberOfChannels, buffer.length, ac.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    reversed.copyToChannel(buffer.getChannelData(channel).slice().reverse(), channel, channel);
  }
  return reversed;
}

const getLoadedBuffer = (url) => {
  return bufferCache[url];
};

function resolveSpecialPaths(base) {
  if (base.startsWith('bubo:')) {
    const [_, repo] = base.split(':');
    base = `github:Bubobubobubobubo/dough-${repo}`;
  }
  return base;
}

function githubPath$1(base, subpath = '') {
  if (!base.startsWith('github:')) {
    throw new Error('expected "github:" at the start of pseudoUrl');
  }
  let path = base.slice('github:'.length);
  path = path.endsWith('/') ? path.slice(0, -1) : path;

  let components = path.split('/');
  let user = components[0];
  let repo = components.length >= 2 ? components[1] : 'samples';
  let branch = components.length >= 3 ? components[2] : 'main';
  let other = components.slice(3);
  other.push(subpath ? subpath : '');
  other = other.join('/');

  return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${other}`;
}

const processSampleMap = (sampleMap, fn, baseUrl = sampleMap._base || '') => {
  return Object.entries(sampleMap).forEach(([key, value]) => {
    if (typeof value === 'string') {
      value = [value];
    }
    if (typeof value !== 'object') {
      throw new Error('wrong sample map format for ' + key);
    }
    baseUrl = value._base || baseUrl;
    baseUrl = resolveSpecialPaths(baseUrl);
    if (baseUrl.startsWith('github:')) {
      baseUrl = githubPath$1(baseUrl, '');
    }
    const fullUrl = (v) => baseUrl + v;
    if (Array.isArray(value)) {
      //return [key, value.map(replaceUrl)];
      value = value.map(fullUrl);
    } else {
      // must be object
      value = Object.fromEntries(
        Object.entries(value).map(([note, samples]) => {
          return [note, (typeof samples === 'string' ? [samples] : samples).map(fullUrl)];
        }),
      );
    }
    fn(key, value);
  });
};

// allows adding a custom url prefix handler
// for example, it is used by the desktop app to load samples starting with '~/music'
let resourcePrefixHandlers = {};
function registerSamplesPrefix(prefix, resolve) {
  resourcePrefixHandlers[prefix] = resolve;
}
// finds a prefix handler for the given url (if any)
function getSamplesPrefixHandler(url) {
  const handler = Object.entries(resourcePrefixHandlers).find(([key]) => url.startsWith(key));
  if (handler) {
    return handler[1];
  }
  return;
}

async function fetchSampleMap(url) {
  // check if custom prefix handler
  const handler = getSamplesPrefixHandler(url);
  if (handler) {
    return handler(url);
  }
  url = resolveSpecialPaths(url);
  if (url.startsWith('github:')) {
    url = githubPath$1(url, 'strudel.json');
  }
  if (url.startsWith('local:')) {
    url = `http://localhost:5432`;
  }
  if (url.startsWith('shabda:')) {
    let [_, path] = url.split('shabda:');
    url = `https://shabda.ndre.gr/${path}.json?strudel=1`;
  }
  if (url.startsWith('shabda/speech')) {
    let [_, path] = url.split('shabda/speech');
    path = path.startsWith('/') ? path.substring(1) : path;
    let [params, words] = path.split(':');
    let gender = 'f';
    let language = 'en-GB';
    if (params) {
      [language, gender] = params.split('/');
    }
    url = `https://shabda.ndre.gr/speech/${words}.json?gender=${gender}&language=${language}&strudel=1'`;
  }
  if (typeof fetch !== 'function') {
    // not a browser
    return;
  }
  const base = url.split('/').slice(0, -1).join('/');
  if (typeof fetch === 'undefined') {
    // skip fetch when in node / testing
    return;
  }
  const json = await fetch(url)
    .then((res) => res.json())
    .catch((error) => {
      console.error(error);
      throw new Error(`error loading "${url}"`);
    });
  return [json, json._base || base];
}

/**
 * Loads a collection of samples to use with `s`
 * @example
 * samples('github:tidalcycles/dirt-samples');
 * s("[bd ~]*2, [~ hh]*2, ~ sd")
 * @example
 * samples({
 *  bd: '808bd/BD0000.WAV',
 *  sd: '808sd/SD0010.WAV'
 *  }, 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/');
 * s("[bd ~]*2, [~ hh]*2, ~ sd")
 * @example
 * samples('shabda:noise,chimp:2')
 * s("noise <chimp:0*2 chimp:1>")
 * @example
 * samples('shabda/speech/fr-FR/f:chocolat')
 * s("chocolat*4")
 */

const samples = async (sampleMap, baseUrl = sampleMap._base || '', options = {}) => {
  if (typeof sampleMap === 'string') {
    const [json, base] = await fetchSampleMap(sampleMap);
    return samples(json, baseUrl || base, options);
  }
  const { prebake, tag } = options;

  processSampleMap(
    sampleMap,
    (key, bank) => {
      registerSampleSource(key, bank, { baseUrl, prebake, tag });
    },
    baseUrl,
  );
};

const cutGroups = [];

async function onTriggerSample(t, value, onended, bank, resolveUrl) {
  let {
    s,
    nudge = 0, // TODO: is this in seconds?
    cut,
    loop,
    clip = undefined, // if set, samples will be cut off when the hap ends
    n = 0,
    speed = 1, // sample playback speed
    duration,
  } = value;

  // load sample
  if (speed === 0) {
    // no playback
    return;
  }
  const ac = getAudioContext();

  // destructure adsr here, because the default should be different for synths and samples
  let [attack, decay, sustain, release] = getADSRValues([value.attack, value.decay, value.sustain, value.release]);

  const { bufferSource, sliceDuration, offset } = await getSampleBufferSource(value, bank, resolveUrl);

  // asny stuff above took too long?
  if (ac.currentTime > t) {
    logger(`[sampler] still loading sound "${s}:${n}"`, 'highlight');
    // console.warn('sample still loading:', s, n);
    return;
  }
  if (!bufferSource) {
    logger(`[sampler] could not load "${s}:${n}"`, 'error');
    return;
  }

  // vibrato
  let vibratoOscillator = getVibratoOscillator(bufferSource.detune, value, t);

  const time = t + nudge;
  bufferSource.start(time, offset);

  const envGain = ac.createGain();
  const node = bufferSource.connect(envGain);

  // if none of these controls is set, the duration of the sound will be set to the duration of the sample slice
  if (clip == null && loop == null && value.release == null) {
    duration = sliceDuration;
  }
  let holdEnd = t + duration;

  getParamADSR(node.gain, attack, decay, sustain, release, 0, 1, t, holdEnd, 'linear');

  // pitch envelope
  getPitchEnvelope(bufferSource.detune, value, t, holdEnd);

  const out = ac.createGain(); // we need a separate gain for the cutgroups because firefox...
  node.connect(out);
  bufferSource.onended = function () {
    bufferSource.disconnect();
    vibratoOscillator?.stop();
    node.disconnect();
    out.disconnect();
    onended();
  };
  let envEnd = holdEnd + release + 0.01;
  bufferSource.stop(envEnd);
  const stop = (endTime) => {
    bufferSource.stop(endTime);
  };
  const handle = { node: out, bufferSource, stop };

  // cut groups
  if (cut !== undefined) {
    const prev = cutGroups[cut];
    if (prev) {
      prev.node.gain.setValueAtTime(1, time);
      prev.node.gain.linearRampToValueAtTime(0, time + 0.01);
    }
    cutGroups[cut] = handle;
  }

  return handle;
}

function registerSample(key, bank, params) {
  registerSound(key, (t, hapValue, onended) => onTriggerSample(t, hapValue, onended, bank), {
    type: 'sample',
    samples: bank,
    ...params,
  });
}

function registerSampleSource(key, bank, params) {
  const isWavetable = key.startsWith('wt_');
  if (isWavetable) {
    registerWaveTable(key, bank, params);
  } else {
    registerSample(key, bank, params);
  }
}

let hasChanged = (now, before) => now !== undefined && now !== before;

class Orbit {
  reverbNode;
  delayNode;
  output;
  summingNode;
  djfNode;
  audioContext;
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.output = new GainNode(audioContext, { gain: 1, channelCount: 2, channelCountMode: 'explicit' });
    this.summingNode = new GainNode(audioContext, { gain: 1, channelCount: 2, channelCountMode: 'explicit' });
    this.summingNode.connect(this.output);
  }

  disconnect() {
    this.output.disconnect();
    this.summingNode.disconnect();
    this.delayNode?.disconnect();
    this.reverbNode?.disconnect();
  }

  getDjf(value, t = 0) {
    if (this.djfNode == null) {
      this.djfNode = getWorklet(this.audioContext, 'djf-processor', { value });
      this.summingNode.disconnect();
      this.summingNode.connect(this.djfNode);
      this.djfNode.connect(this.output);
    }
    const val = this.djfNode.parameters.get('value');
    val.setValueAtTime(value, t);
  }

  getDelay(delaytime = 0, feedback = 0.5, t) {
    feedback = clamp(feedback, 0, 0.98);
    if (this.delayNode == null) {
      this.delayNode = this.audioContext.createFeedbackDelay(1, delaytime, feedback);
      this.delayNode.connect(this.summingNode);
      this.delayNode.start?.(t); // for some reason, this throws when audion extension is installed..
    }
    this.delayNode.delayTime.value !== delaytime && this.delayNode.delayTime.setValueAtTime(delaytime, t);
    this.delayNode.feedback.value !== feedback && this.delayNode.feedback.setValueAtTime(feedback, t);
    return this.delayNode;
  }

  getReverb(duration, fade, lp, dim, ir, irspeed, irbegin) {
    // If no reverb has been created for a given orbit, create one
    if (this.reverbNode == null) {
      this.reverbNode = this.audioContext.createReverb(duration, fade, lp, dim, ir, irspeed, irbegin);
      this.reverbNode.connect(this.summingNode);
    }

    if (
      hasChanged(duration, this.reverbNode.duration) ||
      hasChanged(fade, this.reverbNode.fade) ||
      hasChanged(lp, this.reverbNode.lp) ||
      hasChanged(dim, this.reverbNode.dim) ||
      hasChanged(irspeed, this.reverbNode.irspeed) ||
      hasChanged(irbegin, this.reverbNode.irbegin) ||
      this.reverbNode.ir !== ir
    ) {
      // only regenerate when something has changed
      // avoids endless regeneration on things like
      // stack(s("a"), s("b").rsize(8)).room(.5)
      // this only works when args may stay undefined until here
      // setting default values breaks this
      this.reverbNode.generate(duration, fade, lp, dim, ir, irspeed, irbegin);
    }
    return this.reverbNode;
  }
  sendReverb(node, amount) {
    effectSend(node, this.reverbNode, amount);
  }

  sendDelay(node, amount) {
    effectSend(node, this.delayNode, amount);
  }

  duck(t, onsettime = 0, attacktime = 0.1, depth = 1) {
    const onset = onsettime;
    const attack = Math.max(attacktime, 0.002);
    const gainParam = this.output.gain;
    webAudioTimeout(
      this.audioContext,
      () => {
        const now = this.audioContext.currentTime;

        // cancelScheduledValues and setValueAtTime together emulate cancelAndHoldAtTime
        // on browsers which lack that method
        const currVal = gainParam.value;
        gainParam.cancelScheduledValues(now);
        gainParam.setValueAtTime(currVal, now);

        const t0 = Math.max(t, now); // guard against now > t
        const duckedVal = clamp(1 - Math.sqrt(depth), 0.01, currVal);
        gainParam.exponentialRampToValueAtTime(duckedVal, t0 + onset);
        gainParam.exponentialRampToValueAtTime(1, t0 + onset + attack);
      },
      0,
      t - 0.01,
    );
  }

  connectToOutput(node) {
    node.connect(this.summingNode);
  }
}

class SuperdoughOutput {
  channelMerger;
  destinationGain;
  customDestination;

  constructor(audioContext, customDestination = null) {
    this.audioContext = audioContext;
    this.customDestination = customDestination;
    this.initializeAudio();
  }

  initializeAudio() {
    const audioContext = this.audioContext;

    // When using custom destination, use simplified routing (stereo only)
    if (this.customDestination) {
      this.destinationGain = new GainNode(audioContext);
      this.channelMerger = new GainNode(audioContext); // Use gain node as pass-through
      this.channelMerger.connect(this.destinationGain);
      this.destinationGain.connect(this.customDestination);
    } else {
      // Original multi-channel routing to destination
      const maxChannelCount = audioContext.destination.maxChannelCount;
      this.audioContext.destination.channelCount = maxChannelCount;
      this.channelMerger = new ChannelMergerNode(audioContext, { numberOfInputs: audioContext.destination.channelCount });
      this.destinationGain = new GainNode(audioContext);
      this.channelMerger.connect(this.destinationGain);
      this.destinationGain.connect(audioContext.destination);
    }
  }

  reset() {
    this.disconnect();
    this.initializeAudio();
  }
  disconnect() {
    this.channelMerger.disconnect();
    this.destinationGain.disconnect();
    this.destinationGain = null;
    this.channelMerger = null;
  }
  connectToDestination = (input, channels = [0, 1]) => {
    // When using custom destination, use simple stereo connection
    if (this.customDestination) {
      const stereoMix = new StereoPannerNode(this.audioContext);
      input.connect(stereoMix);
      stereoMix.connect(this.channelMerger);
      return;
    }

    //This upmix can be removed if correct channel counts are set throughout the app,
    // and then strudel could theoretically support surround sound audio files
    const stereoMix = new StereoPannerNode(this.audioContext);
    input.connect(stereoMix);

    const splitter = new ChannelSplitterNode(this.audioContext, {
      numberOfOutputs: stereoMix.channelCount,
    });
    stereoMix.connect(splitter);
    channels.forEach((ch, i) => {
      splitter.connect(this.channelMerger, i % stereoMix.channelCount, ch % this.audioContext.destination.channelCount);
    });
  };
}

class SuperdoughAudioController {
  audioContext;
  output;
  nodes = {};

  constructor(audioContext, customDestination = null) {
    this.audioContext = audioContext;
    this.output = new SuperdoughOutput(audioContext, customDestination);
  }

  reset() {
    Array.from(this.nodes).forEach((node) => {
      node.disconnect();
    });
    this.nodes = {};
    this.output.reset();
  }

  duck(targetOrbits, t, onsettime = 0, attacktime = 0.1, depth = 1) {
    const targetArr = [targetOrbits].flat();
    const onsetArr = [onsettime].flat();
    const attackArr = [attacktime].flat();
    const depthArr = [depth].flat();

    targetArr.forEach((target, idx) => {
      const orbit = this.nodes[target];

      if (orbit == null) {
        errorLogger(new Error(`duck target orbit ${target} does not exist`), 'superdough');
        return;
      }
      const onset = onsetArr[idx] ?? onsetArr[0];
      const attack = Math.max(attackArr[idx] ?? attackArr[0], 0.002);
      const depth = depthArr[idx] ?? depthArr[0];

      orbit.duck(t, onset, attack, depth);
    });
  }

  getOrbit(orbitNum, channels) {
    if (this.nodes[orbitNum] == null) {
      this.nodes[orbitNum] = new Orbit(this.audioContext);
      this.output.connectToDestination(this.nodes[orbitNum].output, channels);
    }
    return this.nodes[orbitNum];
  }
}

/*
superdough.mjs - <short description TODO>
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/superdough/superdough.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// ============================================================================
// Sound Map - Using nanostores map to match original superdough API
// This ensures @strudel/webaudio (via Vite alias) uses the same soundMap instance
// ============================================================================

const soundMap = map();

function registerSound(key, onTrigger, data = {}) {
  key = key.toLowerCase().replace(/\s+/g, '_');
  soundMap.setKey(key, { onTrigger, data });
}

const aliasBank = map();

const soundAlias = (alias, original, data = {}) => {
  aliasBank.setKey(alias, { original, ...data });
};

const getSound = (s) => {
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

const resetLoadedSounds = () => {
  soundMap.set({});
  aliasBank.set({});
};

const DEFAULT_MAX_POLYPHONY = 128;
const DEFAULT_AUDIO_DEVICE_NAME = 'System Standard';

let maxPolyphony = DEFAULT_MAX_POLYPHONY;

function setMaxPolyphony(polyphony) {
  maxPolyphony = parseInt(polyphony) ?? DEFAULT_MAX_POLYPHONY;
}

let multiChannelOrbits = false;
function setMultiChannelOrbits(bool) {
  multiChannelOrbits = bool == true;
}


let gainCurveFunc = (val) => val;

function applyGainCurve(val) {
  return gainCurveFunc(val);
}

function setGainCurve(newGainCurveFunc) {
  gainCurveFunc = newGainCurveFunc;
}


const getAudioDevices = async () => {
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

function setDefault(control, value) {
  // const main = getControlName(control); // we cant do this because superdough is independent of strudel/core
  defaultDefaultValues[control] = value;
}

function resetDefaults() {
  defaultDefaultValues = { ...defaultDefaultDefaultValues };
}

let defaultControls = new Map(Object.entries(defaultDefaultValues));

function setDefaultValue(key, value) {
  defaultControls.set(key, value);
}
function getDefaultValue(key) {
  return defaultControls.get(key);
}
function setDefaultValues(defaultsobj) {
  Object.keys(defaultsobj).forEach((key) => {
    setDefaultValue(key, defaultsobj[key]);
  });
}
function resetDefaultValues() {
  defaultControls = new Map(Object.entries(defaultDefaultValues));
}
function setVersionDefaults(version) {
  resetDefaultValues();
  if (version === '1.0') {
    setDefaultValue('fanchor', 0.5);
  }
}


let externalWorklets = [];
function registerWorklet(url) {
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
async function initAudio(options = {}) {
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
async function initAudioOnFirstClick(options) {
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

// Set the default controller (expected by @strudel/webaudio >=1.2.6)
function setSuperdoughAudioController(controller) {
  defaultController = controller;
  controllers.set('default', controller);
}

// Get the default controller (for backward compatibility)
function getSuperdoughAudioController() {
  if (defaultController == null) {
    defaultController = new SuperdoughAudioController(getAudioContext());
    controllers.set('default', defaultController);
  }
  return defaultController;
}

// Create a new controller with custom destination
function createSuperdoughController(id, audioContext, customDestination) {
  const controller = new SuperdoughAudioController(audioContext, customDestination);
  controllers.set(id, controller);
  return controller;
}

// Get a specific controller by ID
function getSuperdoughController(id) {
  return controllers.get(id);
}

// Get controller by ID, falling back to default
function getControllerById(controllerId) {
  if (controllerId && controllers.has(controllerId)) {
    return controllers.get(controllerId);
  }
  return getSuperdoughAudioController();
}

function connectToDestination(input, channels) {
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
  return typeof ftype === 'number' ? filterTypes[Math.floor(_mod$1(ftype, filterTypes.length))] : ftype;
}

let analysers = {},
  analysersData = {};

function getAnalyserById(id, fftSize = 1024, smoothingTimeConstant = 0.5) {
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

function getAnalyzerData(type = 'time', id = 1) {
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

function resetGlobalEffects() {
  controller?.reset();
  analysers = {};
  analysersData = {};
}

let activeSoundSources = new Map();
//music programs/audio gear usually increments inputs/outputs from 1, we need to subtract 1 from the input because the webaudio API channels start at 0

function mapChannelNumbers(channels) {
  return (Array.isArray(channels) ? channels : [channels]).map((ch) => ch - 1);
}

const superdough = async (value, t, hapDuration, cps = 0.5, cycle = 0.5, controllerId = null) => {
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
      roomIR = await loadBuffer$1(url, ac, ir, 0);
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

const superdoughTrigger = (t, hap, ct, cps, controllerId = null) => {
  superdough(hap, t - ct, hap.duration / cps, cps, 0.5, controllerId);
};

const waveforms = ['triangle', 'square', 'sawtooth', 'sine'];
const waveformAliases = [
  ['tri', 'triangle'],
  ['sqr', 'square'],
  ['saw', 'sawtooth'],
  ['sin', 'sine'],
];

function makeSaturationCurve(amount, n_samples) {
  const k = typeof amount === 'number' ? amount : 50;
  const curve = new Float32Array(n_samples);

  for (let i = 0; i < n_samples; i++) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = Math.tanh(x * k);
  }
  return curve;
}

function registerSynthSounds() {
  [...waveforms].forEach((s) => {
    registerSound(
      s,
      (t, value, onended) => {
        const [attack, decay, sustain, release] = getADSRValues(
          [value.attack, value.decay, value.sustain, value.release],
          'linear',
          [0.001, 0.05, 0.6, 0.01],
        );

        let sound = getOscillator(s, t, value);
        let { node: o, stop, triggerRelease } = sound;

        // turn down
        const g = gainNode(0.3);

        const { duration } = value;

        o.onended = () => {
          o.disconnect();
          g.disconnect();
          onended();
        };

        const envGain = gainNode(1);
        let node = o.connect(g).connect(envGain);
        const holdEnd = t + duration;
        getParamADSR(node.gain, attack, decay, sustain, release, 0, 1, t, holdEnd, 'linear');
        const envEnd = holdEnd + release + 0.01;
        triggerRelease?.(envEnd);
        stop(envEnd);
        return {
          node,
          stop: (endTime) => {
            stop(endTime);
          },
        };
      },
      { type: 'synth', prebake: true },
    );
  });

  registerSound(
    'sbd',
    (t, value, onended) => {
      const { duration, decay = 0.5, pdecay = 0.5, penv = 36, clip } = value;
      const ctx = getAudioContext();
      const attackhold = 0.02;
      const noiselvl = 1.2;
      const noisedecay = 0.025;
      const mixGain = 1;

      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = getFrequencyFromValue(value, 29);
      o.detune.setValueAtTime(penv * 100, 0);
      o.detune.setValueAtTime(penv * 100, t);
      o.detune.exponentialRampToValueAtTime(0.001, t + pdecay);
      const g = gainNode(1);
      g.gain.setValueAtTime(1, t + attackhold);
      g.gain.exponentialRampToValueAtTime(0.001, t + attackhold + decay);
      o.start(t);

      const noise = getNoiseOscillator('brown', t, 2);
      const noiseGain = gainNode(1);
      noiseGain.gain.setValueAtTime(noiselvl, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + noisedecay);

      const sat = new WaveShaperNode(ctx);
      // tri to sine diode shaper emulation
      sat.curve = makeSaturationCurve(2, ctx.sampleRate);

      const mix = gainNode(mixGain);

      o.onended = () => {
        o.disconnect();
        g.disconnect();
        sat.disconnect();
        noise.node.disconnect();
        noiseGain.disconnect();
        mix.disconnect();
        onended();
      };

      const node = o.connect(sat).connect(g).connect(mix);
      noise.node.connect(noiseGain).connect(mix);

      const holdEnd = t + decay;
      let end = holdEnd + 0.01;
      if (clip != null) {
        end = Math.min(t + clip * duration, end);
      }

      // prevent clicking
      mix.gain.setValueAtTime(mixGain, end - 0.01);
      mix.gain.linearRampToValueAtTime(0, end);

      o.stop(end);
      noise.stop(end);

      return {
        node,
        stop: (endTime) => {
          o.stop(endTime);
        },
      };
    },
    { type: 'synth', prebake: true },
  );

  registerSound(
    'supersaw',
    (begin, value, onended) => {
      const ac = getAudioContext();
      let { duration, n, unison = 5, spread = 0.6, detune } = value;
      detune = detune ?? n ?? 0.18;
      const frequency = getFrequencyFromValue(value);

      const [attack, decay, sustain, release] = getADSRValues(
        [value.attack, value.decay, value.sustain, value.release],
        'linear',
        [0.001, 0.05, 0.6, 0.01],
      );

      const holdend = begin + duration;
      const end = holdend + release + 0.01;
      const voices = clamp(unison, 1, 100);
      let panspread = voices > 1 ? clamp(spread, 0, 1) : 0;
      let o = getWorklet(
        ac,
        'supersaw-oscillator',
        {
          frequency,
          begin,
          end,
          freqspread: detune,
          voices,
          panspread,
        },
        {
          outputChannelCount: [2],
        },
      );

      const gainAdjustment = 1 / Math.sqrt(voices);
      getPitchEnvelope(o.parameters.get('detune'), value, begin, holdend);
      const vibratoOscillator = getVibratoOscillator(o.parameters.get('detune'), value, begin);
      const fm = applyFM(o.parameters.get('frequency'), value, begin);
      let envGain = gainNode(1);
      envGain = o.connect(envGain);

      getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 0.3 * gainAdjustment, begin, holdend, 'linear');

      let timeoutNode = webAudioTimeout(
        ac,
        () => {
          destroyAudioWorkletNode(o);
          envGain.disconnect();
          onended();
          fm?.stop();
          vibratoOscillator?.stop();
        },
        begin,
        end,
      );

      return {
        node: envGain,
        stop: (time) => {
          timeoutNode.stop(time);
        },
      };
    },
    { prebake: true, type: 'synth' },
  );

  registerSound(
    'bytebeat',
    (begin, value, onended) => {
      const defaultBeats = [
        '(t%255 >= t/255%255)*255',
        '(t*(t*8%60 <= 300)|(-t)*(t*4%512 < 256))+t/400',
        't',
        't*(t >> 10^t)',
        't&128',
        't&t>>8',
        '((t%255+t%128+t%64+t%32+t%16+t%127.8+t%64.8+t%32.8+t%16.8)/3)',
        '((t%64+t%63.8+t%64.15+t%64.35+t%63.5)/1.25)',
        '(t&(t>>7)-t)',
        '(sin(t*PI/128)*127+127)',
        '((t^t/2+t+64*(sin((t*PI/64)+(t*PI/32768))+64))%128*2)',
        '((t^t/2+t+64*(cos >> 0))%127.85*2)',
        '((t^t/2+t+64)%128*2)',
        '(((t * .25)^(t * .25)/100+(t * .25))%128)*2',
        '((t^t/2+t+64)%7 * 24)',
      ];
      const { n = 0 } = value;
      const frequency = getFrequencyFromValue(value);
      const { byteBeatExpression = defaultBeats[n % defaultBeats.length], byteBeatStartTime } = value;

      const ac = getAudioContext();

      let { duration } = value;
      const [attack, decay, sustain, release] = getADSRValues(
        [value.attack, value.decay, value.sustain, value.release],
        'linear',
        [0.001, 0.05, 0.6, 0.01],
      );
      const holdend = begin + duration;
      const end = holdend + release + 0.01;

      let o = getWorklet(
        ac,
        'byte-beat-processor',
        {
          frequency,
          begin,
          end,
        },
        {
          outputChannelCount: [2],
        },
      );

      o.port.postMessage({ codeText: byteBeatExpression, byteBeatStartTime, frequency });

      let envGain = gainNode(1);
      envGain = o.connect(envGain);

      getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 1, begin, holdend, 'linear');

      let timeoutNode = webAudioTimeout(
        ac,
        () => {
          destroyAudioWorkletNode(o);
          envGain.disconnect();
          onended();
        },
        begin,
        end,
      );

      return {
        node: envGain,
        stop: (time) => {
          timeoutNode.stop(time);
        },
      };
    },
    { prebake: true, type: 'synth' },
  );

  registerSound(
    'pulse',
    (begin, value, onended) => {
      const ac = getAudioContext();
      let { pwrate, pwsweep } = value;
      if (pwsweep == null) {
        if (pwrate != null) {
          pwsweep = 0.3;
        } else {
          pwsweep = 0;
        }
      }

      if (pwrate == null && pwsweep != null) {
        pwrate = 1;
      }

      let { duration, pw: pulsewidth = 0.5 } = value;
      const frequency = getFrequencyFromValue(value);

      const [attack, decay, sustain, release] = getADSRValues(
        [value.attack, value.decay, value.sustain, value.release],
        'linear',
        [0.001, 0.05, 0.6, 0.01],
      );
      const holdend = begin + duration;
      const end = holdend + release + 0.01;
      let o = getWorklet(
        ac,
        'pulse-oscillator',
        {
          frequency,
          begin,
          end,
          pulsewidth,
        },
        {
          outputChannelCount: [2],
        },
      );

      getPitchEnvelope(o.parameters.get('detune'), value, begin, holdend);
      const vibratoOscillator = getVibratoOscillator(o.parameters.get('detune'), value, begin);
      const fm = applyFM(o.parameters.get('frequency'), value, begin);
      let envGain = gainNode(1);
      envGain = o.connect(envGain);

      getParamADSR(envGain.gain, attack, decay, sustain, release, 0, 1, begin, holdend, 'linear');
      let lfo;
      if (pwsweep != 0) {
        lfo = getLfo(ac, begin, end, { frequency: pwrate, depth: pwsweep });
        lfo.connect(o.parameters.get('pulsewidth'));
      }
      let timeoutNode = webAudioTimeout(
        ac,
        () => {
          destroyAudioWorkletNode(o);
          destroyAudioWorkletNode(lfo);
          envGain.disconnect();
          onended();
          fm?.stop();
          vibratoOscillator?.stop();
        },
        begin,
        end,
      );

      return {
        node: envGain,
        stop: (time) => {
          timeoutNode.stop(time);
        },
      };
    },
    { prebake: true, type: 'synth' },
  );

  [...noises].forEach((s) => {
    registerSound(
      s,
      (t, value, onended) => {
        const [attack, decay, sustain, release] = getADSRValues(
          [value.attack, value.decay, value.sustain, value.release],
          'linear',
          [0.001, 0.05, 0.6, 0.01],
        );

        let sound;

        let { density } = value;
        sound = getNoiseOscillator(s, t, density);

        let { node: o, stop, triggerRelease } = sound;

        // turn down
        const g = gainNode(0.3);

        const { duration } = value;

        o.onended = () => {
          o.disconnect();
          g.disconnect();
          onended();
        };

        const envGain = gainNode(1);
        let node = o.connect(g).connect(envGain);
        const holdEnd = t + duration;
        getParamADSR(node.gain, attack, decay, sustain, release, 0, 1, t, holdEnd, 'linear');
        const envEnd = holdEnd + release + 0.01;
        triggerRelease?.(envEnd);
        stop(envEnd);
        return {
          node,
          stop: (endTime) => {
            stop(endTime);
          },
        };
      },
      { type: 'synth', prebake: true },
    );
  });
  waveformAliases.forEach(([alias, actual]) => soundMap.set({ ...soundMap.get(), [alias]: soundMap.get()[actual] }));
}

function waveformN(partials, type) {
  const real = new Float32Array(partials + 1);
  const imag = new Float32Array(partials + 1);
  const ac = getAudioContext();
  const osc = ac.createOscillator();

  const terms = {
    sawtooth: (n) => [0, -1 / n],
    square: (n) => [0, n % 2 === 0 ? 0 : 1 / n],
    triangle: (n) => [n % 2 === 0 ? 0 : 1 / (n * n), 0],
  };

  if (!terms[type]) {
    throw new Error(`unknown wave type ${type}`);
  }

  real[0] = 0; // dc offset
  imag[0] = 0;
  let n = 1;
  while (n <= partials) {
    const [r, i] = terms[type](n);
    real[n] = r;
    imag[n] = i;
    n++;
  }

  const wave = ac.createPeriodicWave(real, imag);
  osc.setPeriodicWave(wave);
  return osc;
}

// expects one of waveforms as s
function getOscillator(s, t, value) {
  let { n: partials, duration, noise = 0 } = value;
  let o;
  // If no partials are given, use stock waveforms
  if (!partials || s === 'sine') {
    o = getAudioContext().createOscillator();
    o.type = s || 'triangle';
  }
  // generate custom waveform if partials are given
  else {
    o = waveformN(partials, s);
  }
  // set frequency
  o.frequency.value = getFrequencyFromValue(value);
  o.start(t);

  let vibratoOscillator = getVibratoOscillator(o.detune, value, t);

  // pitch envelope
  getPitchEnvelope(o.detune, value, t, t + duration);
  const fmModulator = applyFM(o.frequency, value, t);

  let noiseMix;
  if (noise) {
    noiseMix = getNoiseMix(o, noise, t);
  }

  return {
    node: noiseMix?.node || o,
    stop: (time) => {
      fmModulator.stop(time);
      vibratoOscillator?.stop(time);
      noiseMix?.stop(time);
      o.stop(time);
    },
    triggerRelease: (time) => {
      // envGain?.stop(time);
    },
  };
}

// https://github.com/KilledByAPixel/ZzFX/blob/master/ZzFX.js#L85C5-L180C6
// changes: replaced this.volume with 1 + using sampleRate from getAudioContext()
function buildSamples(
  volume = 1,
  randomness = 0.05,
  frequency = 220,
  attack = 0,
  sustain = 0,
  release = 0.1,
  shape = 0,
  shapeCurve = 1,
  slide = 0,
  deltaSlide = 0,
  pitchJump = 0,
  pitchJumpTime = 0,
  repeatTime = 0,
  noise = 0,
  modulation = 0,
  bitCrush = 0,
  delay = 0,
  sustainVolume = 1,
  decay = 0,
  tremolo = 0,
) {
  // init parameters
  let PI2 = Math.PI * 2,
    sampleRate = getAudioContext().sampleRate,
    sign = (v) => (v > 0 ? 1 : -1),
    startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate),
    startFrequency = (frequency *= ((1 + randomness * 2 * Math.random() - randomness) * PI2) / sampleRate),
    b = [],
    t = 0,
    tm = 0,
    i = 0,
    j = 1,
    r = 0,
    c = 0,
    s = 0,
    f,
    length;

  // scale by sample rate
  attack = attack * sampleRate + 9; // minimum attack to prevent pop
  decay *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;
  delay *= sampleRate;
  deltaSlide *= (500 * PI2) / sampleRate ** 3;
  modulation *= PI2 / sampleRate;
  pitchJump *= PI2 / sampleRate;
  pitchJumpTime *= sampleRate;
  repeatTime = (repeatTime * sampleRate) | 0;

  // generate waveform
  for (length = (attack + decay + sustain + release + delay) | 0; i < length; b[i++] = s) {
    if (!(++c % ((bitCrush * 100) | 0))) {
      // bit crush
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3 // wave shape
              ? Math.sin((t % PI2) ** 3) // 4 noise
              : Math.max(Math.min(Math.tan(t), 1), -1) // 3 tan
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2) // 2 saw
          : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2) // 1 triangle
        : Math.sin(t); // 0 sin

      s =
        (repeatTime
          ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) // tremolo
          : 1) *
        sign(s) *
        Math.abs(s) ** shapeCurve * // curve 0=square, 2=pointy
        volume *
        1 * // envelope
        (i < attack
          ? i / attack // attack
          : i < attack + decay // decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume) // decay falloff
            : i < attack + decay + sustain // sustain
              ? sustainVolume // sustain volume
              : i < length - delay // release
                ? ((length - i - delay) / release) * // release falloff
                  sustainVolume // release volume
                : 0); // post release

      s = delay
        ? s / 2 +
          (delay > i
            ? 0 // delay
            : ((i < length - delay ? 1 : (length - i) / delay) * // release delay
                b[(i - delay) | 0]) /
              2)
        : s; // sample delay
    }

    f =
      (frequency += slide += deltaSlide) * // frequency
      Math.cos(modulation * tm++); // modulation
    t += f - f * noise * (1 - (((Math.sin(i) + 1) * 1e9) % 2)); // noise

    if (j && ++j > pitchJumpTime) {
      // pitch jump
      frequency += pitchJump; // apply pitch jump
      startFrequency += pitchJump; // also apply to start
      j = 0; // stop pitch jump time
    }

    if (repeatTime && !(++r % repeatTime)) {
      // repeat
      frequency = startFrequency; // reset frequency
      slide = startSlide; // reset slide
      j ||= 1; // reset pitch jump time
    }
  }

  return b;
}

//import { ZZFX } from 'zzfx';

const getZZFX = (value, t) => {
  let {
    s,
    note = 36,
    freq,
    //
    zrand = 0,
    attack = 0,
    decay = 0,
    sustain = 0.8,
    release = 0.1,
    curve = 1,
    slide = 0,
    deltaSlide = 0,
    pitchJump = 0,
    pitchJumpTime = 0,
    lfo = 0,
    znoise = 0,
    zmod = 0,
    zcrush = 0,
    zdelay = 0,
    tremolo = 0,
    duration = 0.2,
    zzfx,
  } = value;
  const sustainTime = Math.max(duration - attack - decay, 0);
  if (typeof note === 'string') {
    note = noteToMidi(note); // e.g. c3 => 48
  }
  // get frequency
  if (!freq && typeof note === 'number') {
    freq = midiToFreq(note);
  }
  s = s.replace('z_', '');
  const shape = ['sine', 'triangle', 'sawtooth', 'tan', 'noise'].indexOf(s) || 0;
  curve = s === 'square' ? 0 : curve;

  const params = zzfx || [
    0.25, // volume
    zrand,
    freq,
    attack,
    sustainTime,
    release,
    shape,
    curve,
    slide,
    deltaSlide,
    pitchJump,
    pitchJumpTime,
    lfo,
    znoise,
    zmod,
    zcrush,
    zdelay,
    sustain, // sustain volume!
    decay,
    tremolo,
  ];
  // console.log(redableZZFX(params));

  const samples = /* ZZFX. */ buildSamples(...params);
  const context = getAudioContext();
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = getAudioContext().createBufferSource();
  source.buffer = buffer;
  source.start(t);
  return {
    node: source,
  };
};

function registerZZFXSounds() {
  ['zzfx', 'z_sine', 'z_sawtooth', 'z_triangle', 'z_square', 'z_tan', 'z_noise'].forEach((wave) => {
    registerSound(
      wave,
      (t, value, onended) => {
        const { node: o } = getZZFX({ s: wave, ...value }, t);
        o.onended = () => {
          o.disconnect();
          onended();
        };
        return {
          node: o,
          stop: () => {},
        };
      },
      { type: 'synth', prebake: true },
    );
  });
}

let worklet;
async function dspWorklet(ac, code) {
  const name = `dsp-worklet-${Date.now()}`;
  const workletCode = `${code}
let __q = []; // trigger queue
class MyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.t = 0;
    this.stopped = false;
    this.port.onmessage = (e) => {
      if(e.data==='stop') {
        this.stopped = true;
      } else if(e.data?.dough) {
        __q.push(e.data)
      } else {
        msg?.(e.data)
      }
    };
  }
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if(__q.length) {
      for(let i=0;i<__q.length;++i) {
        const deadline = __q[i].time-currentTime;
        if(deadline<=0) {
          trigger(__q[i].dough)
          __q.splice(i,1)
        }
      }
    }
    for (let i = 0; i < output[0].length; i++) {
      const out = dsp(this.t / sampleRate);
      output.forEach((channel) => {
        channel[i] = out;
      });
      this.t++;
    }
  return !this.stopped;
  }
}
registerProcessor('${name}', MyProcessor);
`;
  const base64String = btoa(workletCode);
  const dataURL = `data:text/javascript;base64,${base64String}`;
  await ac.audioWorklet.addModule(dataURL);
  const node = new AudioWorkletNode(ac, name);
  const stop = () => node.port.postMessage('stop');
  return { node, stop };
}
const stop = () => {
  if (worklet) {
    worklet?.stop();
    worklet?.node?.disconnect();
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data === 'strudel-stop') {
      stop();
    } else if (e.data?.dough) {
      worklet?.node.port.postMessage(e.data);
    }
  });
}

const dough = async (code) => {
  const ac = getAudioContext();
  stop();
  worklet = await dspWorklet(ac, code);
  worklet.node.connect(ac.destination);
};

function doughTrigger(hap, currentTime, cps, targetTime) {
  window.postMessage({ time: targetTime, dough: hap.value, currentTime, duration: hap.duration, cps });
}

const Warpmode = Object.freeze({
  NONE: 0,
  ASYM: 1,
  MIRROR: 2,
  BENDP: 3,
  BENDM: 4,
  BENDMP: 5,
  SYNC: 6,
  QUANT: 7,
  FOLD: 8,
  PWM: 9,
  ORBIT: 10,
  SPIN: 11,
  CHAOS: 12,
  PRIMES: 13,
  BINARY: 14,
  BROWNIAN: 15,
  RECIPROCAL: 16,
  WORMHOLE: 17,
  LOGISTIC: 18,
  SIGMOID: 19,
  FRACTAL: 20,
  FLIP: 21,
});

const seenKeys = new Set();
async function getPayload(url, label, frameLen = 2048) {
  const key = `${url},${frameLen}`;
  if (!seenKeys.has(key)) {
    const buf = await loadBuffer(url, label);
    const ch0 = buf.getChannelData(0);
    const total = ch0.length;
    const numFrames = Math.max(1, Math.floor(total / frameLen));
    const frames = new Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      const start = i * frameLen;
      frames[i] = ch0.subarray(start, start + frameLen);
    }
    seenKeys.add(key);
    return { frames, frameLen, numFrames, key };
  }
  return { frameLen, key }; // worklet will use the cached version
}

function humanFileSize(bytes, si) {
  var thresh = si ? 1000 : 1024;
  if (bytes < thresh) return bytes + ' B';
  var units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  var u = -1;
  do {
    bytes /= thresh;
    ++u;
  } while (bytes >= thresh);
  return bytes.toFixed(1) + ' ' + units[u];
}

// Extract the sample rate of a .wav file
function parseWavSampleRate(arrBuf) {
  const dv = new DataView(arrBuf);
  // Header is "RIFF<chunk size (4 bytes)>WAVE", so 12 bytes
  let p = 12;
  // Look through chunks for the format header
  // (they will always have an 8 byte header (id and size) followed by a payload)
  while (p + 8 <= dv.byteLength) {
    // Parse id
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    // Parse chunk size
    const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      // The format chunk contains the sample rate after
      // 8 bytes of header, 2 bytes of format tag, 2 bytes of num channels
      // (for a total of 12)
      return dv.getUint32(p + 12, true);
    }
    // Advance to next chunk
    p += 8 + size + (size & 1);
  }
  return null;
}

async function decodeAtNativeRate(arr) {
  const sr = parseWavSampleRate(arr) || 44100;
  const tempAC = new OfflineAudioContext(1, 1, sr);
  return await tempAC.decodeAudioData(arr);
}

const loadCache = {};
const loadBuffer = (url, label) => {
  url = url.replace('#', '%23');
  if (!loadCache[url]) {
    logger(`[wavetable] load table ${label}..`, 'load-table', { url });
    const timestamp = Date.now();
    loadCache[url] = fetch(url)
      .then((res) => res.arrayBuffer())
      .then(async (res) => {
        const took = Date.now() - timestamp;
        const size = humanFileSize(res.byteLength);
        logger(`[wavetable] load table ${label}... done! loaded ${size} in ${took}ms`, 'loaded-table', { url });
        const decoded = await decodeAtNativeRate(res);
        return decoded;
      });
  }
  return loadCache[url];
};

function githubPath(base, subpath = '') {
  if (!base.startsWith('github:')) {
    throw new Error('expected "github:" at the start of pseudoUrl');
  }
  let [_, path] = base.split('github:');
  path = path.endsWith('/') ? path.slice(0, -1) : path;
  if (path.split('/').length === 2) {
    // assume main as default branch if none set
    path += '/main';
  }
  return `https://raw.githubusercontent.com/${path}/${subpath}`;
}

const _processTables = (json, baseUrl, frameLen, options = {}) => {
  baseUrl = json._base || baseUrl;
  return Object.entries(json).forEach(([key, tables]) => {
    if (key === '_base') return false;
    if (typeof tables === 'string') {
      tables = [tables];
    }
    if (typeof tables !== 'object') {
      throw new Error('wrong json format for ' + key);
    }
    let resolvedUrl = baseUrl;
    if (resolvedUrl.startsWith('github:')) {
      resolvedUrl = githubPath(resolvedUrl, '');
    }
    tables = tables
      .map((t) => resolvedUrl + t)
      .filter((t) => {
        if (!t.toLowerCase().endsWith('.wav')) {
          logger(`[wavetable] skipping ${t} -- wavetables must be ".wav" format`);
          return false;
        }
        return true;
      });
    if (tables.length) {
      registerWaveTable(key, tables, { baseUrl, frameLen });
    }
  });
};

function registerWaveTable(key, tables, params) {
  registerSound(
    key,
    (t, hapValue, onended, cps) => {
      return onTriggerSynth(t, hapValue, onended, tables, cps, params?.frameLen ?? 2048);
    },
    {
      type: 'wavetable',
      tables,
      ...params,
    },
  );
}

/**
 * Loads a collection of wavetables to use with `s`
 *
 * @name tables
 */
const tables = async (url, frameLen, json, options = {}) => {
  if (json !== undefined) return _processTables(json, url, frameLen);
  if (url.startsWith('github:')) {
    url = githubPath(url, 'strudel.json');
  }
  if (url.startsWith('local:')) {
    url = `http://localhost:5432`;
  }
  if (typeof fetch !== 'function') {
    // not a browser
    return;
  }
  if (typeof fetch === 'undefined') {
    // skip fetch when in node / testing
    return;
  }
  return fetch(url)
    .then((res) => res.json())
    .then((json) => _processTables(json, url, frameLen, options))
    .catch((error) => {
      console.error(error);
      throw new Error(`error loading "${url}"`);
    });
};

async function onTriggerSynth(t, value, onended, tables, cps, frameLen) {
  const { s, n = 0, duration, clip } = value;
  const ac = getAudioContext();
  const [attack, decay, sustain, release] = getADSRValues([value.attack, value.decay, value.sustain, value.release]);
  let { warpmode } = value;
  if (typeof warpmode === 'string') {
    warpmode = Warpmode[warpmode.toUpperCase()] ?? Warpmode.NONE;
  }
  const frequency = getFrequencyFromValue(value);
  const { url, label } = getCommonSampleInfo(value, tables);
  const payload = await getPayload(url, label, frameLen);
  let holdEnd = t + duration;
  if (clip !== undefined) {
    holdEnd = Math.min(t + clip * duration, holdEnd);
  }
  const endWithRelease = holdEnd + release;
  const envEnd = endWithRelease + 0.01;
  const source = getWorklet(
    ac,
    'wavetable-oscillator-processor',
    {
      begin: t,
      end: envEnd,
      frequency,
      freqspread: value.detune,
      position: value.wt,
      warp: value.warp,
      warpMode: warpmode,
      voices: Math.max(value.unison ?? 1, 1),
      panspread: value.spread,
      phaserand: (value.wtphaserand ?? value.unison > 1) ? 1 : 0,
    },
    { outputChannelCount: [2] },
  );
  source.port.postMessage({ type: 'table', payload });
  if (ac.currentTime > t) {
    logger(`[wavetable] still loading sound "${s}:${n}"`, 'highlight');
    return;
  }
  const posADSRParams = [value.wtattack, value.wtdecay, value.wtsustain, value.wtrelease];
  const warpADSRParams = [value.warpattack, value.warpdecay, value.warpsustain, value.warprelease];
  const wtParams = source.parameters;
  const positionParam = wtParams.get('position');
  const warpParam = wtParams.get('warp');

  let wtrate = value.wtrate;
  if (value.wtsync != null) {
    wtrate = cps * value.wtsync;
  }

  const wtPosModulators = applyParameterModulators(
    ac,
    positionParam,
    t,
    endWithRelease,
    {
      offset: value.wt,
      amount: value.wtenv,
      defaultAmount: 0.5,
      shape: 'linear',
      values: posADSRParams,
      holdEnd,
      defaultValues: [0, 0.5, 0, 0.1],
    },
    {
      frequency: wtrate,
      depth: value.wtdepth,
      defaultDepth: 0.5,
      shape: value.wtshape,
      skew: value.wtskew,
      dcoffset: value.wtdc ?? 0,
    },
  );

  let warprate = value.warprate;
  if (value.warpsync != null) {
    warprate = warprate = cps * value.warpsync;
  }
  const wtWarpModulators = applyParameterModulators(
    ac,
    warpParam,
    t,
    endWithRelease,
    {
      offset: value.warp,
      amount: value.warpenv,
      defaultAmount: 0.5,
      shape: 'linear',
      values: warpADSRParams,
      holdEnd,
      defaultValues: [0, 0.5, 0, 0.1],
    },
    {
      frequency: warprate,
      depth: value.warpdepth,
      defaultDepth: 0.5,
      shape: value.warpshape,
      skew: value.warpskew,
      dcoffset: value.warpdc ?? 0,
    },
  );
  const vibratoOscillator = getVibratoOscillator(source.parameters.get('detune'), value, t);
  const fm = applyFM(source.parameters.get('frequency'), value, t);
  const envGain = ac.createGain();
  const node = source.connect(envGain);
  getParamADSR(node.gain, attack, decay, sustain, release, 0, 0.3, t, holdEnd, 'linear');
  getPitchEnvelope(source.parameters.get('detune'), value, t, holdEnd);
  const handle = { node, source };
  const timeoutNode = webAudioTimeout(
    ac,
    () => {
      destroyAudioWorkletNode(source);
      vibratoOscillator?.stop();
      fm?.stop();
      node.disconnect();
      wtPosModulators?.disconnect();
      wtWarpModulators?.disconnect();
      onended();
    },
    t,
    envEnd,
  );
  handle.stop = (time) => {
    timeoutNode.stop(time);
  };
  return handle;
}

export { DEFAULT_MAX_POLYPHONY, Warpmode, aliasBank, analysers, analysersData, applyFM, applyGainCurve, applyParameterModulators, connectToDestination, createFilter, createSuperdoughController, destroyAudioWorkletNode, distortionAlgorithms, dough, doughTrigger, drywet, dspWorklet, effectSend, errorLogger, fetchSampleMap, gainNode, getADSRValues, getAnalyserById, getAnalyzerData, getAudioContext, getAudioContextCurrentTime, getAudioDevices, getCachedBuffer, getCompressor, getDefaultValue, getDistortion, getDistortionAlgorithm, getFrequencyFromValue, getLfo, getLoadedBuffer, getOscillator, getParamADSR, getPitchEnvelope, getSampleBuffer, getSampleBufferSource, getSampleInfo, getSound, getSuperdoughController, getVibratoOscillator, getWorklet, getZZFX, initAudio, initAudioOnFirstClick, loadBuffer$1 as loadBuffer, logger, noises, onTriggerSample, onTriggerSynth, processSampleMap, registerSampleSource, registerSamplesPrefix, registerSound, registerSynthSounds, registerWaveTable, registerWorklet, registerZZFXSounds, resetDefaultValues, resetDefaults, resetGlobalEffects, resetLoadedSounds, reverseBuffer, samples, setAudioContext, setDefault, setDefaultAudioContext, setDefaultValue, setDefaultValues, setGainCurve, setLogger, setMaxPolyphony, setMultiChannelOrbits, setSuperdoughAudioController, setVersionDefaults, soundAlias, soundMap, superdough, superdoughTrigger, tables, waveformN, webAudioTimeout };
