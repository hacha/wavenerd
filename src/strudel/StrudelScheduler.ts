import { type DeckClock } from './DeckClock';
import { queryPattern } from './patternQuery';

type Pattern = any;
type Hap = any;

export type StrudelTrigger = (
  hap: Hap,
  deadline: number,
  duration: number,
  cps: number,
  targetTime: number,
) => void;

/**
 * Queries a Strudel pattern ahead of time and triggers haps at AudioContext times given by a {@link DeckClock}.
 * Replaces the Cyclist of Strudel.
 */
export class StrudelScheduler {
  public readonly audio: AudioContext;
  public readonly clock: DeckClock;

  private readonly __onTrigger: StrudelTrigger;
  private readonly __lookahead: number;
  private readonly __onError: ((error: unknown) => void) | null;
  private __lastErrorPattern: Pattern | null = null;
  private __pattern: Pattern | null = null;
  private __next: { cycle: number; takePattern: () => Pattern | null } | null = null;
  private __prevEnd: number | null = null;
  private __intervalId: ReturnType<typeof setInterval> | null = null;
  private __interval = 0.0;
  private __lastTickTime = 0.0;

  public get isRunning(): boolean {
    return this.__intervalId != null;
  }

  public constructor({
    audio,
    clock,
    onTrigger,
    lookahead = 0.2,
    onError,
  }: {
    audio: AudioContext;
    clock: DeckClock;
    onTrigger: StrudelTrigger;
    lookahead?: number;
    onError?: (error: unknown) => void;
  }) {
    this.audio = audio;
    this.clock = clock;
    this.__onTrigger = onTrigger;
    this.__lookahead = lookahead;
    this.__onError = onError ?? null;

    clock.onReset(() => {
      this.__prevEnd = null;
    });
  }

  public start(interval = 0.05): void {
    if (this.__intervalId != null) { return; }
    this.__interval = interval;
    this.__intervalId = setInterval(() => this.tick(), interval * 1000.0);
  }

  /**
   * Tick if the interval timer is late, e.g. throttled in a hidden tab.
   */
  public poke(): void {
    if (this.__intervalId == null) { return; }

    if (this.audio.currentTime - this.__lastTickTime > 1.5 * this.__interval) {
      this.tick();
    }
  }

  public stop(): void {
    if (this.__intervalId == null) { return; }
    clearInterval(this.__intervalId);
    this.__intervalId = null;
    this.__prevEnd = null;
  }

  /**
   * Replace the pattern from the next tick. Cancels a pending {@link setPatternAtNextCycle}.
   */
  public setPattern(pattern: Pattern | null): void {
    this.__pattern = pattern;
    this.__next = null;
  }

  /**
   * Replace the pattern at the next cycle boundary that has not been scheduled yet.
   * Replaces immediately when nothing is being scheduled (stopped or the clock is not running).
   *
   * @param takePattern Called at the swap to get the new pattern, so the latest cue is applied.
   *   Returning `null` keeps the current pattern.
   */
  public setPatternAtNextCycle(takePattern: () => Pattern | null): void {
    if (this.__prevEnd == null) {
      this.__swap(takePattern);
      return;
    }

    // haps until `prevEnd` are already dispatched
    this.__next = { cycle: Math.ceil(this.__prevEnd), takePattern };
  }

  public tick(): void {
    const { audio, clock } = this;

    this.__lastTickTime = audio.currentTime;

    if (!clock.isRunning) {
      this.__prevEnd = null;
      return;
    }

    const now = audio.currentTime;
    const begin = this.__prevEnd ?? clock.cycleAt(now);
    const end = clock.cycleAt(now + this.__lookahead);
    if (end <= begin) { return; }
    this.__prevEnd = end;

    const next = this.__next;
    if (next != null && next.cycle < end) {
      const swap = Math.max(begin, next.cycle);
      this.__query(this.__pattern, begin, swap, now);

      this.__swap(next.takePattern);

      this.__query(this.__pattern, swap, end, now);
    } else {
      this.__query(this.__pattern, begin, end, now);
    }
  }

  private __swap(takePattern: () => Pattern | null): void {
    this.__next = null;
    const pattern = takePattern();
    if (pattern != null) {
      this.__pattern = pattern;
    }
  }

  private __query(pattern: Pattern | null, begin: number, end: number, now: number): void {
    if (pattern == null || end <= begin) { return; }

    try {
      const { clock } = this;
      const cps = clock.cps;
      const haps: Hap[] = queryPattern(pattern, begin, end, { _cps: cps, cyclist: 'cyclist' });

      for (const hap of haps) {
        if (!hap.hasOnset()) { continue; }

        const targetTime = clock.timeAt(hap.whole.begin.valueOf());
        if (targetTime < now) { continue; }

        const duration = hap.duration.valueOf() / cps;
        this.__onTrigger(hap, targetTime - now, duration, cps, targetTime);
      }
    } catch (error) {
      // report once per pattern, not every tick
      if (this.__lastErrorPattern !== pattern) {
        this.__lastErrorPattern = pattern;
        this.__onError?.(error);
      }
    }
  }
}
