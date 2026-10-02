import { soundMap } from '@strudel/webaudio';

export interface UserSound {
  /** Name of the asset, before superdough lowercases it. */
  name: string;

  /** The entry of `soundMap` that plays it. */
  sound: unknown;

  /** The sound that had the same name, such as `bd` of the Strudel CDN. Comes back when the user sound is removed. */
  shadowed: unknown;
}

/**
 * The names of `soundMap` taken by the assets of the storage (samples and wavetables).
 *
 * A user sound wins over a sound of the Strudel CDN that has the same name, whichever is loaded first.
 * Shared by every kind of asset, so that two of them never fight over a name: the last one registered wins.
 */
export class UserSoundRegistry {
  private __sounds = new Map<string, UserSound>();

  public constructor() {
    // The sounds of the CDN are registered at any time: at startup, and again when the network is back.
    soundMap.listen(() => this.__claim());
  }

  /**
   * Register a user sound under `key`, replacing the one that has the key.
   *
   * @param register Calls `registerSound` with `key`.
   */
  public add(key: string, name: string, register: () => void): UserSound {
    const current = soundMap.get()[key];
    const existing = this.__sounds.get(key);
    const shadowed = existing != null && existing.sound === current ? existing.shadowed : current;

    // otherwise `__claim` takes the name back for the sound that is being replaced
    this.__sounds.delete(key);

    register();

    const sound: UserSound = { name, sound: soundMap.get()[key], shadowed };
    this.__sounds.set(key, sound);
    return sound;
  }

  /**
   * Unregister a user sound. The sound it was hiding comes back.
   * Does nothing if another user sound has replaced it.
   */
  public remove(key: string, sound: UserSound): void {
    if (this.__sounds.get(key) !== sound) { return; }

    this.__sounds.delete(key);

    if (soundMap.get()[key] === sound.sound) {
      soundMap.setKey(key, sound.shadowed);
    }
  }

  /**
   * Take the names back from the sounds that were registered over the user sounds.
   */
  private __claim(): void {
    for (const [key, sound] of this.__sounds) {
      const current = soundMap.get()[key];
      if (current === sound.sound) { continue; }

      sound.shadowed = current;
      soundMap.setKey(key, sound.sound);
    }
  }
}
