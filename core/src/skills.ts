// Skills Claudestrator brings along for Claude Code: a folder with a SKILL.md, added to the account's skills
// (`<account>/skills/`, for every project) or to a project's `.claude/skills/`, where your own Claude Code sessions
// find them. Their text lives here, so every host ships it with the engine and an update brings its new version.
import * as fs from 'fs';
import * as path from 'path';
import { exists, writeAtomic } from './files';
import type { SkillPlace, SkillScope, SkillView } from './wire';

interface BundledSkill {
  /** Its folder's name, and the name in its SKILL.md. */
  name: string;
  label: string;
  /** What it is for, in a line, for the Settings page. */
  about: string;
  /** Its files, by their path in its folder. */
  files: Record<string, string>;
}

/** How to write a Claudestrator library: library.yaml's agents and scenarios, the outputs, the hand-over, a checklist. */
const LIBRARY_SKILL = `---
name: claudestrator-library
description: Writes and changes Claudestrator libraries, a folder with library.yaml (agents and scenarios) and prompts/, so a team's own agents and scenarios run in Claudestrator in every project. Use when asked to create or change a Claudestrator library, agent, scenario or library.yaml, or to turn a workflow into Claudestrator agents.
---

# Writing a Claudestrator library

A library is a folder Claudestrator loads agents and scenarios from:

~~~
my-library/
  library.yaml      # agents: and scenarios:, nothing else
  prompts/          # instruction files, their paths relative to library.yaml
    my-agent.md
  README.md         # what it is for and how to use it (optional)
~~~

It is listed under \`libraries:\` in \`~/.claudestrator/config.yaml\` (all of the user's projects) or in a project's \`.claudestrator/config.yaml\` (the team's; a folder inside the project by a relative path, so it works in every clone). In the dashboard: Scenarios → Add library… (an empty folder becomes a new library).

## Work in this order

1. Find out the workflow: its steps, which of them change code and which only read, where a person must decide, and what each step hands the next. Ask when that is unclear; do not invent steps.
2. Read what is there: the library's \`library.yaml\` and \`prompts/\` when it exists, and the project's \`.claudestrator/config.yaml\` for its repos and its own agents.
3. For each step, reuse a built-in agent, extend one, or write a new one (see below). Reuse beats a new agent.
4. Write \`library.yaml\`, then each prompt file.
5. Go through the checklist at the end. Then tell the user to add the library (Scenarios → Add library…) and to read what the Scenarios page warns about.

## library.yaml

Two keys only: \`agents\` and \`scenarios\`. Anything else (\`pipeline\`, \`repos\`, \`policy\`, \`limits\`…) is refused: those are a project's own.

### Agents

~~~yaml
agents:
  contract-reviewer:            # lowercase kebab-case, starting with a letter
    description: Reviews the API contracts the diff changes, read-only.   # one line; the dashboard shows it
    output: verdict             # its role: see Outputs
    extends: reviewer           # optional: starts from another agent, built in or of this library
    model: opus                 # opus | sonnet | haiku, or a full model id
    effort: high                # low | medium | high | xhigh | max
    tools: [Read, Grep, Glob, Bash]
    mcp: false                  # true: it sees the account's MCP servers (tickets, logs, metrics); false saves tokens
    color: red                  # red | blue | green | yellow | purple | orange | pink | cyan
    instructions: { mode: append, file: ./prompts/contract-reviewer.md }
~~~

More fields: \`runs: per-repo | all-repos\` (code and tests agents: once per repo of the plan, or once across all of them), \`maxTurns\` (a cap on each session's turns), \`enabled: false\`, \`disallowedTools\`.

\`instructions\` is a text (it replaces), or \`{ mode, file }\` or \`{ mode, text }\` with \`mode\` one of \`replace\` (the default), \`append\` or \`prepend\` to the instructions of the agent it extends. \`{{dir}}\` in instructions becomes the library's folder: point an agent at the library's own files with it (\`sqlite3 "$DB" < "{{dir}}/sql/schema.sql"\`), wherever the library is kept.

Tools: an agent without \`tools\` gets Read, Grep, Glob and Bash, plus Edit and Write when it writes code or tests. A tool the list does not name is refused when the agent calls it. WebFetch, WebSearch and MCP tools that change something must be named to be used (\`WebFetch(domain:docs.acme.com)\`, \`mcp__github__create_issue\`, the whole server as \`mcp__github\`). Reading through MCP servers (get, search, list, read) needs only \`mcp: true\`.

### Built-in agents

| agent | output | what it does |
|---|---|---|
| planner | plan | read-only; plans the task across the repos, with contracts and order |
| developer | code | one repository's part of the plan |
| tester | tests | the tests the task needs, across the repos the developers changed |
| reviewer | verdict | the combined diff: correctness, contracts, rules, tests, scope |
| appsec-reviewer | verdict | the combined diff, for security only (off until turned on) |
| verifier | readiness | whether a ticket is done, criterion by criterion |
| auditor | audit | bugs, bottlenecks, reliability and security issues in the repos |
| investigator | audit | one bug's root cause |

Extend one when the new agent does its job with more to say: \`extends: reviewer\` with \`instructions: { mode: append, file: … }\` keeps the reviewer's instructions and its hand-over, and adds yours.

### Outputs

The output decides what Claudestrator does with an agent, never its name:

- \`plan\`: read-only. The task waits for the user's approval. It names the repos the task changes.
- \`code\`: runs once per repo of the plan, in the plan's order, in that repo only; the repo's checks (gates) run after it and send it their failures.
- \`tests\`: runs once after the code steps, across the repos the plan names; then their checks.
- \`verdict\`: read-only review of the combined diff. A blocker or major finding sends the work back to the code and tests steps of the affected repos, for at most \`limits.reviewRounds\` rounds.
- \`readiness\`, \`audit\`: read-only reports; a scenario of them ends with the report, and nothing goes back to an agent.

A scenario of code or tests agents delivers: Claudestrator itself commits, pushes once the user confirms, and opens draft PRs. A scenario of readiness or audit agents only reports. Do not mix the two kinds in one scenario. Without a \`plan\` agent, a delivery works in the repos the task names (\`--repos api,web\` in its text), else in every configured repo.

### What an agent hands over

Code and tests agents hand over a status with their report; Claudestrator's prompt tells them how, so their instructions need not.

Plan, verdict, readiness and audit agents end with a json Claudestrator checks. An agent that \`extends\` a built-in one with \`append\` or \`prepend\` keeps its hand-over. One whose instructions \`replace\` must describe the json itself, at the end of its instructions, in exactly this shape (the prompt says how to hand it over):

- plan: \`{"type": "feat|fix|chore|refactor", "slug": "<kebab-case>", "title": "<short imperative English description, lowercase: the commit subject>", "repos": [{"name": "<repo>", "mode": "full|tests_only"}], "openQuestions": [{"question": "...", "default": "...", "blocking": false}]}\`. The plan's text has a section headed \`### <repo>\` for each repo of the json.
- verdict: \`{"status": "approved|changes_requested", "summary": "...", "findings": [{"severity": "blocker|major|minor", "repo": "...", "file": "...", "line": 1, "problem": "...", "fix": "..."}]}\`; status is changes_requested exactly when there is a blocker or major finding.
- readiness: \`{"summary": "...", "work": [{"repo": "...", "ref": "<branch, commit or PR url>"}], "criteria": [{"criterion": "...", "status": "met|partial|not_met|unverifiable", "evidence": "...", "files": ["<repo>/<path>:<line>"]}], "gaps": [{"severity": "critical|high|medium|low", "problem": "...", "fix": "..."}], "derivedCriteria": false}\`
- audit: \`{"summary": "...", "scope": ["<repo>"], "findings": [{"severity": "critical|high|medium|low", "category": "bug|performance|reliability|security|maintainability", "repo": "...", "file": "...", "line": 1, "title": "<one line>", "problem": "...", "impact": "...", "fix": "...", "effort": "S|M|L"}]}\`

### Scenarios

~~~yaml
scenarios:
  api-change:                   # lowercase kebab-case; not deliver or auto
    label: API change           # what the composer's menu shows (60 characters at most)
    description: Plans, builds and reviews a change to the public API, contracts first
    intake: { model: haiku, effort: low }   # optional: what reads a Jira or Linear ticket through MCP
    agents:
      - planner
      - approve: Check the contracts in the plan       # the task waits for the user after the step before it
      - loop:                   # runs again until the reviewers at its end approve
          rounds: 3             # optional; else limits.reviewRounds
          steps:
            - developer
            - { agent: tester, effort: medium }
            - parallel: [reviewer, contract-reviewer]  # read-only agents only, two or more, at once
      - branch:                 # on a result of a step before it
          on: contract-reviewer
          if: { severity: minor }    # or { verdict: approved | changes_requested }, { readiness: ready | not_ready | needs_check }, { audit: critical | high | medium | low }, { gates: pass | fail }
          then: [docs-writer, { approve: Read the docs change }]
          else: []
~~~

A step is an agent's name, or \`{ agent, model, effort, instructions }\`: the model and effort it runs with in this scenario, and what it does here after its own instructions (a text, or \`{ file: ./prompts/<scenario>/<agent>.md }\`). The blocks are \`parallel\` (read-only agents at once), \`loop\` (\`steps\` of agents or parallels), \`branch\` (\`on\`, \`if\`, \`then\`, \`else\`) and \`approve\` (\`true\`, or what the user should look at).

\`readiness\` and \`audit\` are the built-in report scenarios: under them goes a list of agent names. \`<id>: false\` takes a built-in scenario out of the menu.

## Writing the instructions

Claudestrator's prompt already tells every agent where the ticket, plan, reports and diffs are, which language to write in, that git is Claudestrator's, and how to hand over its json. Do not repeat that. Write what this agent alone must know:

- One job per agent. Its first lines say what it does and what it must not do ("You change no files" for a read-only one).
- What to read first: the repo's CLAUDE.md and \`.claude/rules\`, then the code it changes or judges. Name the library's own files with \`{{dir}}\`.
- What done means, in steps, and when to stop and report itself blocked instead of working around a problem.
- For a reviewer or auditor: what to check, in order; the severities with what each means; that every finding is verified in the code and quoted as file:line.
- What its report says, for the person who reads it.

Never tell an agent to commit, push, switch branches, open PRs or post comments: Claudestrator does that, and its guard refuses an agent that tries. An agent writes only in the repo of its step; a read-only one writes nothing; none may change \`.git\`, \`.claude/\`, \`.mcp.json\`, \`.vscode/\` or Claudestrator's config, libraries and task files.

## Checklist

- \`library.yaml\` holds only \`agents\` and \`scenarios\`; it parses as YAML.
- Every name is lowercase kebab-case; every agent a scenario names is a built-in one, defined in this library, or in the project.
- Every agent has a \`description\`, an \`output\`, and instructions whose \`file\` exists, relative to \`library.yaml\`.
- A plan, verdict, readiness or audit agent that replaces its instructions describes its json, as above.
- A \`parallel\` holds only read-only agents (verdict, readiness, audit), two or more; a \`branch\` is \`on\` a step before it.
- A scenario either delivers (code or tests agents) or reports (readiness or audit agents), not both.
- \`mcp: true\` only where an agent reads tickets, logs or docs through MCP; \`tools\` name only what it needs.
- The README says what the library is for, its scenarios, and how to add it.
`;

const SKILLS: readonly BundledSkill[] = [
  {
    name: 'claudestrator-library',
    label: 'Writing Claudestrator libraries',
    about: 'Claude Code writes library.yaml and its prompts for you: agents, scenarios with loops, branches and approvals, and what each output hands over. Ask it, e.g., "make a Claudestrator library for our release checklist".',
    files: { 'SKILL.md': LIBRARY_SKILL },
  },
];

const skillOf = (name: string): BundledSkill => {
  const skill = SKILLS.find((s) => s.name === name);
  if (!skill) throw new Error(`Claudestrator has no skill named ${name}`);
  return skill;
};

/** Whether a skill is in a skills folder: not there, as this version has it, or different (an older one, or edited). */
async function placeOf(skill: BundledSkill, skillsDir: string): Promise<SkillPlace> {
  const dir = path.join(skillsDir, skill.name);
  if (!(await exists(path.join(dir, 'SKILL.md')))) return { dir, state: 'absent' };
  for (const [file, text] of Object.entries(skill.files)) {
    const now = await fs.promises.readFile(path.join(dir, file), 'utf8').catch(() => null);
    if (now !== text) return { dir, state: 'differs' };
  }
  return { dir, state: 'current' };
}

/** Every skill Claudestrator brings, and where it is: the account's skills folder, and the project's when there is one. */
async function listSkills({ userDir, projectDir }: { userDir: string; projectDir: string | null }): Promise<SkillView[]> {
  return Promise.all(
    SKILLS.map(async (s) => ({ name: s.name, label: s.label, about: s.about, user: await placeOf(s, userDir), project: projectDir ? await placeOf(s, projectDir) : null }))
  );
}

/** Writes the skill's files into the skills folder, over what an older version (or an edit) left there. */
async function addSkill({ name, skillsDir }: { name: string; skillsDir: string }): Promise<void> {
  const skill = skillOf(name);
  for (const [file, text] of Object.entries(skill.files)) {
    const target = path.join(skillsDir, skill.name, file);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await writeAtomic(target, text);
  }
}

/** Takes the skill's folder out of the skills folder. */
async function removeSkill({ name, skillsDir }: { name: string; skillsDir: string }): Promise<void> {
  await fs.promises.rm(path.join(skillsDir, skillOf(name).name), { recursive: true, force: true });
}

/** The skills folder of a scope: the account's (`<config dir>/skills`), or the project's `.claude/skills`. */
function skillsDirOf(scope: SkillScope, { accountDir, workspace }: { accountDir: string; workspace: string | null }): string {
  if (scope === 'user') return path.join(accountDir, 'skills');
  if (!workspace) throw new Error('Open a folder to add a skill to its project');
  return path.join(workspace, '.claude', 'skills');
}

export type { BundledSkill };
export { SKILLS, listSkills, addSkill, removeSkill, skillsDirOf };
