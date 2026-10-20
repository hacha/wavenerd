import { SettingsItemMIDIDeviceList } from './SettingsItemMIDIDeviceList';
import { SettingsItemMIDIMappings } from './SettingsItemMIDIMappings';
import { SettingsItemMIDIMonitor } from './SettingsItemMIDIMonitor';
import { SettingsItemMIDIPresets } from './SettingsItemMIDIPresets';

// == components ===================================================================================
export function SettingsContentMIDI() {
  return (
    <>
      <SettingsItemMIDIDeviceList />
      <SettingsItemMIDIMappings />
      <SettingsItemMIDIPresets />
      <SettingsItemMIDIMonitor />
    </>
  );
}
