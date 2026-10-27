import { type DeckSourceMode } from '../../audio/DeckSourceSwitch';
import { STRUDEL_KNOB_PARAMS, type StrudelKnobName } from '../../strudel/StrudelEngine';

/**
 * GLSL reads a knob as `param_knob0`, Strudel as `knob0` (or `tgl0` for knob4).
 */
const knobPatterns: Record<DeckSourceMode, RegExp> = {
  glsl: /\bparam_(knob[0-7])\b/g,
  strudel: /\b(knob[0-3]|tgl[0-3])\b/g,
};

/**
 * The name of a knob of the deck as the code refers to it.
 */
export function knobNameInCode(mode: DeckSourceMode, paramName: string): string {
  if (mode === 'glsl') { return `param_${paramName}`; }

  const entry = Object.entries(STRUDEL_KNOB_PARAMS).find(([, param]) => param === paramName);
  return entry?.[0] ?? paramName;
}

/**
 * Both GLSL and JavaScript use `// ...` and `/* ... *\/`.
 */
const commentPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * The knobs of the deck (`knob0` .. `knob7`) the code refers to, ignoring comments.
 */
export function referencedKnobs(mode: DeckSourceMode, code: string): Set<string> {
  const codeWithoutComments = code.replace(commentPattern, '');
  const matches = codeWithoutComments.matchAll(knobPatterns[mode]);
  return new Set(Array.from(matches, (match) => (
    mode === 'strudel' ? STRUDEL_KNOB_PARAMS[match[1] as StrudelKnobName] : match[1]
  )));
}
