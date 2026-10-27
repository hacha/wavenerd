import { useCallback, useMemo } from 'react';
import { MIDIMAN } from '../../MIDIManager';
import { MIDILearnable } from './MIDILearnable';
import { useMidiValue } from '../stores/hooks/useMidiValue';
import { UILabel } from './UILabel';
import clsx from 'clsx';
import styles from './Knob.module.css';

/**
 * A knob of the deck used as a toggle between 0 and 1, same as pressing its pad of DDJ-FLX2.
 */
export function DeckToggle({ paramName, paramPrefix, label, stalker, isReferenced, className }: {
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

  const isOn = useMidiValue(paramFullname) > 0.0;

  const stalkerWithState = useMemo(() => {
    const note = isReferenced ? '' : ' (not used in the code)';
    return `${stalker}: ${isOn ? 'on' : 'off'}${note}`;
  }, [stalker, isOn, isReferenced]);

  const handleClick = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) { return; }
    MIDIMAN.setValue(paramFullname, MIDIMAN.midi(paramFullname) > 0.0 ? 0.0 : 1.0);
  }, [paramFullname]);

  // same cell size as `DeckKnob`
  return (
    <div
      className={clsx(
        'flex flex-col justify-center items-center cursor-pointer select-none',
        !isReferenced && 'opacity-40',
        className,
      )}
      data-stalker={stalkerWithState}
    >
      <div
        className="relative w-8 h-8 flex justify-center items-center"
        onMouseDown={handleClick}
      >
        {/* a slide switch, the thumb moves to the right when on */}
        <div
          className={clsx(
            'relative w-7 h-4 rounded-full transition-colors',
            isOn ? 'bg-accent' : 'bg-knob-border',
          )}
        >
          <div
            className={clsx(
              'absolute top-0.5 left-0.5 w-3 h-3 rounded-full transition-transform',
              isOn && 'translate-x-3',
              styles.body, // the theme color of the knobs may be a gradient
            )}
          />
        </div>
        <MIDILearnable paramName={paramFullname} />
      </div>
      <UILabel text={label} />
    </div>
  );
}
