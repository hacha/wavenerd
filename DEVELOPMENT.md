# Development

## Requirements

- Node.js 24.14.1 (see `.node-version`)
- [pnpm](https://pnpm.io/)

## Run locally

```sh
pnpm install
pnpm dev
```

Open the URL Vite prints (http://localhost:5173 by default).

## Other commands

- `pnpm build`: TypeScript check (`tsc -b`) and Vite production build
- `pnpm typecheck`: TypeScript check only
- `pnpm lint`: ESLint check
- `pnpm lint-fix`: ESLint with auto-fix
- `pnpm all`: lint, clean, and build
- `pnpm preview`: preview the production build locally

## Patched dependency

`patches/superdough@1.3.0.patch` is applied by pnpm through `patchedDependencies` in `pnpm-workspace.yaml`.

It makes superdough's bus modulation (`bmod`) use the audio controller captured at the start of each `superdough()` call, instead of the module-level current one. Without it, two Strudel decks mix up their buses.

Revisit the patch whenever superdough is upgraded.

## Syncing with upstream

- `origin` = `hacha/wavenerd`
- `upstream` = `0b5vr/wavenerd`

```sh
git fetch upstream && git merge upstream/dev
```

## Manual checks for Strudel decks

Not covered by automated tests.

- A pattern that throws at query time (e.g. `s("bd").fmap(v => v.foo.bar)`) shows its error in the status bar, and a good pattern restores sound.
- Pause stops sound at once, and resume doesn't double notes.
- Rewind doesn't overlap old notes.
- Folding inside `${...}` of a multi-line backtick string keeps mini-notation highlighting.
- With a deck playing a silent pattern, hide the tab for more than 40 seconds, then bring sound back while the tab is still hidden. There should be no "Buffer underrun" warnings in the console, and the first notes shouldn't stutter.
