import clsx from 'clsx';
import { useAtomValue } from 'jotai';
import { ddjFlx2ShiftPadsAtom } from '../stores/atoms/midi';
import { DDJ_FLX2_PADS } from '../../midiDDJFLX2Pads';
import { DDJ_FLX2_SHIFT_PAD_FX } from '../../midiDDJFLX2PadFx';
import { UILabel } from './UILabel';

/**
 * The pads of DDJ-FLX2 held with SHIFT, in 2 rows of 4 like the controller, labeled with their Live FX.
 * Holding one with the pointer works the same as SHIFT + pad.
 */
export function DeckShiftPads({ slot, className }: {
  slot: 'a' | 'b';
  className?: string;
}) {
  const shiftPads = useAtomValue(ddjFlx2ShiftPadsAtom)[slot];

  // same grid and cell size as the knobs of `DeckKnobs`
  return (
    <div className={clsx('grid grid-cols-[repeat(4,auto)] gap-x-1 gap-y-0.5', className)}>
      {DDJ_FLX2_SHIFT_PAD_FX.map(({ label, description }, padIndex) => (
        <div
          key={padIndex}
          className="flex flex-col justify-center items-center cursor-pointer touch-none select-none"
          data-stalker={`SHIFT + pad ${padIndex + 1}: ${description} (Strudel)`}
          onPointerDown={(event) => {
            if (event.button !== 0) { return; }
            event.currentTarget.setPointerCapture(event.pointerId);
            DDJ_FLX2_PADS.press(slot, padIndex, true);
          }}
          onPointerUp={() => DDJ_FLX2_PADS.release(slot, padIndex)}
          onLostPointerCapture={() => DDJ_FLX2_PADS.release(slot, padIndex)}
        >
          <div className="w-8 h-8 flex justify-center items-center">
            <div
              className={clsx(
                'w-6 h-6 rounded',
                shiftPads.includes(padIndex) ? 'bg-accent' : 'bg-knob-border',
              )}
            />
          </div>
          <UILabel text={label} />
        </div>
      ))}
    </div>
  );
}
