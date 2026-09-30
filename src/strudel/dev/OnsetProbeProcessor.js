// Posts the frame of each rising edge, per input channel.
// Dev tool only (?strudelDev).
const THRESHOLD_ON = 0.1;
const THRESHOLD_OFF = 0.01;
const REARM_FRAMES = 4800; // 100ms of silence at 48kHz

class OnsetProbeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = [true, true];
    this.quiet = [0, 0];
  }

  process(inputs) {
    const input = inputs[0];

    for (let ch = 0; ch < 2; ch++) {
      const data = input[ch];
      if (data == null) { continue; }

      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);

        if (v > THRESHOLD_ON) {
          if (this.armed[ch]) {
            this.port.postMessage({ ch, frame: currentFrame + i });
            this.armed[ch] = false;
          }
          this.quiet[ch] = 0;
        } else if (v < THRESHOLD_OFF) {
          this.quiet[ch]++;
          if (this.quiet[ch] > REARM_FRAMES) {
            this.armed[ch] = true;
          }
        } else {
          this.quiet[ch] = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor('onset-probe-processor', OnsetProbeProcessor);
