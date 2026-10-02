import { loadBuffer, onTriggerSample, registerSound } from '@strudel/webaudio';
import { type UserSound, type UserSoundRegistry } from './UserSoundRegistry';

/**
 * Samples of the storage, registered as Strudel sounds under the same names as in GLSL decks: `s("kick")`.
 *
 * A sample wins over a sound of the Strudel CDN that has the same name (see {@link UserSoundRegistry}).
 */
export class UserSamples {
  private __audio: AudioContext;
  private __registry: UserSoundRegistry;
  private __samples = new Map<string, UserSound>();

  public constructor(audio: AudioContext, registry: UserSoundRegistry) {
    this.__audio = audio;
    this.__registry = registry;
  }

  /**
   * Names of the samples, as they are written in `s()`.
   */
  public get names(): string[] {
    return [...this.__samples.keys()];
  }

  /**
   * Register a sample, or replace the one that has the same name.
   *
   * @param data An audio file. It is copied, so it can be decoded by others after this.
   */
  public async set(name: string, data: ArrayBuffer): Promise<void> {
    const key = name.toLowerCase();
    if (key === '') { return; }

    // superdough caches the audio by its URL forever, so every content needs its own URL
    const url = URL.createObjectURL(new Blob([data]));
    const bank = [url];

    // not `samples()`, which makes a wavetable out of a name that starts with `wt_`
    const sample = this.__registry.add(key, name, () => registerSound(
      key,
      (t: number, value: unknown, onended: () => void) => onTriggerSample(t, value, onended, bank),
      { type: 'sample', samples: bank, tag: 'user' },
    ));
    this.__samples.set(key, sample);

    // Decode now. Otherwise the first hit of the sample is dropped while it is decoded.
    try {
      await loadBuffer(url, this.__audio, key);
    } catch (e: unknown) {
      console.warn(`[strudel] failed to decode sample: ${name}`, e);

      if (this.__samples.get(key) === sample) {
        this.__remove(key, sample);
      }
    } finally {
      // the decoded audio stays in the cache of superdough
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Unregister a sample. The sound it was hiding comes back.
   */
  public delete(name: string): void {
    const key = name.toLowerCase();
    const sample = this.__samples.get(key);

    // `Kick` and `kick` share a key. Only the one that is registered can be deleted
    if (sample == null || sample.name !== name) { return; }

    this.__remove(key, sample);
  }

  private __remove(key: string, sample: UserSound): void {
    this.__samples.delete(key);
    this.__registry.remove(key, sample);
  }
}
