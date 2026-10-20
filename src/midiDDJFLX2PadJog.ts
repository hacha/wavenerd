import { DDJ_FLX2_DEVICE_NAME_PATTERN } from './midiPresets';
import { type DDJFLX2Deck, type DDJFLX2Pads } from './midiDDJFLX2Pads';
import { type MidiManager } from './MIDIManager';
import { saturate } from '@0b5vr/experimental';

// == DDJ-FLX2 pad + jog ===========================================================================
// Turning the jog while holding pads changes the knobs of the deck, pad 1-8 → knob0-7.
// See: https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf

/**
 * Knob change per jog tick. The wheel side and shift + platter are finer.
 */
const KNOB_DELTA_PER_TICK = 1.0 / 512.0;
const KNOB_DELTA_PER_TICK_FINE = KNOB_DELTA_PER_TICK / 4.0;

/**
 * MIDI channels of the jogs, 0-based.
 */
const JOG_CHANNELS: { [ channel: number ]: DDJFLX2Deck } = {
  0: 'a',
  1: 'b',
};

/**
 * Knob change per tick of each jog CC.
 * Each CC sends 0x40 + the ticks turned since the previous message.
 */
const JOG_CC_DELTAS: { [ cc: number ]: number } = {
  34: KNOB_DELTA_PER_TICK, // platter (vinyl on)
  35: KNOB_DELTA_PER_TICK, // platter (vinyl off)
  33: KNOB_DELTA_PER_TICK_FINE, // wheel side
  41: KNOB_DELTA_PER_TICK_FINE, // shift + platter
};

export function setupDDJFLX2PadJog(midiManager: MidiManager, pads: DDJFLX2Pads): void {
  // pads held with SHIFT are kept for other roles
  const heldPads = pads.held;

  midiManager.on('cc', ({ deviceName, channel, cc, rawValue }) => {
    if (!DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName)) { return; }

    const deck = JOG_CHANNELS[channel];
    if (deck == null || heldPads[deck].size === 0) { return; }

    const deltaPerTick = JOG_CC_DELTAS[cc];
    if (deltaPerTick == null) { return; }

    const delta = (rawValue - 0x40) * deltaPerTick;

    for (const padIndex of heldPads[deck]) {
      const paramKey = `/deck_${deck}/knob${padIndex}`;
      midiManager.setValue(paramKey, saturate(midiManager.midi(paramKey) + delta));
    }
  });
}
