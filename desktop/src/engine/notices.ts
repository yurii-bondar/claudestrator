// What the desktop app tells you outside the window: what VS Code shows as notifications (vscode/extension.ts), as
// system notifications. They have no buttons: the dashboard is where you answer. Their text comes from tasks, agents
// and tools, so it goes through plainNotice, as the extension's does.
import * as view from '../../../core/src/view';
import { checkpointTitle } from '../../../core/src/describe';
import type { EngineEvent } from '../../../core/src/wire';
import type { Notice } from '../shared/protocol';

/** The `claudestrator.notifications` setting: all, needsYou or off. */
export type NoticeLevel = 'all' | 'needsYou' | 'off';

const wanted = (level: NoticeLevel, kind: 'needsYou' | 'all'): boolean => level === 'all' || (level === 'needsYou' && kind === 'needsYou');

/** The notification for an engine event at this level, or null. */
export function noticeFor(e: EngineEvent, level: NoticeLevel): Notice | null {
  switch (e.name) {
    case 'checkpoint': {
      if (!wanted(level, 'needsYou')) return null;
      const { taskId, checkpoint, title } = e.data;
      return { title: view.plainNotice(`${taskId} needs you`), body: view.plainNotice(`${checkpointTitle(checkpoint)}: ${title}`), whenAway: true };
    }
    case 'finished': {
      if (!wanted(level, 'all')) return null;
      const { taskId, state } = e.data;
      return { title: view.plainNotice(state.outcome === 'published' ? `${taskId}: draft PRs are open` : `${taskId} is done`), body: view.plainNotice(firstLine(state.input)), whenAway: false };
    }
    case 'log': {
      if (e.data.level !== 'error' || !wanted(level, 'all')) return null;
      const { taskId, message } = e.data;
      return { title: taskId ? view.plainNotice(`${taskId} failed`) : 'Claudestrator', body: view.plainNotice(message), whenAway: true };
    }
    case 'permission': {
      if (!wanted(level, 'needsYou')) return null;
      return { title: view.plainNotice(`${e.data.taskId} asks for permission`), body: view.permissionNotice(e.data).text, whenAway: true };
    }
    case 'changed':
    case 'output':
    case 'live':
    case 'permissionDone':
    case 'limits':
    case 'mcpLogin':
      return null;
    default: {
      const unhandled: never = e;
      return unhandled;
    }
  }
}

/** What a task was asked, as a notification's line: its first line, cut short. */
const BODY_CHARS = 140;
function firstLine(text: string): string {
  const line = text.trim().split('\n', 1)[0] ?? '';
  return line.length > BODY_CHARS ? `${line.slice(0, BODY_CHARS - 1)}…` : line;
}

/** The setting as stored, as one of its levels; an unknown value counts as the default. */
export const noticeLevel = (v: unknown): NoticeLevel => (v === 'needsYou' || v === 'off' ? v : 'all');
