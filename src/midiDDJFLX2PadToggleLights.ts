import { DDJ_FLX2_DEVICE_NAME_PATTERN } from './midiPresets';
import { DDJ_FLX2_JOG_PAD_COUNT } from './midiDDJFLX2PadJog';
import { DDJ_FLX2_PAD_NOTE_BASES, type DDJFLX2Deck, type DDJFLX2Pads } from './midiDDJFLX2Pads';
import { type MidiManager } from './MIDIManager';

// == DDJ-FLX2 pad toggle lights ===================================================================
// Lights pad 5-8 of the controller while the toggle (knob4-7 of the deck) is on.
// The current pad mode is unknown until a pad is pressed, so the light is sent to the pad of every mode.
// See: https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf

/**
 * Note On status of the pads without SHIFT, which is also the message that sets their lights.
 */
const PAD_STATUSES: { [ deck in DDJFLX2Deck ]: number } = {
  a: 0x97,
  b: 0x99,
};

const DECKS: DDJFLX2Deck[] = ['a', 'b'];

const PAD_COUNT = 8;

const PARAM_KEY_PATTERN = /^\/deck_([ab])\/knob([0-9])$/;

export function setupDDJFLX2PadToggleLights(midiManager: MidiManager, pads: DDJFLX2Pads): void {
  function sendLight(deck: DDJFLX2Deck, padIndex: number): void {
    const isOn = midiManager.midi(`/deck_${deck}/knob${padIndex}`) > 0.0;
    for (const base of DDJ_FLX2_PAD_NOTE_BASES) {
      midiManager.send(
        DDJ_FLX2_DEVICE_NAME_PATTERN,
        [PAD_STATUSES[deck], base + padIndex, isOn ? 0x7f : 0x00],
      );
    }
  }

  function sendDeckLights(deck: DDJFLX2Deck): void {
    for (let padIndex = DDJ_FLX2_JOG_PAD_COUNT; padIndex < PAD_COUNT; padIndex++) {
      sendLight(deck, padIndex);
    }
  }

  function sendAllLights(): void {
    for (const deck of DECKS) {
      sendDeckLights(deck);
    }
  }

  midiManager.on('paramChange', ({ paramKey }) => {
    const match = PARAM_KEY_PATTERN.exec(paramKey);
    if (match == null) { return; }

    const padIndex = parseInt(match[2]);
    if (padIndex < DDJ_FLX2_JOG_PAD_COUNT || PAD_COUNT <= padIndex) { return; }

    sendLight(match[1] as DDJFLX2Deck, padIndex);
  });

  // the values are loaded from the storage, and the device may be detected before or after it
  midiManager.on('initStorage', sendAllLights);
  midiManager.on('deviceDetect', ({ deviceName }) => {
    if (DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName)) {
      sendAllLights();
    }
  });

  // in case the controller sets the light by itself on press or release, set it back
  pads.on('change', ({ deck }) => {
    sendDeckLights(deck);
  });
}
