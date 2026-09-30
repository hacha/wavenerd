import processorUrl from './TickProcessor.js?url';

/**
 * Calls listeners from the audio thread, about every 10ms while the AudioContext is running.
 * Unlike `setTimeout` / `setInterval`, it is not throttled when the tab is hidden and silent.
 */
export class TickNode extends AudioWorkletNode {
  public static addModule(audio: AudioContext): Promise<void> {
    return audio.audioWorklet.addModule(processorUrl);
  }

  private __listeners: Set<() => void> = new Set();

  constructor(audio: AudioContext) {
    super(audio, 'tick-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    // the processor runs only while it is connected. it outputs silence
    this.connect(audio.destination);

    this.port.onmessage = () => {
      this.__listeners.forEach((listener) => listener());
    };
  }

  public onTick(listener: () => void): void {
    this.__listeners.add(listener);
  }
}
