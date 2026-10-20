import clsx from 'clsx';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';
import { DeckKnob } from './DeckKnob';
import { DeckShiftPads } from './DeckShiftPads';
import { deckAGlslAtoms, deckAStrudelAtoms, deckBGlslAtoms, deckBStrudelAtoms } from '../stores/atoms/deck';
import { useSettings } from '../stores/hooks/useSettings';
import { referencedKnobs } from '../utils/referencedKnobs';

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

const labels = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
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

  // 2 rows of 4, same as the performance pads of DDJ-FLX2 (pad 1-4 above, pad 5-8 below)
  return (
    <div className={clsx('flex justify-center items-center gap-4', className)}>
      <div className="grid grid-cols-[repeat(4,auto)] gap-x-1 gap-y-0.5">
        {paramNames.map((paramName, index) => (
          <DeckKnob
            key={paramName}
            paramPrefix={paramPrefix}
            label={labels[index]}
            paramName={paramName}
            stalker={`param_${paramName}`}
            isReferenced={knobsInCode.has(paramName)}
          />
        ))}
      </div>
      <DeckShiftPads slot={slot} />
    </div>
  );
}
