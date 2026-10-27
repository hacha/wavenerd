# Help

## What is Wavenerd

Wavenerd is an app that lets you write codes to generate sound in GLSL or [Strudel](https://strudel.cc/) and do live coding performance.

Wavenerd is a web app, so it runs in a modern web browser (Chrome is the one tested for the Strudel decks).
To run this version yourself, see [DEVELOPMENT.md](https://github.com/hacha/wavenerd/blob/dev/DEVELOPMENT.md).
This version is also published at https://hacha.github.io/wavenerd/ (see the README of this repository).

## How this fork differs from the original

This is a fork of [0b5vr/wavenerd](https://github.com/0b5vr/wavenerd) (hosted at https://0b5vr.github.io/wavenerd/), by 0b5vr, who made the original app and the GLSL decks.
Everything below is added by this fork. The GLSL decks, the mixer and the rest work as in the original.

- **Strudel decks**: each deck can run [Strudel](https://strudel.cc/) pattern code instead of a GLSL shader. See "Strudel decks".
- **Live FX**: hold SHIFT + a pad, or hold a pad on the screen, to roll, shift octaves, rise or stab a Strudel deck. See "Live FX".
- **Pioneer DDJ-FLX2 support**: the mixer is mapped when you plug it in, and its pads and jog turn the knobs of the decks. See "DDJ-FLX2".
- **Live coding with Claude Code**: when run with the dev server, Claude Code can write the code of the Strudel decks while you play. See "Live coding with Claude Code".
- **License**: this fork is AGPL-3.0-or-later, since Strudel and superdough are. The code originally written for 0b5vr/wavenerd is also available under the MIT License. See the [README](https://github.com/hacha/wavenerd#license).

## How to compile / apply

You can compile shaders at anytime by clicking the Compile button 🔨 on the bottom of the editor.

After you compiled the shader, you can cue the shader by clicking the Apply button ⏩️ on the bottom of the editor.
The cued shader will be applied when it reaches the next bar (= every 4 beats).
Strudel decks work the same way.

## How do I make a sound?

This would be the most simple example:

```glsl
vec2 mainAudio(vec4 time) {
  return 0.1 * vec2(sin(440.0 * 2.0 * 3.1415 * time.x));
}
```

which just generates the sine wave in 440Hz.

## How do I make a *serious* sound?

Mmmmmm... [Take a look at the original author's codes?](https://github.com/0b5vr/wavenerd-dubplates) (GLSL)

## Why is the input time vec4?

It gives you four different kind of times.
Every components represent times in the unit of second but each loops in (a beat, a bar, sixteen bars, infinity).
It's since the precision of time goes worse in longer live coding performances. Thank you floating point number very cool

## Why is the audio stuttery sometimes?

Maybe your processor is not catching up with audio generation.
You can change the latency from the setting screen (cog button ⚙️ at the top right corner).

## Strudel decks

Each deck is either a GLSL deck or a Strudel deck.
Click `GLSL | Strudel` in the status bar of the deck to switch. The mode and the code of each mode are kept separately.

A Strudel deck runs [Strudel](https://strudel.cc/) pattern code. Write it like on the Strudel REPL:

```js
s("bd*4, hh*8").lpf(knob0.range(200, 8000))
```

- The sounds are the same as on the Strudel REPL (synths, drum machines, soundfonts, samples; they are fetched from the internet). Samples and wavetables you added to Wavenerd can be played too: `s("kick")`, `s("wt_saw")`.
- Compile and apply work as above (`Ctrl-S`, `Ctrl-R`, `Shift-Ctrl-R`). A cued pattern starts on the next bar.
- The tempo follows the deck: 1 cycle = 1 bar (4 beats), at the BPM of the deck. Play, pause, rewind and BPM are shared with the GLSL side. `setcps` / `setcpm` do nothing, so use `.fast()` / `.slow()` instead.
- `Ctrl-P` opens the Strudel sketches you put in the asset list (drop files or use the folder icon, same as shaders).
- The editor completes the functions and the sound names, and highlights the elements being played.
- Visuals: inline `._pianoroll()`, `._punchcard()`, `._spiral()`, `._scope()`, `._spectrum()`, `._pitchwheel()`, and behind the code `.pianoroll()`, `.punchcard()`, `.spiral()`, `.scope()`, `.fscope()`, `.spectrum()`, `.pitchwheel()`. `.draw()` and `getDrawContext()` also work.
- Not supported: `.animate()`, `.onPaint()`, `slider()`, `.dough()`, and `setcps` / `setcpm`.

### Knobs and toggles in Strudel

`knob0` to `knob3` are patterns of 0 to 1 from the knobs of the deck, so MIDI works with them too:

```js
s("bd*4").lpf(knob0.range(200, 8000))
```

`tgl0` to `tgl3` are patterns of 0 (off) or 1 (on) from the toggles below the knobs. They start off.

```js
s("hh*8").mask(tgl1)                // plays only while the toggle is on
s("bd*4").mask(tgl0.range(1, 0))    // is cut while the toggle is on
```

In GLSL, the toggles are `param_knob4` to `param_knob7`. Knobs and toggles used in the code of the deck are colored in the Strudel editor, and unused toggles are dimmed.

A song can set where its knobs and toggles start with a line of its own:

```js
// @init knob0=0.3 tgl1=1
```

The values are set when a song loaded from the library, a dropped file or a memory first goes live, not when you apply it again. So once you play, the knobs stay where you put them.

## Live FX

On a Strudel deck, hold a Live FX to change what the pattern plays without touching the code. It lasts while you hold it.
Hold `SHIFT` and press a pad of the DDJ-FLX2, or press and hold the pad shown next to the knobs of the deck on the screen.

| Pad | Effect |
| --- | --- |
| 1 to 4 | Roll 1/16, 1/8, 1/4, 1/2: repeats the last bit of the pattern from when you pressed |
| 5 | Octave down |
| 6 | Octave up |
| 7 | Rise: goes up a semitone every sixteenth |
| 8 | Stab: short gate |

Presses snap to the sixteenth before them. Notes already sent to the audio engine (a fraction of a second ahead) are not changed.

## DDJ-FLX2

The Pioneer DDJ-FLX2 is mapped automatically the first time it is detected (your own mappings are kept). The rest of the MIDI controllers work through MIDI learn as before.

- Mixer: channel EQ, channel faders, CFX (the channel filter), cue buttons, crossfader and master volume. HEADPHONE CUE lights follow the cue state.
- SHIFT + CFX: changes the gain of the channel instead of the filter. When you let go, the filter waits until the knob comes back to its value.
- Pads 1 to 4 + jog: hold a pad and turn the jog to change `knob0` to `knob3` of the deck. The wheel side and SHIFT + platter are finer.
- Pads 5 to 8: toggle `tgl0` to `tgl3` (`knob4` to `knob7` in GLSL).
- SHIFT + pads 1 to 8: Live FX, see above.

## Keyboard shortcuts

All shortcuts in CodeMirror's [defaultKeymap](https://codemirror.net/docs/ref/#commands.defaultKeymap) are available. In addition, the following Wavenerd-specific shortcuts are available:

- `Ctrl-J`: Focus deck A
- `Ctrl-K`: Focus deck B
- `Ctrl-P`: Open the library (shaders on a GLSL deck, Strudel sketches on a Strudel deck)
- `Ctrl-S`: Compile the code
- `Ctrl-R`: Apply the code
- `Shift-Ctrl-R`: Apply the code immediately
- `Ctrl-,`: Jump to the previous bracket
- `Ctrl-.`: Jump to the next bracket
- `Shift-Ctrl-,`: Extend / shrink selection to the previous sibling bracket
- `Shift-Ctrl-.`: Extend / shrink selection to the next sibling bracket
- `Ctrl-[0-9]`: Load from memory patterns
- `Shift-Ctrl-[0-9]`: Save to memory patterns

## How to use params

Knobs can be used as interactive params.

```glsl
paramFetch(param_knob0)
```

## How to use samples

Samples can be loaded from audio files.
Any audio files which are supported by the [AudioContext.decodeAudioData](https://developer.mozilla.org/ja/docs/Web/API/BaseAudioContext/decodeAudioData) API can be loaded.

```glsl
sampleSinc(sample_****, sample_****_meta, sampleTime)
// or
sampleNearest(sample_****, sample_****_meta, sampleTime)
```

## How to use wavetables

Wavetables can be loaded from raw buffer files.
The raw buffer files must be encoded in float32, 2048 samples per cycle.

```glsl
wavetableSinc(wavetable_****, wavetable_****_meta, vec2(phase, frame))
// or
wavetableNearest(wavetable_****, wavetable_****_meta, vec2(phase, frame))
```

## How to use images

Images can be loaded from... images.

Simply `texture(image_****, uv)` to use.

## Live coding with Claude Code

When Wavenerd is run with the dev server (`pnpm dev`), Claude Code can write the code of the Strudel decks while you play. It does not work on the published site.

- Claude Code writes `live/A.strudel.js` / `live/B.strudel.js`. The code is put in the editor of the deck and cued. You apply it yourself (`Ctrl-R` or `Shift-Ctrl-R`). Code you cue by hand is written back to the file.
- `live/status.json` tells the state of the app, `live/sounds.txt` lists the sound names, and `live/levels.json` has the loudness of each deck.

Details are in [doc/strudel-integration.md](https://github.com/hacha/wavenerd/blob/dev/doc/strudel-integration.md) (in Japanese).
