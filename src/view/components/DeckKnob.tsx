import { useMemo } from 'react';
import { Knob } from './Knob';
import { useMidiValue } from '../stores/hooks/useMidiValue';
import { UILabel } from './UILabel';
import clsx from 'clsx';

export function DeckKnob({ paramName, paramPrefix, label, stalker, isReferenced, className }: {
  paramName: string;
  paramPrefix: string;
  label: string;
  stalker?: string;
  /** Whether the code of the deck refers to the knob. Dimmed if not. */
  isReferenced: boolean;
  className?: string;
}) {
  const paramFullname = useMemo(
    () => `${paramPrefix}/${paramName}`,
    [paramPrefix, paramName],
  );

  const value = useMidiValue(paramFullname);

  const stalkerWithValue = useMemo(() => {
    const note = isReferenced ? '' : ' (not used in the code)';
    return `${stalker}: ${value.toFixed(3)}${note}`;
  }, [stalker, value, isReferenced]);

  return (
    <div
      className={clsx(
        'flex flex-col justify-center items-center cursor-pointer',
        !isReferenced && 'opacity-40',
        className,
      )}
      data-stalker={stalkerWithValue}
    >
      <Knob
        className="w-8 h-8"
        midiParamName={paramFullname}
        resetValue={0.0}
        deltaValuePerPixel={1.0 / 64.0}
      />
      <UILabel text={label} />
    </div>
  );
}
