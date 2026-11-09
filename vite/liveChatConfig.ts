import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The settings of the chats of the decks (`./liveChat.ts`), in `wavenerd-chat.json` at the root of the project.
 * Personal, so not in git; `wavenerd-chat.example.json` is the template. Read again for every message, so a change
 * applies without restarting the dev server. Every field is optional.
 */
export interface LiveChatConfig {
  /** `--model` of Claude Code, e.g. `sonnet`, `opus`. Default: the setting of Claude Code. */
  model?: string;

  /** `--effort` of Claude Code: `low`, `medium`, `high`, `xhigh` or `max`. Default: the setting of Claude Code. */
  effort?: string;

  /** Added to the system prompt. */
  systemPrompt?: string;

  /** Files whose text is added to the system prompt, after `systemPrompt`. Relative to the root of the project. */
  systemPromptFiles?: string[];

  /** The command of Claude Code. Default: `claude`. */
  command?: string;

  /** Let the agent run with an API key instead of the subscription. Default: `false`. */
  allowApiKey?: boolean;
}

export const CONFIG_FILE = 'wavenerd-chat.json';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

type LoadedOk = { ok: true; config: LiveChatConfig; extraPrompt: string };
type LoadedError = { ok: false; error: string };
export type LoadedConfig = LoadedOk | LoadedError;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Read `wavenerd-chat.json` and the files of its system prompt. No file: the defaults. */
export function loadLiveChatConfig(root: string): LoadedConfig {
  let text: string;
  try {
    text = readFileSync(resolve(root, CONFIG_FILE), 'utf8');
  } catch {
    return { ok: true, config: {}, extraPrompt: '' };
  }

  let config: LiveChatConfig;
  try {
    config = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `${CONFIG_FILE}: ${(error as Error).message}` };
  }

  const fail = (message: string): LoadedConfig => ({ ok: false, error: `${CONFIG_FILE}: ${message}` });
  if (config == null || typeof config !== 'object' || Array.isArray(config)) { return fail('must be an object'); }

  for (const key of ['model', 'effort', 'systemPrompt', 'command'] as const) {
    if (config[key] != null && typeof config[key] !== 'string') { return fail(`"${key}" must be a string`); }
  }
  if (config.effort != null && !EFFORTS.includes(config.effort)) {
    return fail(`"effort" must be one of ${EFFORTS.join(', ')}`);
  }
  if (config.systemPromptFiles != null && !isStringArray(config.systemPromptFiles)) {
    return fail('"systemPromptFiles" must be an array of paths');
  }
  if (config.allowApiKey != null && typeof config.allowApiKey !== 'boolean') {
    return fail('"allowApiKey" must be true or false');
  }

  const parts: string[] = [];
  if (config.systemPrompt?.trim()) {
    parts.push(config.systemPrompt.trim());
  }
  for (const path of config.systemPromptFiles ?? []) {
    try {
      parts.push(`# ${path}\n\n${readFileSync(resolve(root, path), 'utf8').trim()}`);
    } catch {
      return fail(`cannot read "${path}" of "systemPromptFiles"`);
    }
  }

  return { ok: true, config, extraPrompt: parts.join('\n\n') };
}
