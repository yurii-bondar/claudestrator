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

/** How to write the workspace map every agent reads first: the repos, the contracts between them, the merge order. */
const WORKSPACE_MAP_SKILL = `---
name: claudestrator-workspace-map
description: Writes or refreshes a Claudestrator workspace map (.claudestrator/workspace.md), the file every Claudestrator agent reads first, with the repositories, the contracts between them, and the order changes merge in. Use when asked to write, fill in, update or check a Claudestrator workspace map, or when Claudestrator's plans miss a repository or get the order of a cross-repo change wrong.
---

# Writing a Claudestrator workspace map

The workspace map is a Markdown file a project's \`.claudestrator/config.yaml\` lists under \`context:\`. Claudestrator hands every agent of every task its path before the ticket: the planner picks the repos from it, lists the contracts a change crosses and orders the repos by it; developers, testers and reviewers check a cross-repo change against it. It is read in every step of every task, so each line costs many times over: short, and nothing but facts.

## Work in this order

1. Read \`.claudestrator/config.yaml\`: the names under \`repos:\` (use exactly these), their \`path\` (from the workspace folder; the name when there is none) and \`role\`. Read the map when there is one, and keep what is still true.
2. For each repository read its README, CLAUDE.md, manifest (package.json, go.mod, pyproject.toml…) and entry points: what it is, who uses it, its stack in a few words.
3. Find the contracts in the code, not in the docs alone: HTTP and gRPC APIs (routes, OpenAPI or proto files, generated clients), events and queues (topics, message schemas), shared packages and types, a database two repos use, config or feature flags another repo reads, files one repo generates for another. For each: the producer, the consumers, where it is defined (a path), and how it may change. Confirm each from both sides: search the consumer for the route, topic or package.
4. Work out the order changes merge and deploy in: a producer before its consumers, a migration before the code that needs it, a shared package published before its users take it. Note what must stay backward compatible while they roll out.
5. Write the map in the shape below, and make sure \`context:\` lists it.
6. Tell the user what you could not confirm. In the map, mark a guess as one; never write it as a fact.

## The shape

~~~markdown
# Workspace map

## Repositories
- **api** (\`services/api\`): public REST API of the web and mobile apps · NestJS, Postgres
- **web** (\`apps/web\`): the customers' web app · Nuxt 3
- **billing** (\`services/billing\`): invoices and payments · Go

## Contracts
- **REST /v2/orders**: api produces it (\`src/orders/orders.controller.ts\`, OpenAPI in \`openapi/orders.yaml\`); web consumes it (\`composables/useOrders.ts\`). Fields are only added; removing one needs /v3.
- **Event \`order.paid\`**: api publishes it (\`src/events/order-paid.ts\`); billing handles it (\`internal/handlers/order_paid.go\`). Its schema is in api's \`events/schemas/order-paid.json\`.

## Merge order
1. api (its migrations run on deploy; old fields stay until web stops reading them)
2. billing, web

## Notes for agents
- What a planner gets wrong without being told, one line each: "prices travel in cents; only web formats them".
~~~

- Repository names exactly as \`repos:\` has them: a plan names repos by them.
- Paths from each repository's root, so an agent can open them.
- What crosses repositories only. Each repository's own CLAUDE.md and rules reach the agents working there; do not copy them.
- Under about 150 lines. A long map is read in every step and buries what matters.
- No secrets, no URLs with credentials, no hosts the agents do not need.

## Wiring it up

~~~yaml
# .claudestrator/config.yaml
context: [./workspace.md]     # paths from .claudestrator/; every agent reads them first, in this order
~~~

In the dashboard, Repos & checks → What every agent reads first → Create workspace map writes a skeleton and lists it; this skill fills it in. Refresh the map when a contract or the merge order changes: a stale one misleads every plan.

## Checklist

- Every repository under \`repos:\` is in the map, by its name, and nothing else is.
- Every contract names its producer, its consumers and the path it is defined at, confirmed on both sides.
- The merge order puts producers before consumers, and says what stays backward compatible meanwhile.
- Guesses are marked as guesses; the user was told what you could not confirm.
- \`context:\` in \`.claudestrator/config.yaml\` lists the map.
`;

/** How to set up config.yaml: repositories, checks an agent can read, the sandbox settings checks need, the rest. */
const CONFIG_SKILL = `---
name: claudestrator-config
description: Sets up and tunes a project's Claudestrator config (.claudestrator/config.yaml), with its repositories, the checks (gates) that run after agents change them, the sandbox settings checks need, limits, groups and instructions. Use when asked to set up Claudestrator for a project, to add or fix its checks or gates, or when a check fails in Claudestrator but passes in a terminal.
---

# Claudestrator's config and checks

Config comes in layers, each overriding the one before field by field: built-in defaults → libraries → \`~/.claudestrator/config.yaml\` (the user's, every project) → \`<workspace>/.claudestrator/config.yaml\` (the project's, committed for the team). Change the project's file unless the user wants a change for all of their projects. The dashboard edits the same file in place and reloads it when you save; it shows what it refuses as errors and what loosens the safety policy as warnings.

## Work in this order

1. Read the project's config, and the user's, before changing anything. Keep their comments, order and style; change only what was asked.
2. For checks, read each repository's scripts (package.json, Makefile, Taskfile, pyproject.toml…) and its CI (\`.github/workflows\`, \`.gitlab-ci.yml\`): CI says what the team already checks, and how.
3. Write the change, then go through the checklist at the end. Tell the user to press Run checks on Repos & checks: the checks run at once, in the sandbox, as they do after an agent.

## Repositories

~~~yaml
repos:
  api:                          # the name plans use: letters, digits, ".", "_" and "-"
    path: services/api          # from the workspace folder; the name when left out
    role: Public REST API of the web and mobile apps (NestJS, Postgres)   # one line, shown to agents beside the name
    baseBranch: develop         # optional: else the top-level baseBranch
    gates:
      - { name: lint, cmd: npm run lint --silent }
      - { name: types, cmd: npx tsc --noEmit }
      - { name: test, cmd: npx vitest run --reporter=dot, when: src/ }
      - { name: e2e, cmd: npm run e2e --silent, dir: packages/web, timeout: 2400 }
  web:
    path: apps/web
    forge: gitlab               # only when origin's host does not say github, gitlab or bitbucket.org
~~~

## Checks (gates)

They run after every code or tests step, in the repositories it changed, one after another; a repository with no changes is skipped. A red check sends its output back to the same agent, up to \`limits.gateAttempts\` times; then the user decides.

- \`name\`: one per check in the repository. Its log file is named after it, so two names that differ only in case or punctuation collide.
- \`cmd\`: a shell command, run from the repository's root (or \`dir\`); exit code 0 is green.
- \`dir\`: a folder of the repository, from its root (\`packages/web\`); never absolute, \`~\` or \`..\`.
- \`when\`: a folder or file from the repository's root (\`src/\`, \`package.json\`), no patterns: the check runs only when the change touches it.
- \`timeout\`: seconds, 15 minutes when left out. A check that runs out of time goes to the user at once.

Write each check for the agent that reads its failure:

- The agent gets only the last 40 lines of a red check, about 6 KB in all, each long line cut. Make the failure the last thing it prints: quiet flags (\`--silent\`, \`-q\`), a \`dot\` reporter, no progress bars. The user's log keeps all of it.
- Claudestrator sets \`CI=true\`, \`NO_COLOR=1\` and \`FORCE_COLOR=0\`, so test runners that watch by default run once.
- Fast and deterministic: lint, typecheck, unit tests. Put a slow suite behind \`when\`, or leave it to CI.
- The repository's own tools, through its own scripts; a check installs nothing.
- Nothing that changes the repository: a formatter in its check mode (\`prettier --check\`, \`gofmt -l\`), never \`--write\`; no codegen into tracked files; no install that rewrites the lockfile.

## The sandbox

Checks run code the agents wrote, so they run in the agents' sandbox: writes only in the repository (never its \`.git\`) and in temp files; none of the user's credentials, credential files or credential-like variables; network only to the package registries, GitHub's download hosts and \`policy.network\`; no Docker. A check that passes in a terminal and fails in Claudestrator usually meets the sandbox, and the fix is a setting, never a change to the code:

| What the check does | What it needs |
|---|---|
| writes a cache outside the repository (EPERM, read-only file system) | \`policy.writable: [~/.cache/go-build]\` |
| reaches a host other than the registries (CONNECT tunnel failed, response 403) | \`policy.network: [npm.acme.corp]\` |
| opens a local port, or reaches a service on 127.0.0.1 (listen EPERM on macOS) | \`policy.localPorts: true\` |
| needs a variable that looks like a credential (a database URL with a password) | \`policy.checkEnv: [DATABASE_URL]\`, the variable exported in the login shell (\`~/.zprofile\`), and the editor restarted; a \`.env\` file is not read |
| starts containers (Testcontainers, docker compose) | no setting: the user starts the services outside the sandbox on 127.0.0.1, then \`localPorts\` and \`checkEnv\` as above |

\`policy.sandbox: false\` turns the sandbox off for agents, checks and git hooks: the last resort, and a warning for everyone who opens the project. Prefer the narrow setting.

## The rest of the config

~~~yaml
baseBranch: main
language: English               # of plans, reviews, questions and PR texts
git: { mode: worktree }         # branch: tasks switch your clean checkouts, one at a time; worktree: a copy per task, tasks at once
limits: { reviewRounds: 2, gateAttempts: 3, budgetUsd: 25, parallelTasks: 2 }   # budgetUsd 0: no limit
context: [./workspace.md]       # files every agent reads first, from .claudestrator/ (the claudestrator-workspace-map skill writes it)
jira: { allowedProjects: [PROJ] }
intake: { model: haiku, effort: low }   # what reads a Jira or Linear ticket through MCP
groups:                         # what a task can belong to, picked in the composer
  checkout-revamp:
    type: epic                  # epic | story | group
    label: Checkout revamp
    jira: PROJ-123
    instructions: Refund endpoints live under /v2/refunds.   # every task in it follows them
    baseBranch: feat/checkout   # its tasks start from it, and their PRs go into it
instructions:                   # ticked per task in the composer; every agent of the task follows them
  no-new-deps:
    label: No new dependencies
    text: Do not add packages; use what the repository already has.
policy:
  protectedBranches: [main, master]
  draftPrsOnly: true
  forbidAiAttribution: true
~~~

Agents, the delivery \`pipeline\` and scenarios take the shape the claudestrator-library skill describes; a project's config takes them too.

Never put a secret in a config: the project's is committed. Never loosen the policy (the sandbox, \`network\`, \`writable\`, \`localPorts\`, \`checkEnv\`, \`protectedBranches\`, \`draftPrsOnly\`) without telling the user what it opens.

## Checklist

- The YAML parses; every repository name is letters, digits, \`.\`, \`_\` and \`-\`, and each \`path\` exists.
- Every check has a unique \`name\` and a \`cmd\` the repository's own scripts run; it passes on the base branch as it is.
- \`dir\` and \`when\` are paths from the repository's root, without \`..\` or patterns; \`timeout\` is in seconds.
- Each check prints its failure last, without colour or progress.
- Every policy setting you added is the narrowest that works, and the user knows why it is there.
`;

/** How to find out what happened to a task from its files in .orch/tasks, and what to do about it. */
const TASK_SKILL = `---
name: claudestrator-task
description: Finds out why a Claudestrator task failed, stopped, got blocked or did something unexpected, from its files in .orch/tasks (the event log, the agents' transcripts and reports, the checks' logs), and says what to change and what to press in the dashboard. Use when asked why a Claudestrator task is stuck, red, blocked, failed, expensive or wrong, or to look into a task by its id.
---

# Looking into a Claudestrator task

Everything a task did is on disk, in the workspace folder Claudestrator works in (Settings → Workspace): \`.orch/tasks/<task id>/\`. Read it; never change it. The event log is the task's source of truth, and the dashboard rebuilds the task from it: an edit there breaks the task. What to do about a problem is done in the dashboard, in the config, in the instructions, or in the code, never in \`.orch/\`.

## Where things are

~~~
.orch/tasks/<id>/
  events.ndjson               # one JSON event per line, in order: the source of truth
  ticket.md, ticket.json      # the ticket as the agents read it
  plan/<agent>.md             # the plan, with its json at the end
  reports/r<round>/<agent>-<repo>.md   # what a code or tests step reported, per round
  reviews/r<round>/<agent>.md # the reviews of a round
  reviews/r<round>/diff.patch # the diff those reviewers read
  readiness/<agent>.md, audit/<agent>.md   # a report scenario's reports
  report.md                   # the task's own report, when it has one
  gates/r<round>/<repo>.<check>.log        # each check's whole output
  transcripts/<seq>-<agent>[-<repo>].ndjson   # each step's session: prompt, text, tool calls and results
  run.lease                   # the window that runs it now
.orch/worktrees/<id>/<repo>   # in worktree mode, where the task's code is
~~~

The events that tell the story:

- \`task_created\`: the input, the source, the scenario, the pipeline (\`pipeline.stages\`), the context files, the git mode, the limits.
- \`intake_completed\`: the ticket as read (\`spec\`); a task without a planner gets its repos here.
- \`stage_started\` / \`stage_completed\` / \`stage_failed\`: each step, by \`agent\` and \`repo\`. \`stage_completed.artifact\` is its report's path; it carries the step's \`plan\`, \`verdict\`, \`readiness\` or \`audit\`, and \`gates\` (\`pass\`, \`fail\` or \`none\`). \`stage_failed.error\` says why, with \`blocked: true\` when the agent said it cannot go on.
- \`gates_ran\`: a step's checks, with \`status\`, \`attempt\` and \`summary\`.
- \`checkpoint_answered\`: the user's answer at a checkpoint, with the \`option\` and any \`feedback\`.
- \`agent_stopped\`, \`agent_progress\`: a session's \`sessionId\`, \`costUsd\`, \`turns\`, \`model\`, \`effort\`, \`configDir\`.
- \`committed\`, \`commit_failed\` (with the hook's \`output\`), \`pr_opened\`, \`published\`, \`review_posted\`, \`jira_comment\`.
- \`stopped\` (with its \`reason\`), \`resumed\`, \`pipeline_changed\`, \`note\`.
- \`transition_rejected\`: Claudestrator refused an event as not fitting the task's state; worth reporting as a bug with the task's id.

A transcript's key is the \`seq\` of its step's \`stage_started\`, four digits, then the agent and the repo: \`0007-developer-api.ndjson\`. Its lines are \`prompt\`, \`text\`, \`thinking\`, \`tool_use\`, \`tool_result\`, \`user\` (what the user sent the agent), \`gates\`, \`blocked\` and \`turn_end\` items.

Logs and transcripts can be megabytes. Search them; do not read them whole: \`grep -n '"type":"stage_' events.ndjson\`, \`tail -n 60\` of a check's log, \`grep -n '"type":"tool_result"' … | tail\`.

## Where a task waits for the user

| checkpoint | what happened | where to look |
|---|---|---|
| approve-plan | the planner wrote a plan | \`plan/<agent>.md\` |
| approve-step | a scenario's \`approve:\` step | the report of the step before it |
| gate-failure | checks stayed red after the agent's attempts (\`limits.gateAttempts\`) | \`gates/r<round>/<repo>.<check>.log\`, the \`gates_ran\` events, the step's transcript |
| agent-failure | an agent failed, or said it is blocked | \`stage_failed.error\`, its report and the end of its transcript |
| review-limit | the review rounds are used up (\`limits.reviewRounds\`) with blocking findings left | the last round's \`reviews/\` |
| protected-changes | an agent changed \`.claude/\`, \`.mcp.json\` or \`.vscode/\`, which no agent may write | \`stage_completed.protectedChanges\` |
| hook-failure | the commit failed, mostly its git hook | \`commit_failed.output\` |
| confirm-push | the work is committed and waits to be pushed | \`reviews/\`, the PR texts |
| post-review | a PR review waits to be posted | \`reviews/\` |

## Common causes

- A check fails in Claudestrator but passes in a terminal: the sandbox. Its log ends with what it refused (EPERM, a read-only file system, \`CONNECT tunnel failed, response 403\`, \`listen EPERM\`, no Docker). The fix is a setting (\`policy.writable\`, \`network\`, \`localPorts\`, \`checkEnv\`), never a change to the code; the claudestrator-config skill has the table.
- A check fails at once and no attempt helps: it timed out, or its \`dir\` is not there. Fix the check in the config.
- An agent is blocked: the plan does not hold, the branch lacks code the plan assumes, or a test found a bug in code the tester may not change. Its reason is in \`stage_failed.error\` and its report. The user answers with feedback (Retry), changes the plan, or fixes the cause.
- The same failure again after a Retry: nothing changed between the attempts. Something must change first: a setting, the branch, the instructions, or the feedback.
- The task stopped by itself: a budget (\`limits.budgetUsd\`), the account's usage limit (the task says when it resets), or an agent that showed no sign of work for 20 minutes.
- A step is "interrupted": the window that ran it closed. Resume runs the step again.
- "Runs in another window": \`run.lease\` names the window; it goes on there.
- A report was sent back: its json did not match, a plan lacked a \`### <repo>\` section for a repo of its json, or the plan's branch is taken already. The agent is asked again in its session (its transcript shows "Your report could not be read: …"), twice; then the step fails with \`report still invalid after … corrections\` and the reason.
- Expensive or slow: add \`costUsd\` and \`turns\` per step from \`agent_stopped\`; look for long tool loops in the transcripts, \`mcp: true\` on agents that need no MCP, effort higher than the step needs.

## What the user can do

In the dashboard, on the task: answer the checkpoint (with feedback the agent reads), Retry or Resume, Stop, change the pipeline of the steps not run yet, Fix in chat (Claude Code started on the failure), and Continue in terminal on a step (its session again: \`claude --resume <sessionId>\` with \`CLAUDE_CONFIG_DIR\` set to the step's \`configDir\`).

Outside it: the config (\`.claudestrator/config.yaml\`), an agent's instructions, the workspace map, or the code on the task's branch in its checkout or worktree, then Retry.

## Report

1. What happened, in order, in a few lines: the steps, where it stopped, at which checkpoint.
2. The cause, with the evidence: the event, and the line of the log, report or transcript that shows it.
3. What to do: the change (a setting, the instructions, the code) and then the button to press. Say when a Retry alone will fail the same way.
4. What you could not tell, and what would tell it.
`;

const SKILLS: readonly BundledSkill[] = [
  {
    name: 'claudestrator-library',
    label: 'Writing Claudestrator libraries',
    about: 'Claude Code writes library.yaml and its prompts for you: agents, scenarios with loops, branches and approvals, and what each output hands over. Ask it, e.g., "make a Claudestrator library for our release checklist".',
    files: { 'SKILL.md': LIBRARY_SKILL },
  },
  {
    name: 'claudestrator-workspace-map',
    label: 'Writing the workspace map',
    about: 'Claude Code reads your repos and writes .claudestrator/workspace.md, which every agent reads first: what each repo is, the contracts between them, the merge order. Better maps, better plans.',
    files: { 'SKILL.md': WORKSPACE_MAP_SKILL },
  },
  {
    name: 'claudestrator-config',
    label: 'Setting up config and checks',
    about: 'Claude Code writes .claudestrator/config.yaml from your repos and their CI: the checks agents get back when they fail, quiet enough to read, and the sandbox setting a check needs when it passes in a terminal but not here.',
    files: { 'SKILL.md': CONFIG_SKILL },
  },
  {
    name: 'claudestrator-task',
    label: 'Looking into a task',
    about: 'Claude Code reads a task\'s event log, transcripts, reports and check logs, and says why it failed, got blocked or cost so much, with the evidence, and what to change before you retry. Ask it, e.g., "why is task PROJ-123 blocked?".',
    files: { 'SKILL.md': TASK_SKILL },
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
