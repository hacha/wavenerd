import { DDJ_FLX2_JOG_PAD_COUNT } from './midiDDJFLX2PadJog';
import { type DDJFLX2Pads } from './midiDDJFLX2Pads';
import { type MidiManager } from './MIDIManager';

// == DDJ-FLX2 pad → toggle ========================================================================
// Pressing pad 5-8 (without SHIFT) toggles knob4-7 of the deck between 0 and 1.

export function setupDDJFLX2PadToggle(midiManager: MidiManager, pads: DDJFLX2Pads): void {
  pads.on('press', ({ deck, padIndex, isShift }) => {
    if (isShift || padIndex < DDJ_FLX2_JOG_PAD_COUNT) { return; }

    const paramKey = `/deck_${deck}/knob${padIndex}`;
    midiManager.setValue(paramKey, midiManager.midi(paramKey) > 0.0 ? 0.0 : 1.0);
  });
}
