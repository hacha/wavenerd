import { EventEmittable } from '../utils/EventEmittable';
import type { IDeck } from '../IDeck';
import { superdough, getAudioContext } from '@wavenerd/superdough';
import { webaudioRepl } from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';
import type { Repl, Hap } from '@strudel/core';

export type StrudelCueStatus = 'none' | 'compiling' | 'ready' | 'applying';

export interface StrudelMiniLocation {
  0: number; // fromOffset
  1: number; // toOffset
}

export interface StrudelWidgetConfig {
  to: number;
  index: number;
  type: string;
  id: string;
  from?: number;
  value?: string;
  min?: number;
  max?: number;
  step?: number;
  [key: string]: unknown;
}

interface StrudelDeckEvents {
  changeCueStatus: { cueStatus: StrudelCueStatus };
  error: { error: string | null };
  play: void;
  pause: void;
  afterEval: { miniLocations: StrudelMiniLocation[]; widgets: StrudelWidgetConfig[]; pattern: unknown };
  schedulerStart: { scheduler: unknown };
  schedulerStop: void;
}

// Convert hap to value object
const hap2value = (hap: Hap) => {
  hap.ensureObjectValue();
  return hap.value;
};

export class StrudelDeck extends EventEmittable<StrudelDeckEvents> implements IDeck {
  public repl: Repl | null = null;
  private pendingCode: string | null = null;
  private _cueStatus: StrudelCueStatus = 'none';
  private _isPlaying = false;
  private _bpm = 140;
  private _controllerId: string | null = null;
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;

  constructor() {
    super();
    this._readyPromise = new Promise<void>((resolve) => {
      this._resolveReady = resolve;
    });
  }

  public get cueStatus(): StrudelCueStatus {
    return this._cueStatus;
  }

  public get isPlaying(): boolean {
    return this._isPlaying;
  }

  public get controllerId(): string | null {
    return this._controllerId;
  }

  public setControllerId(controllerId: string): void {
    this._controllerId = controllerId;

    // Create custom output function that routes to the correct controller
    const webaudioOutput = (hap: Hap, _deadline: number, hapDuration: number, cps: number, t: number) => {
      return superdough(hap2value(hap), t, hapDuration, cps, hap.whole?.begin.valueOf(), this._controllerId);
    };

    // Create a new REPL with our custom output and transpiler
    // Passing transpiler to repl enables miniLocations/widgets collection in afterEval
    this.repl = webaudioRepl({
      getTime: () => getAudioContext().currentTime,
      defaultOutput: webaudioOutput,
      transpiler,
      afterEval: ({ pattern, meta }: { code: string; pattern: unknown; meta?: { miniLocations?: StrudelMiniLocation[]; widgets?: StrudelWidgetConfig[] } }) => {
        const miniLocations = meta?.miniLocations || [];
        const widgets = meta?.widgets || [];
        console.log('[StrudelDeck] afterEval fired, miniLocations:', miniLocations.length, 'widgets:', widgets.length, 'meta keys:', meta ? Object.keys(meta) : 'none');
        this.__emit('afterEval', { miniLocations, widgets, pattern });
      },
      onToggle: (started: boolean) => {
        if (started) {
          this._isPlaying = true;
          this.__emit('play');
          this.__emit('schedulerStart', { scheduler: this.repl!.scheduler });
        } else {
          this._isPlaying = false;
          this.__emit('pause');
          this.__emit('schedulerStop');
        }
      },
    });

    console.log(`[StrudelDeck] Controller ID set to ${controllerId}, REPL created with transpiler`);
    this._resolveReady();
  }

  public setRepl(repl: Repl): void {
    this.repl = repl;
  }

  public async compile(code: string): Promise<void> {
    await this._readyPromise;

    if (!this.repl) {
      this.__emit('error', { error: 'Strudel REPL not initialized' });
      return;
    }

    this._cueStatus = 'compiling';
    this.__emit('changeCueStatus', { cueStatus: 'compiling' });

    try {
      // Replace bpm variable with actual value
      const codeWithBpm = code.replace(/\bbpm\b/g, this._bpm.toString());

      // Store the raw code for later playback
      // The repl will handle transpilation internally (since we passed transpiler to it)
      this.pendingCode = codeWithBpm;
      this._cueStatus = 'ready';
      this.__emit('changeCueStatus', { cueStatus: 'ready' });
      this.__emit('error', { error: null });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.__emit('error', { error: errorMessage });
      this._cueStatus = 'none';
      this.__emit('changeCueStatus', { cueStatus: 'none' });
    }
  }

  public async applyCue(): Promise<void> {
    console.log('[StrudelDeck] applyCue called, status:', this._cueStatus, 'hasCode:', !!this.pendingCode);
    if (!this.repl || this._cueStatus !== 'ready' || !this.pendingCode) {
      console.log('[StrudelDeck] applyCue early return - repl:', !!this.repl, 'status:', this._cueStatus);
      return;
    }

    this._cueStatus = 'applying';
    this.__emit('changeCueStatus', { cueStatus: 'applying' });

    try {
      // Stop any currently playing pattern first
      if (this._isPlaying) {
        console.log('[StrudelDeck] Stopping current pattern');
        this.repl.stop();
      }

      // Pass raw code to repl.evaluate — repl will internally call transpiler
      // which collects miniLocations/widgets and passes them to afterEval callback
      console.log('[StrudelDeck] Evaluating raw code (transpiler integrated in repl)');
      await this.repl.evaluate(this.pendingCode);
      console.log('[StrudelDeck] Evaluate completed successfully');
      this.__emit('error', { error: null });
    } catch (e) {
      console.error('[StrudelDeck] Evaluate error:', e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.__emit('error', { error: errorMessage });
    }

    this._cueStatus = 'none';
    this.__emit('changeCueStatus', { cueStatus: 'none' });
  }

  public async applyCueImmediately(): Promise<void> {
    await this.applyCue();
  }

  public play(): void {
    if (!this.repl) return;
    this.repl.start();
    this._isPlaying = true;
    this.__emit('play');
  }

  public pause(): void {
    if (!this.repl) return;
    this.repl.stop();
    this._isPlaying = false;
    this.__emit('pause');
  }

  public stop(): void {
    this.pause();
  }

  public setBPM(bpm: number): void {
    this._bpm = bpm;
    // Update CPS (cycles per second) - assuming 4 beats per cycle (4/4 time)
    if (this.repl && this._isPlaying) {
      const cps = bpm / 60 / 4;
      this.repl.setCps(cps);
    }
  }

  public setParam(name: string, value: number): void {
    // Strudel doesn't have the same param system as GLSL
    // This could be implemented using Strudel's control patterns in the future
    console.log(`StrudelDeck.setParam: ${name} = ${value}`);
  }

  public dispose(): void {
    if (this.repl) {
      this.repl.stop();
    }
  }
}
