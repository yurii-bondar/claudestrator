// Where the window was: it opens there again. Read once at start, written a moment after it stops moving.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The design's desktop size (the Penpot file's Desktop screens are 1440 wide). */
const DEFAULT_SIZE = { width: 1440, height: 900 };
const MIN = { width: 720, height: 480 };
/** How much of the window's top must be on a display for it to open there again: enough to grab its title bar. */
const VISIBLE = { width: 120, height: 40 };

/**
 * Where the window opens: where it was, when enough of its top is still on one of the displays (one may have been
 * unplugged since), else centred on the primary display's work area, as large as the design's or the area allows.
 */
export function placeFrame(saved: Frame | null, workAreas: readonly Frame[], primary: Frame | undefined): Frame {
  if (saved && workAreas.some((a) => overlap(saved.x, saved.width, a.x, a.width) >= VISIBLE.width && overlap(saved.y, VISIBLE.height, a.y, a.height) >= VISIBLE.height)) return saved;
  const area = primary ?? workAreas[0];
  if (!area || area.width <= 0 || area.height <= 0) return { x: 120, y: 80, ...DEFAULT_SIZE };
  const width = Math.min(DEFAULT_SIZE.width, area.width);
  const height = Math.min(DEFAULT_SIZE.height, area.height);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}

const overlap = (a: number, aLen: number, b: number, bLen: number): number => Math.max(0, Math.min(a + aLen, b + bLen) - Math.max(a, b));

/** A stored frame, if it is one; too small a window is made the smallest that still shows the page. */
export function frameFrom(raw: unknown): Frame | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string): number | null => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? Math.round(r[k] as number) : null);
  const [x, y, width, height] = [n('x'), n('y'), n('width'), n('height')];
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width: Math.max(width, MIN.width), height: Math.max(height, MIN.height) };
}

/** The frame saved last, or null. */
export async function readFrame(file: string): Promise<Frame | null> {
  try {
    return frameFrom(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

const SAVE_MS = 500;

/** Saves the frame it is given last, SAVE_MS after the last call. */
export function frameSaver(file: string): (frame: Frame) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (frame) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void fs.mkdir(path.dirname(file), { recursive: true }).then(() => fs.writeFile(file, JSON.stringify(frame))).catch(() => undefined);
    }, SAVE_MS);
  };
}
