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
type Hap = any;

/**
 * Code that compiled successfully, with the places of its mini-notation atoms.
 */
export interface StrudelCompiledCode {
  /** Grows with each compile. */
  id: number;
  code: string;

  /** `[from, to]` offsets in {@link code}. */
  miniLocations: [number, number][];
}

/**
 * Identifies a mini-notation atom of a compiled code, as listed by {@link StrudelDeck.collectSoundingLocations}.
 */
export function strudelLocationKey(codeId: number, from: number, to: number): string {
  return `${codeId}:${from}:${to}`;
}

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
  private __staged: { pattern: Pattern; codeId: number } | null = null;
  private __lastEvalError: unknown = null;
  private __lastEvalMiniLocations: [number, number][] = [];
  private __compiledCode: StrudelCompiledCode | null = null;
  private __lastCodeId = 0;
  private __activeCodeId = 0;
  private __sounding: { begin: number; end: number; keys: string[] }[] = [];
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
      this.__sounding = [];
    }
  }

  /**
   * The latest code that compiled successfully. It might not be applied yet.
   */
  public get compiledCode(): StrudelCompiledCode | null {
    return this.__compiledCode;
  }

  /**
   * The {@link StrudelCompiledCode.id} of the code that is playing.
   */
  public get activeCodeId(): number {
    return this.__activeCodeId;
  }

  /**
   * Add the {@link strudelLocationKey} of the mini-notation atoms that are heard now to `keys`.
   */
  public collectSoundingLocations(keys: Set<string>): void {
    if (this.__sounding.length === 0) { return; }

    const { audio } = this.engine;
    const time = audio.currentTime - (audio.outputLatency || 0.0);

    this.__sounding = this.__sounding.filter((sounding) => time < sounding.end);

    for (const sounding of this.__sounding) {
      if (sounding.begin <= time) {
        for (const key of sounding.keys) { keys.add(key); }
      }
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

    const trigger = getTrigger({ defaultOutput, getTime: () => audio.currentTime });

    this.__scheduler = new StrudelScheduler({
      audio,
      clock,
      onTrigger: (hap, deadline, duration, cps, targetTime) => {
        this.__addSounding(hap, targetTime, duration);
        return trigger(hap, deadline, duration, cps, targetTime);
      },
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
      afterEval: ({ meta }: { meta?: { miniLocations?: [number, number][] } }) => {
        this.__lastEvalMiniLocations = meta?.miniLocations ?? [];
      },
    });

    // same as WavenerdDeck
    clock.hostDeck.on('rewind', () => {
      this.applyCueImmediately();
      controller.reset();
      this.__sounding = [];
    });

    // Haps within the lookahead are already sent to superdough and cannot be cancelled.
    // Disconnect the orbits they are wired to, so the deck stops at once like a GLSL deck.
    // The scheduler queries the same range again on resume, into new orbits.
    clock.hostDeck.on('pause', () => {
      controller.reset();
      this.__sounding = [];
    });
  }

  public async compile(code: string): Promise<void> {
    this.__setCueStatus('compiling');

    await this.engine.ready;

    let pattern: Pattern | null;
    let error: unknown = null;
    let miniLocations: [number, number][] = [];

    if (code.trim() === '') {
      // repl.evaluate throws on empty code
      pattern = silence;
    } else {
      pattern = await this.engine.enqueueEvaluation(async () => {
        // globals are shared by every deck. assign ours right before evaluating
        Object.assign(globalThis, this.__knobs);

        this.__lastEvalError = null;
        this.__lastEvalMiniLocations = [];
        const result = await this.__repl.evaluate(code, false);
        error = this.__lastEvalError;
        miniLocations = this.__lastEvalMiniLocations;
        return result ?? null;
      });
    }

    if (pattern == null) {
      this.__staged = null;
      this.__setCueStatus('none');
      this.__emit('error', { error: formatError(error, code) });
      return;
    }

    const codeId = ++this.__lastCodeId;
    this.__compiledCode = { id: codeId, code, miniLocations };
    this.__staged = { pattern, codeId };
    this.__setCueStatus('ready');
    this.__emit('error', { error: null });
  }

  public applyCue(): void {
    if (this.__cueStatus !== 'ready') { return; }

    this.__setCueStatus('applying');

    // same as WavenerdDeck: the swap takes the latest cue, even if it is recompiled while applying
    this.__scheduler.setPatternAtNextCycle(() => {
      const staged = this.__staged;
      if (staged == null) { return null; }

      this.__staged = null;
      this.__activeCodeId = staged.codeId;
      this.__setCueStatus('none');
      return staged.pattern;
    });
  }

  public applyCueImmediately(): void {
    const staged = this.__staged;
    if (staged == null) { return; }

    this.__scheduler.setPattern(staged.pattern);
    this.__staged = null;
    this.__activeCodeId = staged.codeId;
    this.__setCueStatus('none');
  }

  /**
   * Set the value of a knob (`knob0` .. `knob7`), usually from MIDI.
   */
  public setParam(name: string, value: number): void {
    this.__params.set(name, value);
  }

  /**
   * Remember when the hap is heard, for {@link collectSoundingLocations}.
   * Called for the haps of the active code only, since the scheduler swaps the pattern between its queries.
   */
  private __addSounding(hap: Hap, begin: number, duration: number): void {
    const locations: { start: number; end: number }[] | undefined = hap.context?.locations;
    if (locations == null || locations.length === 0) { return; }

    // nobody collects them, e.g. the editor is not mounted
    if (this.__sounding.length >= 1024) {
      this.__sounding = this.__sounding.slice(512);
    }

    const codeId = this.__activeCodeId;
    this.__sounding.push({
      begin,
      end: begin + duration,
      keys: locations.map(({ start, end }) => strudelLocationKey(codeId, start, end)),
    });
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
