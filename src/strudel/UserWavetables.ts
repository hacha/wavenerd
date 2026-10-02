import { registerWaveTable } from '@strudel/webaudio';
import { type UserSound, type UserSoundRegistry } from './UserSoundRegistry';

/** Same as GLSL decks: one frame (a single cycle) is 2048 values. */
const FRAME_LENGTH = 2048;

/** Only written in the WAV header. superdough decodes a wavetable at the rate of its file, so it is never resampled. */
const WAV_SAMPLE_RATE = 48000;

interface UserWavetable {
  sound: UserSound;

  /** superdough fetches the table when it is played first, so the URL lives until the wavetable is replaced. */
  url: string;
}

/**
 * Wavetables of the storage, registered as Strudel wavetable synths: `wavetables/saw.bin` is `s("wt_saw")`.
 *
 * A file of the storage is raw 32-bit floats, as GLSL decks read it. superdough only reads audio files,
 * so it is wrapped in a WAV.
 * A wavetable wins over a sound of the Strudel CDN that has the same name (see {@link UserSoundRegistry}).
 */
export class UserWavetables {
  private __registry: UserSoundRegistry;
  private __wavetables = new Map<string, UserWavetable>();

  public constructor(registry: UserSoundRegistry) {
    this.__registry = registry;
  }

  /**
   * Names of the wavetables, as they are written in `s()`.
   */
  public get names(): string[] {
    return [...this.__wavetables.keys()];
  }

  /**
   * Register a wavetable, or replace the one that has the same name.
   *
   * @param data Raw 32-bit floats, `2048 * frames` long. It is copied.
   */
  public set(name: string, data: ArrayBuffer): void {
    const key = wavetableKey(name);
    if (key === 'wt_') { return; }

    const values = new Float32Array(data, 0, Math.floor(data.byteLength / 4));
    if (values.length < FRAME_LENGTH) {
      console.warn(`[strudel] wavetable is shorter than a frame (${FRAME_LENGTH} values): ${name}`);
      return;
    }

    // superdough caches the table by its URL forever, so every content needs its own URL
    const url = URL.createObjectURL(encodeWav(values, WAV_SAMPLE_RATE));

    const sound = this.__registry.add(key, name, () => registerWaveTable(
      key,
      [url],
      { frameLen: FRAME_LENGTH, tag: 'user' },
    ));

    const existing = this.__wavetables.get(key);
    if (existing != null) {
      URL.revokeObjectURL(existing.url);
    }

    this.__wavetables.set(key, { sound, url });
  }

  /**
   * Unregister a wavetable. The sound it was hiding comes back.
   */
  public delete(name: string): void {
    const key = wavetableKey(name);
    const wavetable = this.__wavetables.get(key);

    // `Saw` and `saw` share a key. Only the one that is registered can be deleted
    if (wavetable == null || wavetable.sound.name !== name) { return; }

    this.__wavetables.delete(key);
    this.__registry.remove(key, wavetable.sound);
    URL.revokeObjectURL(wavetable.url);
  }
}

/**
 * `wt_` in front, as the wavetables of the Strudel CDN, unless the name already has it.
 */
function wavetableKey(name: string): string {
  const key = name.toLowerCase();
  return key.startsWith('wt_') ? key : `wt_${key}`;
}

/**
 * A mono WAV of 32-bit floats.
 */
function encodeWav(values: Float32Array<ArrayBuffer>, sampleRate: number): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const dataSize = values.length * 4;
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      header.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  header.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  header.setUint32(16, 16, true); // size of the format chunk
  header.setUint16(20, 3, true); // IEEE float
  header.setUint16(22, 1, true); // channels
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 4, true); // bytes per second
  header.setUint16(32, 4, true); // bytes per frame
  header.setUint16(34, 32, true); // bits per sample
  writeString(36, 'data');
  header.setUint32(40, dataSize, true);

  return new Blob([header, values]);
}
