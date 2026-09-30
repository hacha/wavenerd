const BLOCKS_PER_TICK = 4;

/**
 * Posts a message every few blocks. Runs on the audio thread, so it keeps its pace
 * while the timers of the main thread are throttled.
 */
class TickProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.blocks = 0;
  }

  process() {
    this.blocks += 1;

    if (this.blocks >= BLOCKS_PER_TICK) {
      this.blocks = 0;
      this.port.postMessage(null);
    }

    return true;
  }
}

registerProcessor('tick-processor', TickProcessor);
