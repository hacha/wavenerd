import { DDJ_FLX2_DEVICE_NAME_PATTERN } from './midiPresets';
import { type MidiManager } from './MIDIManager';
import { saturate } from '@0b5vr/experimental';

// == DDJ-FLX2 shift + CFX =========================================================================
// Turning CFX while holding SHIFT changes the gain of the channel instead of the filter.
// The FLX2 has no gain knob, and CFX sends the same message with or without SHIFT.
// See: https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf
//
// CFX is an absolute knob, so:
// - the gain follows how much the knob turned, not where it is, so it does not jump on the first touch
// - after that, the filter waits until the knob reaches the filter value again (soft takeover)

const STATUS_NOTE_ON_CH1 = 0x90;
const STATUS_NOTE_ON_CH2 = 0x91;
const STATUS_NOTE_OFF_CH1 = 0x80;
const STATUS_NOTE_OFF_CH2 = 0x81;
const NOTE_SHIFT = 63;

const STATUS_CC_GLOBAL = 0xb6;
const CFX_CCS: { [ cc: number ]: 'a' | 'b' } = {
  23: 'a',
  24: 'b',
};

/**
 * The filter picks up when the knob comes this close to its value.
 */
const PICKUP_THRESHOLD = 0.02;

export function setupDDJFLX2ShiftCFX(midiManager: MidiManager): void {
  const shiftHeld = new Set<number>();
  const lastKnobValues: { a: number | null; b: number | null } = { a: null, b: null };
  const isWaitingPickup = { a: false, b: false };

  midiManager.interceptors.push(({ deviceName, status, data1, data2 }) => {
    if (!DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName)) { return false; }

    // SHIFT of either deck. Note On with velocity 0 is a release
    if (data1 === NOTE_SHIFT) {
      if (status === STATUS_NOTE_ON_CH1 || status === STATUS_NOTE_ON_CH2) {
        if (data2 > 0) {
          shiftHeld.add(status);
        } else {
          shiftHeld.delete(status);
        }
      } else if (status === STATUS_NOTE_OFF_CH1 || status === STATUS_NOTE_OFF_CH2) {
        shiftHeld.delete(status + 0x10);
      }
      return false;
    }

    const deck = status === STATUS_CC_GLOBAL ? CFX_CCS[data1] : undefined;
    if (deck == null) { return false; }

    // same as the CC mapping of MIDIManager
    const knobValue = Math.max(data2 - 1.0, 0.0) / 126.0;
    const lastKnobValue = lastKnobValues[deck];
    lastKnobValues[deck] = knobValue;

    if (shiftHeld.size > 0) {
      if (lastKnobValue != null) {
        const paramKey = `/mixer/channel_${deck}/gain`;
        midiManager.setValue(paramKey, saturate(midiManager.midi(paramKey) + knobValue - lastKnobValue));
      }
      isWaitingPickup[deck] = true;
      return true;
    }

    if (!isWaitingPickup[deck]) { return false; }

    const paramKey = midiManager.mappings[`cc-6-${data1}`];
    if (paramKey == null) {
      isWaitingPickup[deck] = false;
      return false;
    }

    const paramValue = midiManager.midi(paramKey);
    const isClose = Math.abs(knobValue - paramValue) < PICKUP_THRESHOLD;
    const hasCrossed = lastKnobValue != null && (lastKnobValue - paramValue) * (knobValue - paramValue) <= 0.0;
    if (isClose || hasCrossed) {
      isWaitingPickup[deck] = false;
      return false;
    }

    return true;
  });
}
