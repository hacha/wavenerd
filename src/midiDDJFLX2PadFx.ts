import { type DDJFLX2Pads } from './midiDDJFLX2Pads';
import { type StrudelDeck } from './strudel/StrudelDeck';
import { type StrudelLiveFxName } from './strudel/StrudelLiveFx';

// == DDJ-FLX2 SHIFT + pad → Live FX ===============================================================
// Holding SHIFT + pads applies the Live FX of the Strudel deck while they are held.

/**
 * The Live FX of SHIFT + pad 1-8, in 2 rows of 4 like the controller.
 */
export const DDJ_FLX2_SHIFT_PAD_FX: { name: StrudelLiveFxName; label: string; description: string }[] = [
  { name: 'roll16', label: '1/16', description: 'Roll 1/16' },
  { name: 'roll8', label: '1/8', description: 'Roll 1/8' },
  { name: 'roll4', label: '1/4', description: 'Roll 1/4' },
  { name: 'roll2', label: '1/2', description: 'Roll 1/2' },
  { name: 'octDown', label: 'OCT-', description: 'Octave down' },
  { name: 'octUp', label: 'OCT+', description: 'Octave up' },
  { name: 'rise', label: 'RISE', description: 'Rise a semitone per sixteenth' },
  { name: 'stab', label: 'STAB', description: 'Short gate' },
];

export function setupDDJFLX2PadFx(pads: DDJFLX2Pads, decks: { a: StrudelDeck; b: StrudelDeck }): void {
  pads.on('change', ({ deck }) => {
    const names = [...pads.heldWithShift[deck]].map((padIndex) => DDJ_FLX2_SHIFT_PAD_FX[padIndex].name);
    decks[deck].setLiveFx(names);
  });
}
