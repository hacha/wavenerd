import { type DeckSourceMode } from '../../audio/DeckSourceSwitch';

/**
 * Line numbers (1-based) that a compile error points to.
 *
 * - GLSL: `ERROR: 0:12: ...` for each error
 * - Strudel: `... (12:4)` at the end of a syntax error, or `... at line 12: ...` for a mini-notation error
 */
export function parseErrorLines(mode: DeckSourceMode, error: string | null): number[] {
  if (error == null) {
    return [];
  }

  if (mode === 'strudel') {
    const firstLine = error.split('\n')[0];
    const match = firstLine.match(/\((\d+):\d+\)$/) ?? firstLine.match(/^\[mini\] parse error at line (\d+):/);
    return match != null ? [parseInt(match[1], 10)] : [];
  }

  return [...error.matchAll(/ERROR: (\d+):(\d+)/g)].map((match) => parseInt(match[2], 10));
}
