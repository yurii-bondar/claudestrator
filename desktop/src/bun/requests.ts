// What the engine worker asks of the main thread: Electrobun's native dialogs and OS hand-offs. A dialog is a
// synchronous call: this thread waits while it is open, the engine's does not.
import { homedir } from 'node:os';
import * as Utils from 'electrobun/bun/utils';
import type { MainRequest } from '../shared/protocol';

/**
 * Electrobun joins a message box's buttons with commas, so a label with one would split in two; a look-alike
 * comma (U+201A) keeps it whole. The answer is by index, so the label picked is the engine's own.
 */
export const buttonLabel = (label: string): string => label.replace(/,/g, '‚');

/** The buttons of a message box and which one cancels: the engine's choices, then Cancel (or OK when it gave none). */
export function messageButtons(items: readonly string[]): { buttons: string[]; cancel: number } {
  const buttons = [...items.map(buttonLabel), items.length ? 'Cancel' : 'OK'];
  return { buttons, cancel: buttons.length - 1 };
}

export async function answer(request: MainRequest): Promise<unknown> {
  switch (request.method) {
    case 'message': {
      const { buttons, cancel } = messageButtons(request.items);
      // The safe button is the default: Enter must not confirm a deletion.
      const { response } = await Utils.showMessageBox({ type: request.level, title: 'Claudestrator', message: request.message, detail: request.detail, buttons, defaultId: cancel, cancelId: cancel });
      return request.items[response] ?? null;
    }
    case 'openDialog': {
      const picked = await Utils.openFileDialog({
        startingFolder: request.startIn || homedir(),
        allowedFileTypes: request.extensions.length ? request.extensions.join(',') : '*',
        canChooseFiles: request.files,
        canChooseDirectory: request.folders,
        allowsMultipleSelection: request.many,
      });
      const paths = picked.filter(Boolean);
      return paths.length ? paths : null;
    }
    case 'openPath':
      if (!Utils.openPath(request.path)) throw new Error(`Could not open ${request.path}`);
      return null;
    case 'reveal':
      Utils.showItemInFolder(request.path);
      return null;
    case 'openExternal':
      if (!Utils.openExternal(request.url)) throw new Error(`Could not open ${request.url}`);
      return null;
    case 'clipboard':
      Utils.clipboardWriteText(request.text);
      return null;
    default: {
      const unhandled: never = request;
      return unhandled;
    }
  }
}
