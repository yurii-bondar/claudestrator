// What a branch looks at: results steps before it reported, read from the task's state, one check or several joined
// with all (and), any (or) and not. Pure and deterministic, so a replayed log takes the same branch without an event
// of its own.

import type { Check, Condition, Output, ReportSeverity, Severity, StepWhen, TaskState } from './types';

const SEVERITY: Severity[] = ['minor', 'major', 'blocker'];
const REPORT_SEVERITY: ReportSeverity[] = ['low', 'medium', 'high', 'critical'];

/** Whether `c` is one check rather than checks joined. */
function isCheck(c: Condition): c is Check {
  return !('all' in c) && !('any' in c) && !('not' in c);
}

/** The checks of `c`, each with the step it looks at: its own `on`, else `on`, the branch's. */
function checksOf(on: string, c: Condition): { on: string; check: Check }[] {
  if ('all' in c) return c.all.flatMap((x) => checksOf(on, x));
  if ('any' in c) return c.any.flatMap((x) => checksOf(on, x));
  if ('not' in c) return checksOf(on, c.not);
  return [{ on: c.on ?? on, check: c }];
}

/** The steps a condition looks at, each once. */
function conditionSources(on: string, c: Condition): string[] {
  return [...new Set(checksOf(on, c).map((x) => x.on))];
}

/** The output a step must have for a check to be about it. */
function conditionOutput(c: Check): Output[] {
  if ('verdict' in c || 'severity' in c) return ['verdict'];
  if ('readiness' in c) return ['readiness'];
  if ('audit' in c) return ['audit'];
  return ['code', 'tests'];
}

/** The latest verdict of `agent`: this round's, else the round before's (a loop that was left moved it there). */
function latestVerdict(s: TaskState, agent: string) {
  const find = (list: TaskState['review']['verdicts']) => [...list].reverse().find((v) => v.agent === agent);
  return find(s.review.verdicts) ?? find(s.review.lastVerdicts);
}

/** Whether one check holds for the result of `on`: null while `on` has reported nothing. */
function evaluateCheck(s: TaskState, on: string, c: Check): boolean | null {
  if ('verdict' in c || 'severity' in c) {
    const v = latestVerdict(s, on);
    if (!v) return null;
    if ('verdict' in c) return v.status === c.verdict;
    return v.findings.some((f) => SEVERITY.indexOf(f.severity) >= SEVERITY.indexOf(c.severity));
  }
  if ('readiness' in c || 'audit' in c) {
    const r = (s.reports || []).find((x) => x.agent === on);
    if (!r || !r.value) return null;
    const value = r.value;
    // A report of the other kind (config refuses that branch) holds nothing.
    if ('readiness' in c) return 'verdict' in value ? value.verdict === c.readiness : null;
    return 'findings' in value ? value.findings.some((f) => REPORT_SEVERITY.indexOf(f.severity) >= REPORT_SEVERITY.indexOf(c.audit)) : null;
  }
  if (!s.artifacts.some((a) => a.agent === on)) return null;
  const failed = s.gateFailures.some((st) => st.agent === on);
  return c.gates === 'fail' ? failed : !failed;
}

/**
 * Whether `c` holds, `on` being the step a check without its own looks at. Null while it cannot be told: a check whose
 * step has reported nothing (it has not run, it is turned off, its branch skipped it) is unknown, and joined checks are
 * unknown only while the known ones do not settle them (`any` with one true is true, `all` with one false is false).
 * A branch takes unknown as not holding.
 */
function evaluate(s: TaskState, on: string, c: Condition): boolean | null {
  if ('all' in c) {
    const xs = c.all.map((x) => evaluate(s, on, x));
    return xs.includes(false) ? false : xs.includes(null) ? null : true;
  }
  if ('any' in c) {
    const xs = c.any.map((x) => evaluate(s, on, x));
    return xs.includes(true) ? true : xs.includes(null) ? null : false;
  }
  if ('not' in c) {
    const x = evaluate(s, on, c.not);
    return x === null ? null : !x;
  }
  return evaluateCheck(s, c.on ?? on, c);
}

/** Whether a step of a branch runs: its condition holds (an `else` step: it does not). A step of no branch always runs. */
function stepRuns(s: TaskState, when: StepWhen | undefined): boolean {
  if (!when) return true;
  const met = evaluate(s, when.on, when.if) === true;
  return when.else ? !met : met;
}

/** Whether two steps are in the same Branch (either arm): one on the same step, with the same condition. */
function sameBranch(a: StepWhen | undefined, b: StepWhen | undefined): boolean {
  return Boolean(a && b) && a!.on === b!.on && JSON.stringify(a!.if) === JSON.stringify(b!.if);
}

/** Whether two steps are in the same arm of the same Branch, or both in none. */
function sameArm(a: StepWhen | undefined, b: StepWhen | undefined): boolean {
  return a === undefined || b === undefined ? a === b : sameBranch(a, b) && Boolean(a.else) === Boolean(b.else);
}

/** One check in words: "reviewer approved", "auditor found high or worse". */
function describeCheck(on: string, c: Check): string {
  if ('verdict' in c) return `${on} ${c.verdict === 'approved' ? 'approved' : 'requested changes'}`;
  if ('severity' in c) return `${on} found ${c.severity === 'blocker' ? 'a blocker' : `${c.severity} or worse`}`;
  if ('readiness' in c) return `${on} says ${c.readiness.replace('_', ' ')}`;
  if ('audit' in c) return `${on} found ${c.audit === 'critical' ? 'a critical issue' : `${c.audit} or worse`}`;
  return `${on}'s checks ${c.gates === 'pass' ? 'passed' : 'were left failing'}`;
}

/**
 * The condition in words, for the editor and the task screen: "reviewer approved", "(auditor found high or worse or
 * verifier says not ready) and not tester's checks were left failing".
 */
function describeCondition(on: string, c: Condition): string {
  // `not` binds tightest: only `all` and `any` inside another condition need brackets.
  const part = (x: Condition): string => ('all' in x || 'any' in x ? `(${describeCondition(on, x)})` : describeCondition(on, x));
  if ('all' in c) return c.all.map(part).join(' and ');
  if ('any' in c) return c.any.map(part).join(' or ');
  if ('not' in c) return `not ${part(c.not)}`;
  return describeCheck(c.on ?? on, c);
}

export { REPORT_SEVERITY, SEVERITY, checksOf, conditionOutput, conditionSources, describeCondition, evaluate, isCheck, sameArm, sameBranch, stepRuns };
