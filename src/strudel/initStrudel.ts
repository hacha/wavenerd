import { controls, evalScope } from '@strudel/core';
import * as webaudio from '@strudel/webaudio';
import { createSuperdoughController, samples } from '@wavenerd/superdough';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import type { Repl } from '@strudel/core';

// Register widget types (_scope, _pianoroll, _spiral, etc.) on Pattern.prototype
// This side-effect import calls registerWidget() for each built-in widget type
import '@strudel/codemirror/widget.mjs';

const { webaudioRepl, initAudio, getAudioContext, registerSynthSounds } = webaudio;

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

// Store REPLs per deck
const deckRepls = new Map<string, Repl>();

// Track which decks are ready
const deckReadyState = new Map<string, boolean>();
const deckInitResolvers = new Map<string, () => void>();

// Wait for a specific deck to be fully initialized
export function waitForDeckInit(deckId: 'A' | 'B'): Promise<void> {
  // If already ready, resolve immediately
  if (deckReadyState.get(deckId)) {
    return Promise.resolve();
  }

  // Create a promise that will be resolved when signalDeckReady is called
  return new Promise<void>((resolve) => {
    // Check again in case it became ready while creating the promise
    if (deckReadyState.get(deckId)) {
      resolve();
      return;
    }
    deckInitResolvers.set(deckId, resolve);
  });
}

// Signal that a deck is fully initialized
export function signalDeckReady(deckId: 'A' | 'B'): void {
  console.log(`[Strudel] Deck ${deckId} signaled as ready`);
  deckReadyState.set(deckId, true);

  const resolver = deckInitResolvers.get(deckId);
  if (resolver) {
    resolver();
    deckInitResolvers.delete(deckId);
  }
}

export async function initStrudel(
  audioContext?: AudioContext
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export async function initStrudelDeck(
  deckId: 'A' | 'B',
  audioContext: AudioContext,
  destination: GainNode
): Promise<Repl> {
  const controllerId = `deck${deckId}`;

  // Ensure Strudel is initialized first
  await initStrudel(audioContext);

  // Create a controller for this deck with custom destination
  createSuperdoughController(controllerId, audioContext, destination);
  console.log(`[Strudel] Created controller for Deck ${deckId} -> custom destination`);

  // Create a REPL instance for this deck
  console.log(`[Strudel] Creating REPL for Deck ${deckId}...`);
  const repl = webaudioRepl({
    // getTime will use Strudel's internal audio context
    // defaultOutput will use superdough
  });

  deckRepls.set(deckId, repl);
  console.log(`[Strudel] REPL created for Deck ${deckId}`);

  return repl;
}

export function getStrudelRepl(deckId?: 'A' | 'B'): Repl | null {
  if (deckId) {
    return deckRepls.get(deckId) || null;
  }
  // Return first available REPL for backward compatibility
  const values = deckRepls.values();
  const first = values.next();
  return first.done ? null : first.value;
}

export function isStrudelInitialized(): boolean {
  return initialized;
}

export function getControllerId(deckId: 'A' | 'B'): string {
  return `deck${deckId}`;
}
