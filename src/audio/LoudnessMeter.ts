import { LoudnessMeterNode, type LoudnessMeterStep } from './LoudnessMeterNode';

/** 10 minutes of 100 ms steps. */
const MAX_STEPS = 6000;

export interface LoudnessReading {
  /** Seconds measured since the last reset. */
  seconds: number;

  /** Gated loudness since the last reset, LUFS. `null` while it is silent. */
  integrated: number | null;

  /** Loudness of the last 3 seconds, LUFS. */
  shortTerm: number | null;

  /** Highest sample peak since the last reset, dBFS. */
  peak: number | null;
}

function lufs(energy: number): number | null {
  return energy > 0.0 ? -0.691 + 10.0 * Math.log10(energy) : null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0.0) / values.length;
}

/**
 * The loudness of an input as in ITU-R BS.1770 / EBU R 128: integrated (gated) and short-term loudness, sample peak.
 * Runs in an AudioWorklet, so it keeps measuring while the tab is hidden.
 */
export class LoudnessMeter {
  public readonly input: AudioNode;

  private __steps: LoudnessMeterStep[] = [];

  public constructor(audio: AudioContext) {
    const node = new LoudnessMeterNode(audio);
    node.onstep = (step) => {
      this.__steps.push(step);
      if (this.__steps.length > MAX_STEPS) {
        this.__steps.shift();
      }
    };

    this.input = node;
  }

  public reset(): void {
    this.__steps = [];
  }

  public read(): LoudnessReading {
    const steps = this.__steps;
    const energies = steps.map((step) => step.energy);

    // gating blocks of 400 ms, overlapping by 75 %
    const blocks: number[] = [];
    for (let i = 4; i <= energies.length; i++) {
      blocks.push(mean(energies.slice(i - 4, i)));
    }

    // absolute gate at -70 LUFS, then the relative gate 10 LU below the loudness of what is left
    const absoluteGated = blocks.filter((energy) => (lufs(energy) ?? -Infinity) > -70.0);
    let integrated: number | null = null;
    if (absoluteGated.length > 0) {
      const threshold = (lufs(mean(absoluteGated)) ?? -Infinity) - 10.0;
      const relativeGated = absoluteGated.filter((energy) => (lufs(energy) ?? -Infinity) > threshold);
      integrated = relativeGated.length > 0 ? lufs(mean(relativeGated)) : null;
    }

    const shortTermSteps = energies.slice(-30);
    const peak = Math.max(0.0, ...steps.map((step) => step.peak));

    return {
      seconds: steps.length * 0.1,
      integrated,
      shortTerm: shortTermSteps.length > 0 ? lufs(mean(shortTermSteps)) : null,
      peak: peak > 0.0 ? 20.0 * Math.log10(peak) : null,
    };
  }
}
