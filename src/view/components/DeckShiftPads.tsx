import clsx from 'clsx';
import { useAtomValue } from 'jotai';
import { ddjFlx2ShiftPadsAtom, midiDevicesAtom } from '../stores/atoms/midi';
import { DDJ_FLX2_DEVICE_NAME_PATTERN } from '../../midiPresets';
import { UILabel } from './UILabel';

const padIndices = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * The pads of DDJ-FLX2 held with SHIFT, in 2 rows of 4 like the controller.
 * Shown only while a DDJ-FLX2 is detected.
 */
export function DeckShiftPads({ slot, className }: {
  slot: 'a' | 'b';
  className?: string;
}) {
  const devices = useAtomValue(midiDevicesAtom);
  const shiftPads = useAtomValue(ddjFlx2ShiftPadsAtom)[slot];

  const isDetected = devices.some(({ deviceName }) => DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName));
  if (!isDetected) { return null; }

  // same grid and cell size as the knobs of `DeckKnobs`, labeled with the knob of the same position
  return (
    <div className={clsx('grid grid-cols-[repeat(4,auto)] gap-x-1 gap-y-0.5', className)}>
      {padIndices.map((padIndex) => (
        <div
          key={padIndex}
          className="flex flex-col justify-center items-center"
          data-stalker={`SHIFT + pad ${padIndex + 1}`}
        >
          <div className="w-8 h-8 flex justify-center items-center">
            <div
              className={clsx(
                'w-6 h-6 rounded',
                shiftPads.includes(padIndex) ? 'bg-accent' : 'bg-knob-border',
              )}
            />
          </div>
          <UILabel text={`${padIndex}`} />
        </div>
      ))}
    </div>
  );
}
