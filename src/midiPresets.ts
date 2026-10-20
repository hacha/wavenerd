export interface MidiPreset {
  name: string;
  deviceNamePattern: RegExp;
  mappings: { [ midiKey: string ]: string };
}

// == DDJ-FLX2 =====================================================================================
// See: https://assets.pioneerdjhub.com/DDJ-FLX2_MIDI_Message_List_E1.pdf
// Knobs and faders send 14-bit values as MSB + LSB (cc + 32), only the MSB is mapped.
// MIDI channel 1 / 2 / 7 of the list are channel 0 / 1 / 6 here.
export const DDJ_FLX2_DEVICE_NAME_PATTERN = /DDJ-FLX2/i;

const presetDDJFLX2: MidiPreset = {
  name: 'DDJ-FLX2',
  deviceNamePattern: DDJ_FLX2_DEVICE_NAME_PATTERN,
  mappings: {
    'cc-0-7': '/mixer/channel_a/eq/high',
    'cc-0-11': '/mixer/channel_a/eq/mid',
    'cc-0-15': '/mixer/channel_a/eq/low',
    'cc-0-19': '/mixer/channel_a/volume',
    'note-0-84': '/cue/channel_a',

    'cc-1-7': '/mixer/channel_b/eq/high',
    'cc-1-11': '/mixer/channel_b/eq/mid',
    'cc-1-15': '/mixer/channel_b/eq/low',
    'cc-1-19': '/mixer/channel_b/volume',
    'note-1-84': '/cue/channel_b',

    'cc-6-23': '/mixer/channel_a/filter', // CFX (CH 1)
    'cc-6-24': '/mixer/channel_b/filter', // CFX (CH 2)
    'cc-6-31': '/mixer/xfader_pos',
    'cc-6-8': '/mixer/master/volume',
  },
};

// == main =========================================================================================
export const MIDI_PRESETS: MidiPreset[] = [
  presetDDJFLX2,
];
