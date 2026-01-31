export type DeckMode = 'glsl' | 'strudel';

/**
 * DeckSwitch handles routing between GLSL and Strudel audio sources.
 *
 * Both GLSL and Strudel audio are routed through the mixer chain,
 * allowing EQ, filter, crossfader, reverb, and recording to work with Strudel.
 */
export class DeckSwitch {
  private _mode: DeckMode = 'glsl';
  private glslGain: GainNode;
  private strudelGain: GainNode;
  public readonly output: GainNode;

  constructor(private audio: AudioContext) {
    // Create gain nodes for routing
    this.glslGain = audio.createGain();
    this.strudelGain = audio.createGain();
    this.output = audio.createGain();

    // Connect both paths to output
    this.glslGain.connect(this.output);
    this.strudelGain.connect(this.output);

    // Default: GLSL mode
    this.setMode('glsl');
  }

  public get mode(): DeckMode {
    return this._mode;
  }

  public get glslInput(): GainNode {
    return this.glslGain;
  }

  public get strudelInput(): GainNode {
    return this.strudelGain;
  }

  public setMode(mode: DeckMode): void {
    this._mode = mode;

    if (mode === 'glsl') {
      // Enable GLSL audio, mute Strudel
      this.glslGain.gain.setTargetAtTime(1, this.audio.currentTime, 0.01);
      this.strudelGain.gain.setTargetAtTime(0, this.audio.currentTime, 0.01);
    } else {
      // Mute GLSL audio, enable Strudel
      this.glslGain.gain.setTargetAtTime(0, this.audio.currentTime, 0.01);
      this.strudelGain.gain.setTargetAtTime(1, this.audio.currentTime, 0.01);
    }
  }
}
