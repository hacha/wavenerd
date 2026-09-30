import { loadBuffer, onTriggerSample, registerSound, soundMap } from '@strudel/webaudio';

interface UserSample {
  /** Name of the asset, before superdough lowercases it. */
  name: string;

  /** The entry of `soundMap` that plays the sample. */
  sound: unknown;

  /** The sound that had the same name, such as `bd` of the Strudel CDN. Comes back when the sample is deleted. */
  shadowed: unknown;
}

/**
 * Samples of the storage, registered as Strudel sounds under the same names as in GLSL decks: `s("kick")`.
 *
 * A sample wins over a sound of the Strudel CDN that has the same name, whichever is loaded first.
 */
export class UserSamples {
  private __audio: AudioContext;
  private __samples = new Map<string, UserSample>();

  public constructor(audio: AudioContext) {
    this.__audio = audio;

    // The sounds of the CDN are registered at any time: at startup, and again when the network is back.
    soundMap.listen(() => this.__claim());
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

    const current = soundMap.get()[key];
    const existing = this.__samples.get(key);
    const shadowed = existing != null && existing.sound === current ? existing.shadowed : current;

    // otherwise `__claim` takes the name back for the sample that is being replaced
    this.__samples.delete(key);

    // not `samples()`, which makes a wavetable out of a name that starts with `wt_`
    registerSound(
      key,
      (t: number, value: unknown, onended: () => void) => onTriggerSample(t, value, onended, bank),
      { type: 'sample', samples: bank, tag: 'user' },
    );

    const sample: UserSample = { name, sound: soundMap.get()[key], shadowed };
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

  private __remove(key: string, sample: UserSample): void {
    this.__samples.delete(key);

    if (soundMap.get()[key] === sample.sound) {
      soundMap.setKey(key, sample.shadowed);
    }
  }

  /**
   * Take the names back from the sounds that were registered over the samples.
   */
  private __claim(): void {
    for (const [key, sample] of this.__samples) {
      const current = soundMap.get()[key];
      if (current === sample.sound) { continue; }

      sample.shadowed = current;
      soundMap.setKey(key, sample.sound);
    }
  }
}
