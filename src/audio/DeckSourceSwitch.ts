export type DeckSourceMode = 'glsl' | 'strudel';

/** Time constant of the crossfade. Settles in about 10ms. */
const FADE_TIME_CONSTANT = 0.002;

/**
 * Selects the source of a deck slot: the GLSL deck or the Strudel deck.
 */
export class DeckSourceSwitch {
  public readonly audio: AudioContext;
  public readonly inputGlsl: GainNode;
  public readonly inputStrudel: GainNode;
  public readonly output: GainNode;

  private __mode: DeckSourceMode = 'glsl';

  public get mode(): DeckSourceMode {
    return this.__mode;
  }

  public set mode(mode: DeckSourceMode) {
    this.setMode(mode);
  }

  /**
   * Switch the source at the given AudioContext time. Replaces a switch that is scheduled but not started yet.
   */
  public setMode(mode: DeckSourceMode, time?: number): void {
    this.__mode = mode;

    const now = this.audio.currentTime;
    const startTime = Math.max(now, time ?? now);

    this.inputGlsl.gain.cancelScheduledValues(now);
    this.inputStrudel.gain.cancelScheduledValues(now);
    this.inputGlsl.gain.setTargetAtTime(mode === 'glsl' ? 1.0 : 0.0, startTime, FADE_TIME_CONSTANT);
    this.inputStrudel.gain.setTargetAtTime(mode === 'strudel' ? 1.0 : 0.0, startTime, FADE_TIME_CONSTANT);
  }

  public constructor(audio: AudioContext) {
    this.audio = audio;

    this.inputGlsl = audio.createGain();
    this.inputStrudel = audio.createGain();
    this.inputStrudel.gain.value = 0.0;

    this.output = audio.createGain();
    this.inputGlsl.connect(this.output);
    this.inputStrudel.connect(this.output);
  }
}
