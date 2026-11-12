// The skills Claudestrator brings for Claude Code: added to a skills folder, seen there, updated and removed; and the
// library skill's examples and hand-overs, held to what Claudestrator itself accepts so they never drift apart.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { SKILLS, listSkills, addSkill, removeSkill, skillsDirOf } from '../src/skills';
import { validateConfigLayer, validateLibraryLayer } from '../src/protocol';
import { BUILTIN } from '../src/config';
import { CHECKPOINT_TITLE } from '../src/describe';
import { transcriptKey } from '../src/engine';

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const library = SKILLS.find((s) => s.name === 'claudestrator-library')!;
const text = library.files['SKILL.md']!;

test('skills: added to the account or the project, seen as added, another version when it differs, removed', async () => {
  const userDir = path.join(tmp('cs-skills-user-'), 'skills');
  const workspace = tmp('cs-skills-ws-');
  const projectDir = skillsDirOf('project', { accountDir: '/unused', workspace });
  assert.equal(projectDir, path.join(workspace, '.claude', 'skills'));
  assert.equal(skillsDirOf('user', { accountDir: '/Users/me/.claude-work', workspace: null }), '/Users/me/.claude-work/skills', "the account's own folder");
  assert.throws(() => skillsDirOf('project', { accountDir: '/x', workspace: null }), /Open a folder/);

  const state = async () => (await listSkills({ userDir, projectDir })).filter((k) => k.name === 'claudestrator-library').map((k) => [k.name, k.user.state, k.project?.state]);
  assert.deepEqual(await state(), [['claudestrator-library', 'absent', 'absent']]);

  await addSkill({ name: 'claudestrator-library', skillsDir: userDir });
  assert.deepEqual(await state(), [['claudestrator-library', 'current', 'absent']]);
  assert.equal(fs.readFileSync(path.join(userDir, 'claudestrator-library', 'SKILL.md'), 'utf8'), text);

  fs.appendFileSync(path.join(userDir, 'claudestrator-library', 'SKILL.md'), '\nmy own note\n');
  assert.deepEqual(await state(), [['claudestrator-library', 'differs', 'absent']], 'an older version, or one changed by hand');
  await addSkill({ name: 'claudestrator-library', skillsDir: userDir });
  assert.deepEqual(await state(), [['claudestrator-library', 'current', 'absent']], 'Update writes this version over it');

  await addSkill({ name: 'claudestrator-library', skillsDir: projectDir });
  await removeSkill({ name: 'claudestrator-library', skillsDir: userDir });
  assert.deepEqual(await state(), [['claudestrator-library', 'absent', 'current']]);
  assert.equal((await listSkills({ userDir, projectDir: null }))[0]!.project, null, 'no project without a workspace');

  await assert.rejects(addSkill({ name: 'nope', skillsDir: userDir }), /no skill named nope/);
});

test('skills: each SKILL.md names its folder and says when Claude Code should use it', () => {
  for (const s of SKILLS) {
    const m = s.files['SKILL.md']!.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(m, `${s.name}: front matter`);
    const meta = YAML.parse(m[1]!) as { name: string; description: string };
    assert.equal(meta.name, s.name);
    assert.match(meta.description, /Use when/);
    assert.ok(meta.description.length <= 1024, 'Claude Code reads a short description');
  }
});

/** The YAML examples of a skill's SKILL.md, parsed. */
const yamlOf = (md: string) => [...md.matchAll(/~~~yaml\n([\s\S]*?)~~~/g)].map((m) => YAML.parse(m[1]!) as Record<string, unknown>);

test('skills: Claudestrator brings the library, workspace map and config skills', () => {
  assert.deepEqual(SKILLS.map((s) => s.name), ['claudestrator-library', 'claudestrator-workspace-map', 'claudestrator-config', 'claudestrator-task']);
});

test("skills: every skill's YAML examples are config Claudestrator accepts", () => {
  for (const s of SKILLS) {
    const blocks = yamlOf(s.files['SKILL.md']!);
    if (s.name !== 'claudestrator-task') assert.ok(blocks.length, `${s.name} has examples`);
    for (const [i, block] of blocks.entries()) assert.deepEqual(validateConfigLayer(block), [], `${s.name}, example ${i + 1}`);
  }
});

test("skills: the config skill's example covers what config.yaml takes, and the map skill wires the map up as the dashboard does", () => {
  const config = Object.assign({}, ...yamlOf(SKILLS.find((s) => s.name === 'claudestrator-config')!.files['SKILL.md']!)) as Record<string, unknown>;
  for (const key of ['repos', 'baseBranch', 'language', 'git', 'limits', 'context', 'jira', 'intake', 'groups', 'instructions', 'policy']) assert.ok(key in config, key);
  const gates = (config.repos as Record<string, { gates?: { name: string; when?: string; dir?: string; timeout?: number }[] }>).api!.gates!;
  assert.ok(gates.some((g) => g.when) && gates.some((g) => g.dir) && gates.some((g) => g.timeout), 'when, dir and timeout shown');
  const map = yamlOf(SKILLS.find((s) => s.name === 'claudestrator-workspace-map')!.files['SKILL.md']!);
  assert.deepEqual(map, [{ context: ['./workspace.md'] }], 'as Create workspace map lists it');
});

test("skills: the library skill's examples are a library Claudestrator accepts", () => {
  const blocks = [...text.matchAll(/~~~yaml\n([\s\S]*?)~~~/g)].map((m) => YAML.parse(m[1]!) as Record<string, unknown>);
  assert.equal(blocks.length, 2, 'the agents and the scenarios');
  const layer = Object.assign({}, ...blocks) as Record<string, unknown>;
  assert.deepEqual(Object.keys(layer).sort(), ['agents', 'scenarios']);
  assert.deepEqual(validateLibraryLayer(layer), []);
  assert.match(validateLibraryLayer({ ...layer, pipeline: ['planner'] }).join(), /only agents and scenarios/, 'as the skill says');
});

test("skills: the library skill lists the built-in agents with their outputs, and their hand-overs as they are", () => {
  const agents = BUILTIN.agents as Record<string, { output?: string; instructions?: unknown }>;
  for (const [name, a] of Object.entries(agents)) assert.ok(text.includes(`| ${name} | ${a.output} |`), `${name} (${a.output}) in the table`);
  // The verdict, readiness and audit shapes are the built-in agents' own, word for word.
  const shape = (label: string) => text.match(new RegExp(`^- ${label}: \`(\\{.*?\\})\``, 'm'))?.[1];
  const own = (name: string) => String(typeof agents[name]!.instructions === 'string' ? agents[name]!.instructions : JSON.stringify(agents[name]!.instructions));
  for (const [label, agent] of [['verdict', 'reviewer'], ['readiness', 'verifier'], ['audit', 'auditor']] as const) {
    const json = shape(label);
    assert.ok(json, `${label} shape in the skill`);
    assert.ok(own(agent).includes(json), `${label}: as ${agent} hands it over`);
  }
  assert.ok(shape('plan'), 'the plan shape too');
});

test('skills: the task skill knows every checkpoint a task can wait at, and names transcripts as Claudestrator does', () => {
  const md = SKILLS.find((s) => s.name === 'claudestrator-task')!.files['SKILL.md']!;
  for (const id of Object.keys(CHECKPOINT_TITLE)) assert.match(md, new RegExp(`^\\| ${id} \\|`, 'm'), id);
  assert.ok(md.includes(`\`${transcriptKey(7, { agent: 'developer', repo: 'api' })}.ndjson\``), 'the example key');
  assert.match(md, /never change it/, 'it reads the task, and leaves its files alone');
});
