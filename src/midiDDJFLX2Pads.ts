import { DDJ_FLX2_DEVICE_NAME_PATTERN } from './midiPresets';
import { EventEmittable } from './utils/EventEmittable';
import { type MidiManager } from './MIDIManager';

// == DDJ-FLX2 pads ================================================================================
// Which performance pads are held, with and without SHIFT.
// See: https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf

export type DDJFLX2Deck = 'a' | 'b';

/**
 * MIDI channels of the pads, 0-based.
 */
const PAD_CHANNELS: { [ channel: number ]: { deck: DDJFLX2Deck; isShift: boolean } } = {
  7: { deck: 'a', isShift: false },
  8: { deck: 'a', isShift: true },
  9: { deck: 'b', isShift: false },
  10: { deck: 'b', isShift: true },
};

/**
 * The note of pad 1 in each pad mode. Pad 2-8 follow it.
 */
const PAD_NOTE_BASES = [0, 16, 96, 48];

function padIndexOf(note: number): number | null {
  for (const base of PAD_NOTE_BASES) {
    if (base <= note && note < base + 8) {
      return note - base;
    }
  }
  return null;
}

export interface DDJFLX2PadsEvents {
  change: { deck: DDJFLX2Deck };
}

export class DDJFLX2Pads extends EventEmittable<DDJFLX2PadsEvents> {
  /**
   * Indices (0-7) of the pads held without SHIFT, per deck.
   */
  public readonly held = { a: new Set<number>(), b: new Set<number>() };

  /**
   * Indices (0-7) of the pads held with SHIFT, per deck.
   */
  public readonly heldWithShift = { a: new Set<number>(), b: new Set<number>() };

  /**
   * Press a pad. Also used by the pads on screen.
   */
  public press(deck: DDJFLX2Deck, padIndex: number, isShift: boolean): void {
    (isShift ? this.heldWithShift : this.held)[deck].add(padIndex);
    this.__emit('change', { deck });
  }

  public release(deck: DDJFLX2Deck, padIndex: number): void {
    // SHIFT may change between press and release, so release both
    this.held[deck].delete(padIndex);
    this.heldWithShift[deck].delete(padIndex);
    this.__emit('change', { deck });
  }

  public listen(midiManager: MidiManager): void {
    midiManager.on('noteOn', ({ deviceName, channel, note, velocity }) => {
      // Note On with velocity 0 is a release
      this.__handlePad(deviceName, channel, note, velocity > 0.0);
    });

    midiManager.on('noteOff', ({ deviceName, channel, note }) => {
      this.__handlePad(deviceName, channel, note, false);
    });
  }

  private __handlePad(deviceName: string, channel: number, note: number, isPressed: boolean): void {
    if (!DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName)) { return; }

    const padChannel = PAD_CHANNELS[channel];
    const padIndex = padIndexOf(note);
    if (padChannel == null || padIndex == null) { return; }

    const { deck, isShift } = padChannel;

    if (isPressed) {
      this.press(deck, padIndex, isShift);
    } else {
      this.release(deck, padIndex);
    }
  }
}

export const DDJ_FLX2_PADS = new DDJFLX2Pads();
