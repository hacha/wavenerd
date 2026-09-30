import * as coreModule from '@strudel/core';
import * as webaudioModule from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';
import { type CodeDeck, type CodeDeckEvents, type CueStatus } from '../CodeDeck';
import { EventEmittable } from '../utils/EventEmittable';
import { createDeckOutputController } from './DeckOutputController';
import { StrudelScheduler } from './StrudelScheduler';
import { type StrudelEngine } from './StrudelEngine';

const { getTrigger, ref, silence } = coreModule;
const { setSuperdoughAudioController, webaudioOutput, webaudioRepl } = webaudioModule;

type Pattern = any;

/** Same as the knobs of GLSL decks. */
export const STRUDEL_KNOB_NAMES = [
  'knob0',
  'knob1',
  'knob2',
  'knob3',
  'knob4',
  'knob5',
  'knob6',
  'knob7',
] as const;

/**
 * A deck that plays Strudel code. Behaves like a `WavenerdDeck` from the deck UI.
 *
 * The clock (play, pause, rewind, BPM) follows the host deck of the engine.
 */
export class StrudelDeck extends EventEmittable<CodeDeckEvents> implements CodeDeck {
  public readonly engine: StrudelEngine;
  public readonly output: GainNode;

  private readonly __scheduler: StrudelScheduler;
  private readonly __repl: any;
  private __staged: Pattern | null = null;
  private __lastEvalError: unknown = null;
  private readonly __params = new Map<string, number>();

  /**
   * `knob0` .. `knob7` for Strudel code. Read at query time, so knob changes are heard after the lookahead.
   */
  private readonly __knobs: Record<string, Pattern>;

  private __cueStatus: CueStatus = 'none';
  public get cueStatus(): CueStatus {
    return this.__cueStatus;
  }

  /**
   * Whether the deck schedules its pattern. Stop it while the deck is not heard;
   * superdough creates audio nodes for every event even if the output is muted.
   */
  public get active(): boolean {
    return this.__scheduler.isRunning;
  }

  public set active(value: boolean) {
    if (value) {
      this.__scheduler.start();
    } else {
      this.__scheduler.stop();
    }
  }

  public constructor({ engine, id }: { engine: StrudelEngine; id: string }) {
    super();

    this.engine = engine;

    const { audio, clock } = engine;

    this.output = audio.createGain();

    this.__knobs = Object.fromEntries(STRUDEL_KNOB_NAMES.map((name) => (
      [name, ref(() => this.__params.get(name) ?? 0.0)]
    )));

    const controller = createDeckOutputController(audio, this.output);

    const defaultOutput = (hap: any, deadline: number, duration: number, cps: number, t: number) => {
      // superdough reads the controller synchronously, before its first await
      setSuperdoughAudioController(controller);
      return webaudioOutput(hap, deadline, duration, cps, t);
    };

    this.__scheduler = new StrudelScheduler({
      audio,
      clock,
      onTrigger: getTrigger({ defaultOutput, getTime: () => audio.currentTime }),
    });

    // used only to evaluate code. its own Cyclist never starts
    this.__repl = webaudioRepl({
      id,
      transpiler,
      onEvalError: (error: unknown) => {
        this.__lastEvalError = error;
      },
    });

    // same as WavenerdDeck
    clock.hostDeck.on('rewind', () => {
      this.applyCueImmediately();
    });
  }

  public async compile(code: string): Promise<void> {
    this.__setCueStatus('compiling');

    await this.engine.ready;

    let pattern: Pattern | null;
    let error: unknown = null;

    if (code.trim() === '') {
      // repl.evaluate throws on empty code
      pattern = silence;
    } else {
      pattern = await this.engine.enqueueEvaluation(async () => {
        // globals are shared by every deck. assign ours right before evaluating
        Object.assign(globalThis, this.__knobs);

        this.__lastEvalError = null;
        const result = await this.__repl.evaluate(code, false);
        error = this.__lastEvalError;
        return result ?? null;
      });
    }

    if (pattern == null) {
      this.__staged = null;
      this.__setCueStatus('none');
      this.__emit('error', { error: formatError(error) });
      return;
    }

    this.__staged = pattern;
    this.__setCueStatus('ready');
    this.__emit('error', { error: null });
  }

  public applyCue(): void {
    if (this.__cueStatus !== 'ready') { return; }

    this.__setCueStatus('applying');

    // same as WavenerdDeck: the swap takes the latest cue, even if it is recompiled while applying
    this.__scheduler.setPatternAtNextCycle(() => {
      const pattern = this.__staged;
      if (pattern == null) { return null; }

      this.__staged = null;
      this.__setCueStatus('none');
      return pattern;
    });
  }

  public applyCueImmediately(): void {
    const pattern = this.__staged;
    if (pattern == null) { return; }

    this.__scheduler.setPattern(pattern);
    this.__staged = null;
    this.__setCueStatus('none');
  }

  /**
   * Set the value of a knob (`knob0` .. `knob7`), usually from MIDI.
   */
  public setParam(name: string, value: number): void {
    this.__params.set(name, value);
  }

  private __setCueStatus(cueStatus: CueStatus): void {
    this.__cueStatus = cueStatus;
    this.__emit('changeCueStatus', { cueStatus });
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? 'Unknown error');
}
