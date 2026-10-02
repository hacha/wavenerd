---
name: strudel-live
description: Write Strudel code for the decks of the running wavenerd app while the user plays (live coding with Claude Code). Use when the user asks to play, jam, perform, or write/change a pattern, beat, bassline, drop, or the next part on deck A or B, or mentions `live/A.strudel.js` / `live/B.strudel.js`.
---

# Strudel live coding with wavenerd

The dev server (`pnpm dev`) bridges files and decks (`vite/liveBridge.ts`, design in `doc/strudel-integration.md`, section 「Claude Code から書く（live/）」):

| File | Meaning |
| --- | --- |
| `live/A.strudel.js`, `live/B.strudel.js` | The code of Strudel deck A / B. Writing a file puts it into the deck's editor and **cues** it. The user applies it with Mod-R (next bar) or Shift-Mod-R. Code the user cues by hand (Mod-S) is written back here. |
| `live/status.json` | State of the app. Read it before writing. |
| `live/sounds.txt` | Every sound name the code can play. |

## Before writing

1. Read `live/status.json`.
   - `connected: false`, or no process with `serverPid` (the dev server was killed): the app is not running. The file is cued when it starts. Tell the user.
   - `transport.xfader`: 0 = deck A on air, 1 = deck B on air. Unless the user names a deck, write to the deck that is **not** on air, so they can bring it in with the crossfader.
   - `decks.<a|b>.mode`: only `strudel` decks play the file. A `glsl` deck must be switched (status bar toggle) to be heard; say so.
   - `decks.<a|b>.fileState`: `applied` (playing), `cued` (waiting for Mod-R), `error`, `not compiled`.
2. Read the deck file. The user may have changed it by hand since you last saw it.

## Writing

- Use the Edit or Write tool on the deck file. A PostToolUse hook waits for the app to compile and reports the result: a compile error blocks with the message (fix it right away; the line numbers are those of the file), success says it is cued. If you changed the file any other way, run `node scripts/live-wait.mjs a` (or `b`).
- Never apply the code yourself or tell the user how to press keys every time. Say briefly what you changed and that it is cued.
- Prefer small edits to the playing code over rewrites. The user is performing; keep changes musical and incremental unless they ask for something new.
- One deck file is one Strudel program (like one strudel.cc REPL). Use `stack(...)` or several `$:` lines for layers.

## Conventions of wavenerd (differ from strudel.cc)

- **Tempo**: 1 cycle = 1 bar (4 beats) at the BPM of the app (`transport.bpm`). `setcps` / `setcpm` do nothing and `.cpm()` may be off. Use `.fast()` / `.slow()` / mini-notation for speed.
- **Sounds**: check names with `grep` in `live/sounds.txt` before using them; an unknown name is silent and only logged. Lines are `name<TAB>type<TAB>variants`, lowercase (names are case-insensitive). `rolandtr909_bd` is played as `s("bd").bank("RolandTR909")`; `n` picks a variant (0 .. variants-1). Samples and wavetables the user imported into the app also appear there (wavetables as `wt_<name>`, type `wavetable`: play them with a note and move through the frames with `.wt(0..1)`).
- **Knobs**: `knob0` .. `knob7` are patterns of 0..1 from the deck's knobs and MIDI, e.g. `.lpf(knob0.range(200, 8000))`. Use them for parameters the user will want to ride. `slider()` is not supported.
- **Visuals**: inline `._pianoroll()`, `._punchcard()`, `._spiral()`, `._scope()`, `._spectrum()`, `._pitchwheel()`; behind the code `.pianoroll()`, `.punchcard()`, `.spiral()`, `.scope()`, `.fscope()`, `.spectrum()`, `.pitchwheel()`, and `.draw(fn, { lookbehind, lookahead })` with `getDrawContext()`. `.animate()` and `.onPaint()` are not supported.
