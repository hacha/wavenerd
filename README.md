# Wavenerd

GLSL and Strudel music live coding environment

[https://hacha.github.io/wavenerd/](https://hacha.github.io/wavenerd/)

## Overview

Wavenerd is a GLSL and [Strudel](https://codeberg.org/uzu/strudel) music live coding environment runs in your web browser.

It's basically a 2-deck DJ setup but turntables are replaced with code. Each deck runs either a GLSL synthesizer or Strudel pattern code. You can write and play music code to create your bangers, and mix them with the built-in DJ mixer.

Since Wavenerd is designed for live performance, it has several features to make it easier to use in a live setting.

## Features

- 🎶 Two decks of real-time GLSL synthesizers or Strudel patterns
- 🔀 Each deck can be switched between GLSL and Strudel. A Strudel deck follows the deck's clock, BPM and transport
- 🎚️ MIDI controllable DJ mixer and knob parameters, `knob0` to `knob7` and MIDI control work in Strudel code too
- ♻️ Compiles while playing, applies in sync with the beat
- ⌨️ Keyboard shortcuts optimized for live performance
- ✍️ Editor support for Strudel: completion, highlighting of the playing elements, and the same color scheme as the Strudel REPL
- 👁️ Oscilloscope, spectrum analyzer, vectorscope
- 🎨 Variety of color themes, including chroma key-friendly ones
- 📂 Samples, wavetables, and images can be used in shaders
- 🗂️ Strudel sketches are kept in the asset list and opened with `Mod-P`
- 🤖 Live coding together with Claude Code: Claude Code writes `live/A.strudel.js` / `live/B.strudel.js`, which get cued to the Strudel decks. Only works with the local dev server (`pnpm dev`), not on the published site. See [doc/strudel-integration.md](doc/strudel-integration.md)

## How to use?

See [the help](guides/help.md), it should work as a manual and a tutorial.

To run it locally, see [DEVELOPMENT.md](DEVELOPMENT.md).

## About this fork

This is a fork of [0b5vr/wavenerd](https://github.com/0b5vr/wavenerd). The upstream version is available at [https://0b5vr.github.io/wavenerd/](https://0b5vr.github.io/wavenerd/).

This fork adds Strudel decks and a Claude Code live bridge. It is relicensed under AGPL-3.0-or-later, since Strudel and superdough are AGPL-3.0-or-later (see License below).

## License

This fork is licensed under [AGPL-3.0-or-later](LICENSE), since it depends on [Strudel](https://codeberg.org/uzu/strudel) and superdough (AGPL-3.0-or-later).

The code originally written for [0b5vr/wavenerd](https://github.com/0b5vr/wavenerd) is also available under the [MIT License](LICENSE-MIT).
