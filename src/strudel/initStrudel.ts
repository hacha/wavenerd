import { controls, evalScope } from '@strudel/core';
import * as webaudio from '@strudel/webaudio';
import { samples } from '@wavenerd/superdough';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';

// Register widget types (_scope, _pianoroll, _spiral, etc.) on Pattern.prototype
// This side-effect import calls registerWidget() for each built-in widget type
import '@strudel/codemirror/widget.mjs';

const { initAudio, registerSynthSounds } = webaudio;

// Debug: Check which superdough is being used
console.log('[initStrudel] Module loaded');
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - superdough is aliased by Vite
import('superdough').then((sd: Record<string, unknown>) => {
  console.log('[initStrudel] superdough module keys:', Object.keys(sd).slice(0, 10));
  console.log('[initStrudel] soundMap type:', typeof sd.soundMap);
  console.log('[initStrudel] soundMap is object:', sd.soundMap && typeof sd.soundMap === 'object');
}).catch((e: Error) => {
  console.error('[initStrudel] Failed to import superdough:', e);
});

let initialized = false;
let initPromise: Promise<void> | null = null;

export async function initStrudel(
  audioContext?: AudioContext,
): Promise<void> {
  if (initialized) {
    console.log('[Strudel] Already initialized');
    return;
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log('[Strudel] Initializing audio...');
      console.log('[Strudel] audioContext arg:', audioContext?.constructor?.name, audioContext?.state);

      // Initialize Strudel's audio system with custom AudioContext if provided
      // This ensures Strudel uses the same AudioContext as Wavenerd
      console.log('[Strudel] Calling initAudio...');
      await initAudio({ audioContext });
      console.log('[Strudel] initAudio completed');

      // Register synth sounds (sawtooth, square, etc.)
      // With Vite alias, @strudel/webaudio imports 'superdough' which now resolves to our fork.
      // This ensures registerSynthSounds populates our fork's soundMap directly.
      console.log('[Strudel] Registering synth sounds...');
      await registerSynthSounds();
      console.log('[Strudel] registerSynthSounds completed');

      // Verify the soundMap is populated (all superdough imports should resolve to our fork)
      const superdough = await import('@wavenerd/superdough') as any;
      // soundMap is a nanostores map, need to call .get() to get the actual data
      const soundMapData = superdough.soundMap?.get?.() || superdough.soundMap || {};
      const soundKeys = Object.keys(soundMapData);
      console.log('[Strudel] soundMap has', soundKeys.length, 'sounds:', soundKeys.slice(0, 10).join(', '), '...');

      // Register pattern functions in eval scope
      console.log('[Strudel] Setting up evalScope...');
      evalScope(controls, mini, tonal, webaudio, { samples });

      // Load default samples (Dirt-Samples from TidalCycles)
      console.log('[Strudel] Loading default samples...');
      try {
        await samples('github:tidalcycles/Dirt-Samples/main');
        console.log('[Strudel] Default samples loaded');
      } catch (e) {
        console.warn('[Strudel] Failed to load default samples:', e);
      }

      initialized = true;
      console.log('[Strudel] Audio initialized successfully');
    } catch (error) {
      console.error('[Strudel] Initialization failed:', error);
      throw error;
    }
  })();

  return initPromise;
}

export function getControllerId(deckId: 'A' | 'B'): string {
  return `deck${deckId}`;
}
