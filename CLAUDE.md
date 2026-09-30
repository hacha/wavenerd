# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Setup

This is a fork of [0b5vr/wavenerd](https://github.com/0b5vr/wavenerd).

- `origin` = `hacha/wavenerd`, `upstream` = `0b5vr/wavenerd`
- `dev` / `release` track upstream. Sync with `git fetch upstream && git merge upstream/dev`.
- The first Strudel integration attempt is archived in `archive/strudel-v1` (and `archive/strudel-v1-editor-styling`). Use it as reference only; do not merge it.

## Build & Development Commands

Uses **pnpm** (see `.node-version` for the Node version).

```bash
pnpm install      # Install dependencies
pnpm dev          # Start Vite dev server with HMR
pnpm build        # TypeScript check (tsc -b) + Vite production build
pnpm typecheck    # TypeScript check only
pnpm lint         # ESLint check
pnpm lint-fix     # ESLint with auto-fix
pnpm all          # lint + clean + build (full pipeline)
pnpm preview      # Preview production build locally
```

## Architecture Overview

Wavenerd is a browser-based DJ deck application with GLSL shader-based audio synthesis. It uses two `WavenerdDeck` instances from `@0b5vr/wavenerd-deck` for real-time audio generation via GLSL shaders.

Styling uses Tailwind CSS (styled-components has been removed upstream).

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
- `useRecorderSubscribers()` - Recorder state
- `useSettingsSubscribers()` - User preferences
- `useStorageSubscribers()` - OPFS storage contents

Per-frame updates (level meters, visualizers) go through `FrameEmitter` rather than React re-renders.

### Directory Structure

- `src/audio/` - Web Audio API layer (Mixer, channels, EQ, filters, reverb, limiters, recorders, AudioWorklet processors)
- `src/view/components/` - React UI components
- `src/view/stores/atoms/` - Jotai atoms
- `src/view/stores/hooks/` - Subscriber hooks and custom React hooks
- `src/view/visualizers/` - WebGL spectrum/oscilloscope/vectorscope renderers
- `src/view/themes/` - Theme definitions (`theme.css` + per-theme TS files)

### Key Singletons

Initialized in `src/index.tsx`. Some are passed to React via `StuffContext` (`src/view/StuffContext.tsx`):
- `MIDIManager` - WebMIDI device handling, MIDI learn, parameter mapping
- `SettingsManager` - User preferences with OPFS persistence
- `StorageManager` - OPFS-based file storage for samples/wavetables/images/code
- `FrameEmitter` - Per-frame update dispatch
- `FullscreenManager`

### Audio Processing

AudioWorklet processors in `src/audio/` (`*Processor.js` paired with `*Node.ts`):
DCRemoval, HardClip, LookaheadLimiter, FirstOrderFilter, TimeDomainDataProbe, WavRecorder.

### Plugin Systems

- **EQ modes**: `MixerEQIsolator.ts`, `MixerEQNone.ts`
- **Filter modes**: `MixerFilterBiquad.ts`, `MixerFilterGate.ts`, `MixerFilterNone.ts`
- **Crossfader curves**: `xfaderCurveConstantPower.ts`, `xfaderCurveCut.ts`, `xfaderCurveLinear.ts`, `xfaderCurveTransition.ts`

## Icons

Uses `unplugin-icons` with mdi icon set: https://icones.js.org/collection/mdi
