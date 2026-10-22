import processorUrl from './LoudnessMeterProcessor.js?url';

export interface LoudnessMeterStep {
  /** The K-weighted mean square of the last 100 ms, summed over the channels. */
  energy: number;

  /** The sample peak of the last 100 ms. */
  peak: number;
}

/**
 * Measures the loudness of the input as in ITU-R BS.1770. See `LoudnessMeter`.
 */
export class LoudnessMeterNode extends AudioWorkletNode {
  public static addModule(audio: AudioContext): Promise<void> {
    return audio.audioWorklet.addModule(processorUrl);
  }

  public onstep: ((step: LoudnessMeterStep) => void) | null = null;

  public constructor(audio: AudioContext) {
    super(audio, 'loudness-meter-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    this.port.onmessage = (event) => this.onstep?.(event.data as LoudnessMeterStep);
  }
}
