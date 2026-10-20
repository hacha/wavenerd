import { DDJ_FLX2_DEVICE_NAME_PATTERN } from './midiPresets';
import { type MidiManager } from './MIDIManager';

// == DDJ-FLX2 cue lights ==========================================================================
// Lights HEADPHONE CUE (CH) of the controller while the cue of the channel is on.
// See: https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf

const NOTE_CUE = 0x54;

/**
 * Note On status of each cue button, which is also the message that sets its light.
 */
const CUE_STATUSES: { [ paramKey: string ]: number } = {
  '/cue/channel_a': 0x90,
  '/cue/channel_b': 0x91,
};

export function setupDDJFLX2CueLights(midiManager: MidiManager): void {
  function sendLight(paramKey: string): void {
    const status = CUE_STATUSES[paramKey];
    const isOn = midiManager.midi(paramKey) > 0.0;
    midiManager.send(DDJ_FLX2_DEVICE_NAME_PATTERN, [status, NOTE_CUE, isOn ? 0x7f : 0x00]);
  }

  function sendAllLights(): void {
    for (const paramKey of Object.keys(CUE_STATUSES)) {
      sendLight(paramKey);
    }
  }

  midiManager.on('paramChange', ({ paramKey }) => {
    if (CUE_STATUSES[paramKey] != null) {
      sendLight(paramKey);
    }
  });

  // the values are loaded from the storage, and the device may be detected before or after it
  midiManager.on('initStorage', sendAllLights);
  midiManager.on('deviceDetect', ({ deviceName }) => {
    if (DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName)) {
      sendAllLights();
    }
  });

  // in case the controller sets the light by itself on press or release, set it back
  midiManager.on('noteOn', ({ deviceName, channel, note }) => {
    if (DDJ_FLX2_DEVICE_NAME_PATTERN.test(deviceName) && note === NOTE_CUE && channel <= 1) {
      sendAllLights();
    }
  });
}
