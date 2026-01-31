# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
yarn dev          # Start Vite dev server with HMR
yarn build        # TypeScript check + Vite production build
yarn lint         # ESLint check
yarn lint-fix     # ESLint with auto-fix
yarn all          # lint + clean + build (full pipeline)
yarn clean        # Remove dist/ directory
yarn preview      # Preview production build locally
```

## Architecture Overview

Wavenerd is a browser-based DJ deck application with GLSL shader-based audio synthesis. It uses two `WavenerdDeck` instances from `@0b5vr/wavenerd-deck` for real-time audio generation via GLSL shaders.

### Core Data Flow

```
WavenerdDeck A/B → Mixer → Reverb → Master Gain → AudioDestinationRouter → Speakers/Headphones
                    ↓
              CueMixer (headphone monitoring)
                    ↓
              Analysers (visualization)
```

### State Management Pattern (Jotai)

The app bridges non-React event emitters to React via Jotai atoms:

1. **Backend systems** (WavenerdDeck, MIDIManager, etc.) emit events
2. **Subscriber hooks** (`src/view/stores/hooks/use*Subscribers.ts`) listen and update atoms
3. **Components** read atoms with `useAtomValue()`

Key subscriber hooks:
- `useDeckSubscribers()` - Deck code, errors, BPM, transport state
- `useMidiSubscribers()` - MIDI mappings and real-time values
- `useAnalyserSubscribers()` - FFT data for visualizers
- `useSettingsSubscribers()` - User preferences

### Directory Structure

- `src/audio/` - Web Audio API layer (Mixer, channels, EQ, filters, reverb, limiters, AudioWorklet processors)
- `src/view/components/` - React UI components
- `src/view/stores/atoms/` - Jotai atoms (deck, midi, settings, recorder, analyser, storage)
- `src/view/stores/hooks/` - Subscriber hooks and custom React hooks
- `src/view/visualizers/` - WebGL spectrum/oscilloscope/vectorscope renderers
- `src/view/themes/` - Theme definitions

### Key Singleton Managers

Initialized in `src/index.tsx` and passed via `StuffContext`:
- `MIDIManager` - WebMIDI device handling, MIDI learn, parameter mapping
- `SettingsManager` - User preferences with OPFS persistence
- `StorageManager` - OPFS-based file storage for samples/wavetables/images/code

### Audio Processing

AudioWorklet processors in `src/audio/`:
- `DCRemovalProcessor.js` / `DCRemovalNode.ts`
- `HardClipProcessor.js` / `HardClipNode.ts`
- `LookaheadLimiterProcessor.js` / `LookaheadLimiterNode.ts`
- `FirstOrderFilterProcessor.js` / `FirstOrderFilterNode.ts`
- `TimeDomainDataProbeProcessor.js` / `TimeDomainDataProbeNode.ts`

### Plugin Systems

- **EQ modes**: `MixerEQIsolator.ts`, `MixerEQSimplified.ts`, `MixerEQNone.ts`
- **Filter modes**: `MixerFilterBiquad.ts`, `MixerFilterGate.ts`, `MixerFilterNone.ts`
- **Crossfader curves**: `xfaderCurveConstantPower.ts`, `xfaderCurveCut.ts`, `xfaderCurveLinear.ts`, `xfaderCurveTransition.ts`

## Icons

Uses `unplugin-icons` with mdi icon set: https://icones.js.org/collection/mdi
