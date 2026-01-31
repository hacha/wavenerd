import { EventEmittable } from '../utils/EventEmittable';
import { superdough, getAudioContext } from '@wavenerd/superdough';
import { webaudioRepl } from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';
import type { Repl, Hap } from '@strudel/core';

export type StrudelCueStatus = 'none' | 'compiling' | 'ready' | 'applying';

interface StrudelDeckEvents {
  changeCueStatus: { cueStatus: StrudelCueStatus };
  error: { error: string | null };
  play: void;
  pause: void;
}

// Convert hap to value object
const hap2value = (hap: Hap) => {
  hap.ensureObjectValue();
  return hap.value;
};

export class StrudelDeck extends EventEmittable<StrudelDeckEvents> {
  private repl: Repl | null = null;
  private pendingCode: string | null = null;
  private _cueStatus: StrudelCueStatus = 'none';
  private _isPlaying = false;
  private _bpm = 140;
  private _controllerId: string | null = null;

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

    // Create a new REPL with our custom output
    // Use webaudioRepl instead of basic repl to get mini notation parsing
    this.repl = webaudioRepl({
      getTime: () => getAudioContext().currentTime,
      defaultOutput: webaudioOutput,
    });

    console.log(`[StrudelDeck] Controller ID set to ${controllerId}, REPL created with custom output`);
  }

  public setRepl(repl: Repl): void {
    this.repl = repl;
  }

  public async compile(code: string): Promise<void> {
    if (!this.repl) {
      this.__emit('error', { error: 'Strudel REPL not initialized' });
      return;
    }

    this._cueStatus = 'compiling';
    this.__emit('changeCueStatus', { cueStatus: 'compiling' });

    try {
      // Replace bpm variable with actual value
      const codeWithBpm = code.replace(/\bbpm\b/g, this._bpm.toString());

      // Store the code for later playback
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

      // Transpile the code to convert mini notation strings to mini() calls
      // wrapAsync: true allows await in the code
      // addReturn: true returns the pattern from the async IIFE
      const { output: transpiledCode } = transpiler(this.pendingCode, {
        wrapAsync: true,
        addReturn: true
      });
      console.log('[StrudelDeck] Evaluating transpiled code:', transpiledCode);
      // Evaluate and start the pattern (autostart=true by default)
      await this.repl.evaluate(transpiledCode);
      console.log('[StrudelDeck] Evaluate completed successfully');
      this._isPlaying = true;
      this.__emit('play');
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
