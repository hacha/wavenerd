// the K-weighting of ITU-R BS.1770, the coefficients for any sample rate as in libebur128
function kWeightingCoefficients(sampleRate) {
  // stage 1: high shelf
  const shelfF0 = 1681.974450955533;
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;

  let k = Math.tan(Math.PI * shelfF0 / sampleRate);
  const vh = Math.pow(10.0, shelfGain / 20.0);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1.0 + k / shelfQ + k * k;

  const shelf = {
    b0: (vh + vb * k / shelfQ + k * k) / a0,
    b1: 2.0 * (k * k - vh) / a0,
    b2: (vh - vb * k / shelfQ + k * k) / a0,
    a1: 2.0 * (k * k - 1.0) / a0,
    a2: (1.0 - k / shelfQ + k * k) / a0,
  };

  // stage 2: highpass
  const hpF0 = 38.13547087602444;
  const hpQ = 0.5003270373238773;

  k = Math.tan(Math.PI * hpF0 / sampleRate);
  a0 = 1.0 + k / hpQ + k * k;

  const highpass = {
    b0: 1.0,
    b1: -2.0,
    b2: 1.0,
    a1: 2.0 * (k * k - 1.0) / a0,
    a2: (1.0 - k / hpQ + k * k) / a0,
  };

  return [shelf, highpass];
}

/**
 * Sends the K-weighted energy and the sample peak of the input every 100 ms,
 * the step of the gating blocks of BS.1770. `LoudnessMeter` makes the loudness out of them.
 */
class LoudnessMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.stages = kWeightingCoefficients(sampleRate);

    // [channel][stage] = [z1, z2], transposed direct form II
    this.states = [0, 1].map(() => this.stages.map(() => [0.0, 0.0]));

    this.stepSize = Math.round(sampleRate * 0.1);
    this.frames = 0;
    this.sumSquares = [0.0, 0.0];
    this.peak = 0.0;
  }

  /**
   * @param {Float32Array[][]} inputs
   */
  process(inputs) {
    const input = inputs[0] ?? [];
    const length = input[0]?.length ?? 128;

    // a mono input counts once, as BS.1770 does
    for (let iCh = 0; iCh < Math.min(input.length, 2); iCh++) {
      const data = input[iCh];
      const state = this.states[iCh];
      let sum = 0.0;

      for (let i = 0; i < length; i++) {
        const x = data[i];
        this.peak = Math.max(this.peak, Math.abs(x));

        let y = x;
        for (let iStage = 0; iStage < this.stages.length; iStage++) {
          const { b0, b1, b2, a1, a2 } = this.stages[iStage];
          const z = state[iStage];
          const out = b0 * y + z[0];
          z[0] = b1 * y - a1 * out + z[1];
          z[1] = b2 * y - a2 * out;
          y = out;
        }

        sum += y * y;
      }

      this.sumSquares[iCh] += sum;
    }

    this.frames += length;

    if (this.frames >= this.stepSize) {
      // the mean square summed over the channels
      const energy = (this.sumSquares[0] + this.sumSquares[1]) / this.frames;
      this.port.postMessage({ energy, peak: this.peak });

      this.frames = 0;
      this.sumSquares = [0.0, 0.0];
      this.peak = 0.0;
    }

    return true;
  }
}

registerProcessor('loudness-meter-processor', LoudnessMeterProcessor);
