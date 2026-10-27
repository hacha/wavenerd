import clsx from 'clsx';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { DeckKnob } from './DeckKnob';
import { DeckShiftPads } from './DeckShiftPads';
import { DeckToggle } from './DeckToggle';
import { DDJ_FLX2_JOG_PAD_COUNT } from '../../midiDDJFLX2PadJog';
import { deckAGlslAtoms, deckAStrudelAtoms, deckBGlslAtoms, deckBStrudelAtoms } from '../stores/atoms/deck';
import { useSettings } from '../stores/hooks/useSettings';
import { knobNameInCode, referencedKnobs } from '../utils/referencedKnobs';

const paramNames = [
  'knob0',
  'knob1',
  'knob2',
  'knob3',
  'knob4',
  'knob5',
  'knob6',
  'knob7',
];

// the toggles (knob4-7) are numbered from 0 on their own
const labels = [
  '0',
  '1',
  '2',
  '3',
  '0',
  '1',
  '2',
  '3',
];

const codeAtoms = {
  a: { glsl: deckAGlslAtoms.code, strudel: deckAStrudelAtoms.code },
  b: { glsl: deckBGlslAtoms.code, strudel: deckBStrudelAtoms.code },
};

export function DeckKnobs({ slot, className }: {
  slot: 'a' | 'b';
  className?: string;
}) {
  const paramPrefix = `/deck_${slot}`;

  // The code in the editor, so a knob lights up as soon as it is written and can be set before applying
  const mode = useSettings(slot === 'a' ? 'deckAMode' : 'deckBMode');
  const code = useAtomValue(codeAtoms[slot][mode]);
  const knobsInCode = useMemo(() => referencedKnobs(mode, code), [mode, code]);

  // 2 rows of 4, same as the performance pads of DDJ-FLX2 (pad 1-4 above, pad 5-8 below).
  // The knobs below are toggles, like the pads
  return (
    <div className={clsx('flex justify-center items-center gap-10', className)}>
      <div className="grid grid-cols-[repeat(4,auto)] gap-x-1 gap-y-0.5">
        {paramNames.map((paramName, index) => {
          const DeckControl = index < DDJ_FLX2_JOG_PAD_COUNT ? DeckKnob : DeckToggle;
          return (
            <DeckControl
              key={paramName}
              paramPrefix={paramPrefix}
              label={labels[index]}
              paramName={paramName}
              stalker={knobNameInCode(mode, paramName)}
              isReferenced={knobsInCode.has(paramName)}
            />
          );
        })}
      </div>
      <DeckShiftPads slot={slot} />
    </div>
  );
}
