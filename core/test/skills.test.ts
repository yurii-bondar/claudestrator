// The skills Claudestrator brings for Claude Code: added to a skills folder, seen there, updated and removed; and the
// library skill's examples and hand-overs, held to what Claudestrator itself accepts so they never drift apart.
import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { SKILLS, listSkills, addSkill, removeSkill, skillsDirOf } from '../src/skills';
import { validateLibraryLayer } from '../src/protocol';
import { BUILTIN } from '../src/config';

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

  const state = async () => (await listSkills({ userDir, projectDir })).map((k) => [k.name, k.user.state, k.project?.state]);
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
