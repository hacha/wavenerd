#!/usr/bin/env node
// Wait until the app compiles the current content of a file of `live/`, and tell the result.
// See `vite/liveBridge.ts`.
//
//   node scripts/live-wait.mjs a        # CLI: prints the result, exits with 1 on a compile error
//   node scripts/live-wait.mjs --hook   # Claude Code PostToolUse hook: reads the tool call from stdin

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const LIVE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../live');
const FILE_NAMES = { a: 'A.strudel.js', b: 'B.strudel.js' };
const TIMEOUT = 5000;

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; }
  return text;
}

/**
 * @returns {Promise<{ ok: boolean; message: string }>}
 */
async function waitForCompile(slot) {
  const name = `live/${FILE_NAMES[slot]}`;
  const hash = createHash('sha1').update(readFileSync(resolve(LIVE_DIR, FILE_NAMES[slot]), 'utf8')).digest('hex');
  const begin = Date.now();

  for (;;) {
    const status = readJSON(resolve(LIVE_DIR, 'status.json'));
    const deck = status?.decks?.[slot];

    if (status == null || !status.connected) {
      return { ok: true, message: `${name}: the app is not open. It cues the file when it starts.` };
    }

    if (deck?.lastCompile?.hash === hash) {
      if (!deck.lastCompile.ok) {
        return { ok: false, message: `${name}: compile error; nothing is cued and the deck keeps playing its code: ${deck.lastCompile.error}` };
      }

      const notes = [];
      if (deck.mode !== 'strudel') {
        notes.push(`deck ${slot.toUpperCase()} is in ${deck.mode} mode, so it is not heard until the deck is switched to Strudel`);
      }
      if (deck.fileState === 'applied') {
        return { ok: true, message: `${name}: compiled; it is already the code the deck plays${notes.map((note) => `; ${note}`).join('')}.` };
      }
      notes.unshift('the player applies it with Mod-R');
      return { ok: true, message: `${name}: compiled and cued (${notes.join('; ')}).` };
    }

    if (Date.now() - begin > TIMEOUT) {
      return { ok: true, message: `${name}: the app did not compile it within ${TIMEOUT / 1000} s. Read live/status.json later.` };
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

if (process.argv[2] === '--hook') {
  const input = JSON.parse(await readStdin());
  const filePath = input.tool_input?.file_path ?? '';
  const slot = Object.keys(FILE_NAMES).find((slot) => resolve(filePath) === resolve(LIVE_DIR, FILE_NAMES[slot]));
  if (slot == null) { process.exit(0); }

  const { ok, message } = await waitForCompile(slot);
  const output = ok
    ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }
    : { decision: 'block', reason: message };
  process.stdout.write(JSON.stringify(output));
} else {
  const slot = process.argv[2]?.toLowerCase();
  if (!(slot in FILE_NAMES)) {
    console.error('usage: node scripts/live-wait.mjs <a|b>');
    process.exit(2);
  }

  const { ok, message } = await waitForCompile(slot);
  console.log(message);
  process.exit(ok ? 0 : 1);
}
