import { type DeckClock } from './DeckClock';

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
  public pattern: Pattern | null = null;

  private readonly __onTrigger: StrudelTrigger;
  private readonly __lookahead: number;
  private __prevEnd: number | null = null;
  private __intervalId: ReturnType<typeof setInterval> | null = null;

  public constructor({
    audio,
    clock,
    onTrigger,
    lookahead = 0.2,
  }: {
    audio: AudioContext;
    clock: DeckClock;
    onTrigger: StrudelTrigger;
    lookahead?: number;
  }) {
    this.audio = audio;
    this.clock = clock;
    this.__onTrigger = onTrigger;
    this.__lookahead = lookahead;

    clock.onReset(() => {
      this.__prevEnd = null;
    });
  }

  public start(interval = 0.05): void {
    if (this.__intervalId != null) { return; }
    this.__intervalId = setInterval(() => this.tick(), interval * 1000.0);
  }

  public stop(): void {
    if (this.__intervalId == null) { return; }
    clearInterval(this.__intervalId);
    this.__intervalId = null;
  }

  public tick(): void {
    const { audio, clock, pattern } = this;

    if (!clock.isRunning || pattern == null) {
      this.__prevEnd = null;
      return;
    }

    const now = audio.currentTime;
    const begin = this.__prevEnd ?? clock.cycleAt(now);
    const end = clock.cycleAt(now + this.__lookahead);
    if (end <= begin) { return; }
    this.__prevEnd = end;

    const cps = clock.cps;
    const haps: Hap[] = pattern.queryArc(begin, end, { _cps: cps, cyclist: 'cyclist' });

    for (const hap of haps) {
      if (!hap.hasOnset()) { continue; }

      const targetTime = clock.timeAt(hap.whole.begin.valueOf());
      if (targetTime < now) { continue; }

      const duration = hap.duration.valueOf() / cps;
      this.__onTrigger(hap, targetTime - now, duration, cps, targetTime);
    }
  }
}
