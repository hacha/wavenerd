import { type BeatManager, type WavenerdDeck } from '@0b5vr/wavenerd-deck';

type BeatManagerUpdateEvent = ReturnType<BeatManager['update']>;

const BLOCK_SIZE = 128;

interface DeckClockAnchor {
  ctxTime: number;
  cycle: number;
  bpm: number;
}

/**
 * Maps AudioContext time to Strudel cycles, following the BeatManager of the host deck.
 * 1 cycle = 1 bar.
 *
 * Deck time `T` is played at AudioContext time `T + blockOffset * BLOCK_SIZE / sampleRate`.
 */
export class DeckClock {
  public readonly hostDeck: WavenerdDeck;

  private __anchor: DeckClockAnchor | null = null;
  private __lastCycle = 0;
  private __lastPhase = 0;
  private __onReset: Set<() => void> = new Set();

  public get isRunning(): boolean {
    return this.__anchor != null;
  }

  public get bpm(): number {
    return this.__anchor?.bpm ?? this.hostDeck.beatManager.bpm;
  }

  public get cps(): number {
    return this.bpm / 240.0;
  }

  public constructor(hostDeck: WavenerdDeck) {
    this.hostDeck = hostDeck;

    hostDeck.beatManager.on('update', (event) => this.__handleUpdate(event));
    hostDeck.on('pause', () => {
      this.__anchor = null;
    });
    hostDeck.on('rewind', () => {
      this.__anchor = null;
      this.__lastCycle = 0;
      this.__lastPhase = 0;
      this.__onReset.forEach((listener) => listener());
    });
  }

  public onReset(listener: () => void): void {
    this.__onReset.add(listener);
  }

  /**
   * Cycle position at the given AudioContext time. Extrapolated from the latest deck update.
   */
  public cycleAt(ctxTime: number): number {
    const anchor = this.__anchor;
    if (anchor == null) {
      throw new Error('DeckClock: the host deck is not running');
    }
    return anchor.cycle + (ctxTime - anchor.ctxTime) * anchor.bpm / 240.0;
  }

  /**
   * Cycle position for drawing: {@link cycleAt} while running, the last known position while paused.
   */
  public displayCycleAt(ctxTime: number): number {
    return this.__anchor != null ? this.cycleAt(ctxTime) : this.__lastCycle;
  }

  /**
   * AudioContext time of the given cycle position.
   */
  public timeAt(cycle: number): number {
    const anchor = this.__anchor;
    if (anchor == null) {
      throw new Error('DeckClock: the host deck is not running');
    }
    return anchor.ctxTime + (cycle - anchor.cycle) * 240.0 / anchor.bpm;
  }

  private __handleUpdate({ time, bpm, sixteenBar }: BeatManagerUpdateEvent): void {
    if (!this.hostDeck.isPlaying) { return; }

    const barSeconds = 240.0 / bpm;

    // phase within 16 bars, in cycles
    const phase = sixteenBar / barSeconds;

    // Unwrap to a monotonic counter. Take the nearest representation, since every deck
    // updates the host BeatManager with its own write position, so events can step back a bit.
    const delta = ((phase - this.__lastPhase) % 16 + 24) % 16 - 8;
    const cycle = this.__lastCycle + delta;
    this.__lastCycle = cycle;
    this.__lastPhase = phase;

    const ctxTime = time + this.hostDeck.blockOffset * BLOCK_SIZE / this.hostDeck.sampleRate;

    this.__anchor = { ctxTime, cycle, bpm };
  }
}
