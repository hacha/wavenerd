import { DDJ_FLX2_DEVICE_NAME_PATTERN } from './midiPresets';
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
 * MIDI channels of the pads (without / with shift), 0-based.
 */
const PAD_CHANNELS: { [ channel: number ]: 'a' | 'b' } = {
  7: 'a',
  8: 'a',
  9: 'b',
  10: 'b',
};

/**
 * The note of pad 1 in each pad mode. Pad 2-8 follow it.
 */
const PAD_NOTE_BASES = [0, 16, 96, 48];

/**
 * MIDI channels of the jogs, 0-based.
 */
const JOG_CHANNELS: { [ channel: number ]: 'a' | 'b' } = {
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

function padIndexOf(note: number): number | null {
  for (const base of PAD_NOTE_BASES) {
    if (base <= note && note < base + 8) {
      return note - base;
    }
  }
  return null;
}

export function setupDDJFLX2PadJog(midiManager: MidiManager): void {
  const heldPads = {
    a: new Set<number>(),
    b: new Set<number>(),
  };

  function handlePad(deviceName: string, channel: number, note: number, isPressed: boolean): void {
    if (!DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName)) { return; }

    const deck = PAD_CHANNELS[channel];
    const padIndex = padIndexOf(note);
    if (deck == null || padIndex == null) { return; }

    if (isPressed) {
      heldPads[deck].add(padIndex);
    } else {
      heldPads[deck].delete(padIndex);
    }
  }

  midiManager.on('noteOn', ({ deviceName, channel, note, velocity }) => {
    // Note On with velocity 0 is a release
    handlePad(deviceName, channel, note, velocity > 0.0);
  });

  midiManager.on('noteOff', ({ deviceName, channel, note }) => {
    handlePad(deviceName, channel, note, false);
  });

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
