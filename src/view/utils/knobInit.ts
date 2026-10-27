import { STRUDEL_KNOB_PARAMS, type StrudelKnobName } from '../../strudel/StrudelEngine';

const initLinePattern = /^[ \t]*\/\/[ \t]*@init\b([^\n]*)/m;
const assignmentPattern = /([A-Za-z_]\w*)[ \t]*=[ \t]*([-+]?(?:\d+\.?\d*|\.\d+))/g;

/**
 * The initial values of the knobs of the deck written in the code as `// @init knob0=0.3 tgl1=1`.
 * Takes `knob0` .. `knob7` and `tgl0` .. `tgl3` (= `knob4` .. `knob7`), clamped to 0..1.
 * Returns `null` if the code has no `@init` line.
 */
export function knobInit(code: string): Map<string, number> | null {
  const line = initLinePattern.exec(code);
  if (line == null) { return null; }

  const values = new Map<string, number>();
  for (const [, name, valueString] of line[1].matchAll(assignmentPattern)) {
    const isStrudelName = Object.hasOwn(STRUDEL_KNOB_PARAMS, name);
    if (!isStrudelName && !/^knob[0-7]$/.test(name)) { continue; }

    const paramName = isStrudelName ? STRUDEL_KNOB_PARAMS[name as StrudelKnobName] : name;

    values.set(paramName, Math.min(Math.max(parseFloat(valueString), 0.0), 1.0));
  }
  return values;
}
