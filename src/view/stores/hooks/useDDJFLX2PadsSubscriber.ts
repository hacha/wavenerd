import { ddjFlx2ShiftPadsAtom } from '../atoms/midi';
import { type DDJFLX2Pads } from '../../../midiDDJFLX2Pads';
import { useEffect } from 'react';
import { useSetAtom } from 'jotai';

export function useDDJFLX2PadsSubscriber(pads: DDJFLX2Pads) {
  const setShiftPads = useSetAtom(ddjFlx2ShiftPadsAtom);

  useEffect(() => {
    const update = () => setShiftPads({
      a: Array.from(pads.heldWithShift.a),
      b: Array.from(pads.heldWithShift.b),
    });
    update();

    const handleChange = pads.on('change', update);

    return () => pads.off('change', handleChange);
  }, [pads, setShiftPads]);
}
