import * as coreModule from '@strudel/core';
import { type DeckClock } from './DeckClock';
import { queryPattern } from './patternQuery';

const { noteToMidi } = coreModule;

type Pattern = any;
type Hap = any;

// == Live FX ======================================================================================
// Held effects that change what the pattern plays, without touching the code. Inspired by the Live FX of Jacquard.
// See: https://github.com/keijiro/Jacquard
//
// They count in sixteenths of a cycle (1 cycle = 1 bar). A press is snapped to the sixteenth at or before it.
// Haps already sent to superdough (the lookahead of the scheduler) are not changed.

export const STRUDEL_LIVE_FX_NAMES = [
  'roll16',
  'roll8',
  'roll4',
  'roll2',
  'octDown',
  'octUp',
  'rise',
  'stab',
] as const;

export type StrudelLiveFxName = typeof STRUDEL_LIVE_FX_NAMES[number];

/** Length of the window each roll repeats, in sixteenths. */
const ROLL_STEPS: { [ name in StrudelLiveFxName ]?: number } = {
  roll16: 1,
  roll8: 2,
  roll4: 4,
  roll2: 8,
};

/** Rise goes up a semitone per sixteenth, and back to 0 after this many. */
const RISE_WRAP_STEPS = 32;

/** Stab gate, in sixteenths. */
const STAB_GATE = 0.1;
const STAB_MIN_GATE = 0.005;
const STAB_RELEASE = 0.01;

/** The sound plays at `note` 36 when neither `note` nor `freq` is given. */
const DEFAULT_NOTE = 36;

function gridOf(cycle: number): number {
  return Math.floor(cycle * 16.0) / 16.0;
}

function hasOnset(pattern: Pattern, begin: number, end: number, controls: Record<string, any>): boolean {
  return queryPattern(pattern, begin, end, controls).some((hap: Hap) => hap.hasOnset());
}

export class StrudelLiveFx {
  private readonly __audio: AudioContext;
  private readonly __clock: DeckClock;

  /**
   * Held effects, in the order they were pressed, to the sixteenth they were pressed at.
   * `null` until the clock runs: the first query after it decides.
   */
  private readonly __held = new Map<StrudelLiveFxName, number | null>();

  public constructor({ audio, clock }: { audio: AudioContext; clock: DeckClock }) {
    this.__audio = audio;
    this.__clock = clock;

    // the cycle goes back to 0. held effects start again from there
    clock.onReset(() => {
      for (const name of this.__held.keys()) {
        this.__held.set(name, null);
      }
    });
  }

  /**
   * Set the effects that are held. Effects already held keep where they were pressed.
   */
  public setHeld(names: Iterable<StrudelLiveFxName>): void {
    const next = new Set(names);

    for (const name of this.__held.keys()) {
      if (!next.has(name)) {
        this.__held.delete(name);
      }
    }

    const clock = this.__clock;
    for (const name of next) {
      if (this.__held.has(name)) { continue; }
      this.__held.set(name, clock.isRunning ? gridOf(clock.cycleAt(this.__audio.currentTime)) : null);
    }
  }

  /**
   * Query the pattern with the rolls applied.
   */
  public query(pattern: Pattern, begin: number, end: number, controls: Record<string, any>): Hap[] {
    for (const [name, anchor] of this.__held) {
      if (anchor == null) {
        this.__held.set(name, gridOf(begin));
      }
    }

    const roll = this.__currentRoll();
    if (roll == null) {
      return queryPattern(pattern, begin, end, controls);
    }

    // play the window from the anchor again and again, each repeat shifted by a whole window
    const { name, length } = roll;
    let { anchor } = roll;
    const haps: Hap[] = [];
    let repeat = Math.max(0, Math.floor((begin - anchor) / length));
    let segmentBegin = begin;

    while (segmentBegin < end) {
      // a window without sounds would roll silence. wait for the next window that has some
      if (repeat >= 1 && !hasOnset(pattern, anchor, anchor + length, controls)) {
        anchor += repeat * length;
        repeat = 0;
        this.__held.set(name, anchor);
      }

      const windowEnd = anchor + (repeat + 1) * length;
      const segmentEnd = Math.min(end, windowEnd);
      if (repeat === 0) {
        haps.push(...queryPattern(pattern, segmentBegin, segmentEnd, controls));
      } else {
        // cut long sounds at the end of each repeat, or they pile up
        const repeated: Hap[] = queryPattern(pattern.late(repeat * length), segmentBegin, segmentEnd, controls);
        haps.push(...repeated.map((hap) => hap.withSpan((span: any) => span.withEnd((e: any) => e.min(windowEnd)))));
      }
      segmentBegin = segmentEnd;
      repeat++;
    }

    return haps;
  }

  /**
   * Apply the effects that change each sound. Returns the hap as is when none of them is held.
   */
  public apply(hap: Hap, duration: number, cps: number): { hap: Hap; duration: number } {
    const held = this.__held;
    const isStab = held.has('stab');
    const hasPitch = held.has('octDown') || held.has('octUp') || held.has('rise');

    if ((!isStab && !hasPitch) || hap.value == null || typeof hap.value !== 'object') {
      return { hap, duration };
    }

    let semitones = 0;
    if (held.has('octDown')) { semitones -= 12; }
    if (held.has('octUp')) { semitones += 12; }

    const riseAnchor = held.get('rise');
    if (riseAnchor != null) {
      const steps = Math.floor((hap.whole.begin.valueOf() - riseAnchor) * 16.0 + 1e-6);
      semitones += Math.max(0, steps) % RISE_WRAP_STEPS;
    }

    const value = { ...hap.value };

    if (semitones !== 0) {
      if (typeof value.freq === 'number') {
        value.freq *= Math.pow(2.0, semitones / 12.0);
      } else {
        const note = value.note ?? DEFAULT_NOTE;
        value.note = (typeof note === 'string' ? noteToMidi(note) : note) + semitones;
      }
    }

    if (isStab) {
      duration = Math.max(STAB_GATE / 16.0 / cps, STAB_MIN_GATE);
      // samples play the whole slice unless the release is set
      value.release = Math.min(value.release ?? STAB_RELEASE, STAB_RELEASE);
    }

    return { hap: hap.withValue(() => value), duration };
  }

  /**
   * The roll that plays: the latest pressed one. Other held rolls take over when it is released.
   */
  private __currentRoll(): { name: StrudelLiveFxName; anchor: number; length: number } | null {
    let roll: { name: StrudelLiveFxName; anchor: number; length: number } | null = null;

    for (const [name, anchor] of this.__held) {
      const steps = ROLL_STEPS[name];
      if (steps != null && anchor != null) {
        roll = { name, anchor, length: steps / 16.0 };
      }
    }

    return roll;
  }
}
