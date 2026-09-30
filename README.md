# Wavenerd

GLSL music live coding environment

[https://0b5vr.github.io/wavenerd/](https://0b5vr.github.io/wavenerd/)

## Overview

Wavenerd is a GLSL music live coding environment runs in your web browser.

It's basically a 2-deck DJ setup but turntables are replaced with GLSL synthesizers. You can write and play GLSL music code to create your bangers, and mix them with the built-in DJ mixer.

Since Wavenerd is designed for live performance, it has several features to make it easier to use in a live setting.

## Features

- 🎶 Two decks of real-time GLSL synthesizers
- 🎚️ MIDI controllable DJ mixer and knob parameters
- ♻️ Compiles while playing, applies in sync with the beat
- ⌨️ Keyboard shortcuts optimized for live performance
- 👁️ Oscilloscope, spectrum analyzer, vectorscope
- 🎨 Variety of color themes, including chroma key-friendly ones
- 📂 Samples, wavetables, and images can be used in shaders

## How to use?

See [the help](guides/help.md), it should work as a manual and a tutorial.

## Differences from upstream

This is a fork of [0b5vr/wavenerd](https://github.com/0b5vr/wavenerd).

- Strudel decks: each deck can be switched between GLSL and [Strudel](https://codeberg.org/uzu/strudel). A Strudel deck follows the deck's clock, BPM and transport.
- `knob0` to `knob7` and MIDI control work in Strudel code, like in GLSL decks.
- Editor support for Strudel: completion and mini-notation highlighting.
- License: relicensed under AGPL-3.0-or-later, since Strudel and superdough are AGPL-3.0-or-later (see License below).

To run it locally, see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

This fork is licensed under [AGPL-3.0-or-later](LICENSE), since it depends on [Strudel](https://codeberg.org/uzu/strudel) and superdough (AGPL-3.0-or-later).

The code originally written for [0b5vr/wavenerd](https://github.com/0b5vr/wavenerd) is also available under the [MIT License](LICENSE-MIT).
