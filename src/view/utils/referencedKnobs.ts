import { type DeckSourceMode } from '../../audio/DeckSourceSwitch';

/**
 * GLSL reads a knob as `param_knob0`, Strudel as `knob0`.
 */
const knobPatterns: Record<DeckSourceMode, RegExp> = {
  glsl: /\bparam_(knob[0-7])\b/g,
  strudel: /\b(knob[0-7])\b/g,
};

/**
 * Both GLSL and JavaScript use `// ...` and `/* ... *\/`.
 */
const commentPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * The names of the knobs (`knob0` .. `knob7`) the code refers to, ignoring comments.
 */
export function referencedKnobs(mode: DeckSourceMode, code: string): Set<string> {
  const codeWithoutComments = code.replace(commentPattern, '');
  const matches = codeWithoutComments.matchAll(knobPatterns[mode]);
  return new Set(Array.from(matches, (match) => match[1]));
}
