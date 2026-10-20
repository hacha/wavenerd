import { MIDIMAN } from '../../../MIDIManager';
import { MIDI_PRESETS } from '../../../midiPresets';
import { SettingsItemButton } from './SettingsItemButton';

// == components ===================================================================================
export function SettingsItemMIDIPresets() {
  return (
    <>
      {MIDI_PRESETS.map((preset) => (
        <SettingsItemButton
          key={preset.name}
          name={`${preset.name} Preset`}
          label="Apply"
          onClick={() => MIDIMAN.applyPreset(preset)}
          stalkerText={`Assign the default mappings of ${preset.name} (applied automatically the first time it is detected)`}
        />
      ))}
    </>
  );
}
