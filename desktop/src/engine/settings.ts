// The `claudestrator.*` settings, which VS Code keeps for the extension: here a JSON file in the app's data folder.
// Their defaults are the extension's own (vscode/package.json, `contributes.configuration`), so the two never differ.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { validateSetting } from '../../../core/src/protocol';
import type { Settings } from '../../../core/src/vscode-shim';

const PREFIX = 'claudestrator.';

/** `{ 'claudestrator.notifications': 'all', … }` from an extension manifest; anything not shaped like one is skipped. */
export function defaultsFrom(manifest: unknown): Settings {
  const contributes = isRecord(manifest) ? manifest.contributes : undefined;
  const configuration = isRecord(contributes) ? contributes.configuration : undefined;
  const sections = Array.isArray(configuration) ? configuration : [configuration];
  const out: Settings = {};
  for (const section of sections) {
    const properties = isRecord(section) ? section.properties : undefined;
    if (!isRecord(properties)) continue;
    for (const [key, spec] of Object.entries(properties)) {
      if (key.startsWith(PREFIX) && isRecord(spec) && 'default' in spec) out[key] = spec.default;
    }
  }
  return out;
}

/**
 * Why a value cannot be stored under a key, or null: the key is one the extension declares, the value has its
 * default's shape, and the engine's own check (the one the dashboard's writes go through) passes.
 */
export function settingProblem(defaults: Settings, key: string, value: unknown): string | null {
  if (!Object.prototype.hasOwnProperty.call(defaults, key)) return `unknown setting ${key}`;
  const def = defaults[key];
  const sameShape = Array.isArray(def) ? Array.isArray(value) && value.every((v) => typeof v === 'string') : typeof value === typeof def;
  if (!sameShape) return `${key}: expected ${Array.isArray(def) ? 'a list of strings' : `a ${typeof def}`}`;
  const issues = validateSetting(key.slice(PREFIX.length), value);
  // The engine checks the settings the dashboard writes; the Atlassian and Bitbucket ones are plain strings.
  return issues.length && !issues[0]!.startsWith('unknown setting') ? issues.join('; ') : null;
}

export interface SettingsStore {
  /** Every setting: what was stored, else the default. */
  all(): Settings;
  /** Stores one; throws when it is not a setting or not of its shape. */
  set(key: string, value: unknown): Promise<void>;
}

/** Opens the file, keeping only what is still valid; a missing or broken file is an empty one. */
export async function openSettings({ file, defaults }: { file: string; defaults: Settings }): Promise<SettingsStore> {
  let stored: Settings = {};
  try {
    const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (isRecord(raw)) stored = Object.fromEntries(Object.entries(raw).filter(([k, v]) => settingProblem(defaults, k, v) === null));
  } catch {
    // first run, or a file someone broke: the defaults
  }
  // Writes go one after another, each with everything stored by then.
  let writing: Promise<void> = Promise.resolve();
  return {
    all: () => ({ ...defaults, ...stored }),
    async set(key, value) {
      const problem = settingProblem(defaults, key, value);
      if (problem) throw new Error(problem);
      stored = { ...stored, [key]: value };
      const snapshot = JSON.stringify(stored, null, 2);
      writing = writing.catch(() => undefined).then(() => writeAtomically(file, snapshot));
      await writing;
    },
  };
}

/** A crash mid-write leaves the old file, never half of the new one. */
async function writeAtomically(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, file);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
