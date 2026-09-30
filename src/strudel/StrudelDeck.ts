import * as coreModule from '@strudel/core';
import * as webaudioModule from '@strudel/webaudio';
import { mini2ast } from '@strudel/mini';
import { transpiler } from '@strudel/transpiler';
import { type CodeDeck, type CodeDeckEvents, type CueStatus } from '../CodeDeck';
import { EventEmittable } from '../utils/EventEmittable';
import { createDeckOutputController } from './DeckOutputController';
import { StrudelScheduler } from './StrudelScheduler';
import { STRUDEL_KNOB_NAMES, type StrudelEngine } from './StrudelEngine';

const { getTrigger, ref, silence } = coreModule;
const { setSuperdoughAudioController, webaudioOutput, webaudioRepl } = webaudioModule;

type Pattern = any;

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

  /**
   * Schedule now if the timer of the scheduler is late. Call it from a clock that is not throttled.
   */
  public poke(): void {
    this.__scheduler.poke();
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
      // superdough takes the controller synchronously, before its first await.
      // `patches/superdough@1.3.0.patch` makes bus modulation (`bmod`) use it too
      setSuperdoughAudioController(controller);
      return webaudioOutput(hap, deadline, duration, cps, t);
    };

    this.__scheduler = new StrudelScheduler({
      audio,
      clock,
      onTrigger: getTrigger({ defaultOutput, getTime: () => audio.currentTime }),
      onError: (error) => {
        this.__emit('error', { error: error instanceof Error ? error.message : String(error) });
      },
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
      controller.reset();
    });

    // Haps within the lookahead are already sent to superdough and cannot be cancelled.
    // Disconnect the orbits they are wired to, so the deck stops at once like a GLSL deck.
    // The scheduler queries the same range again on resume, into new orbits.
    clock.hostDeck.on('pause', () => {
      controller.reset();
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
      this.__emit('error', { error: formatError(error, code) });
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

/**
 * Syntax errors end with `(line:column)` (acorn). Mini-notation errors say `at line N`, where N is a line of the code.
 */
function formatError(error: unknown, code: string): string {
  if (!(error instanceof Error)) {
    return String(error ?? 'Unknown error');
  }

  if (error.message.startsWith('[mini]')) {
    return findMiniError(code, error.message) ?? error.message;
  }

  return error.message;
}

/**
 * The mini-notation error from Strudel counts lines inside the string. Parse each mini string again to find it in the code.
 * Only accepts the same error, so broken strings in comments are skipped.
 */
function findMiniError(code: string, message: string): string | null {
  const detail = miniErrorDetail(message);

  // double quotes and backticks are mini-notation. backticks with `${}` are skipped
  for (const match of code.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.)*`/g)) {
    const content = match[0].slice(1, -1);
    try {
      mini2ast(`"${content}"`, match.index, code);
    } catch (e) {
      if (e instanceof Error && miniErrorDetail(e.message) === detail) { return e.message; }
    }
  }

  return null;
}

/** The message of a mini-notation error without `[mini] parse error at line N: `. */
function miniErrorDetail(message: string): string {
  return message.replace(/^\[mini\] parse error at line \d+: /, '');
}
