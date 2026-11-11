// The main thread's own logic: where the window opens, what the menu's clicks mean, the message box's buttons.
// (Electrobun's API is not loaded here: these modules take only its types.)
import { describe, expect, test } from 'bun:test';
import { frameFrom, placeFrame } from '../src/bun/frame';
import { appMenu, clickedAction } from '../src/bun/menu';

describe('where the window opens', () => {
  const laptop = { x: 0, y: 33, width: 1728, height: 1028 };
  const above = { x: 887, y: -1050, width: 1920, height: 1050 };

  test('where it was, while that is on a display', () => {
    const saved = { x: 1000, y: -900, width: 1440, height: 900 };
    expect(placeFrame(saved, [laptop, above], laptop)).toEqual(saved);
  });

  test('centred on the primary display when its display is gone, or nothing was saved', () => {
    const offscreen = { x: -822, y: -1050, width: 1440, height: 900 };
    expect(placeFrame(offscreen, [laptop], laptop)).toEqual({ x: 144, y: 97, width: 1440, height: 900 });
    expect(placeFrame(null, [laptop], laptop)).toEqual({ x: 144, y: 97, width: 1440, height: 900 });
  });

  test('never larger than the display', () => {
    const small = { x: 0, y: 25, width: 1280, height: 775 };
    expect(placeFrame(null, [small], small)).toEqual({ x: 0, y: 25, width: 1280, height: 775 });
  });

  test('a stored frame is read only when it is one, and never smaller than the page needs', () => {
    expect(frameFrom({ x: 1, y: 2, width: 300, height: 200 })).toEqual({ x: 1, y: 2, width: 720, height: 480 });
    expect(frameFrom({ x: 1, y: 2, width: 'wide' })).toBeNull();
    expect(frameFrom(null)).toBeNull();
  });
});

describe('the menu', () => {
  const click = (data: unknown) => clickedAction({ data: { id: 1, action: 'cs', data } });

  test('its clicks come back as what the item does', () => {
    expect(click({ kind: 'go', screen: 'repos' })).toEqual({ kind: 'go', screen: 'repos' });
    expect(click({ kind: 'go', screen: 'start' })).toEqual({ kind: 'go', screen: 'start' });
    expect(click({ kind: 'command', command: 'pickRoot' })).toEqual({ kind: 'command', command: 'pickRoot' });
    expect(click({ kind: 'newTask' })).toEqual({ kind: 'newTask' });
  });

  test('anything else is nothing', () => {
    expect(click({ kind: 'go', screen: 'nowhere' })).toBeNull();
    expect(click({ kind: 'command', command: 'rm -rf' })).toBeNull();
    expect(click('newTask')).toBeNull();
    expect(clickedAction(undefined)).toBeNull();
  });

  test('every item with an action is one a click understands; Developer Tools only in development', () => {
    const items = (menu: ReturnType<typeof appMenu>): unknown[] =>
      menu.flatMap((m) => ('submenu' in m && m.submenu ? [...('data' in m && m.data ? [m.data] : []), ...items(m.submenu)] : 'data' in m && m.data ? [m.data] : []));
    const dev = items(appMenu({ devTools: true }));
    for (const data of dev) expect(click(data)).not.toBeNull();
    expect(dev).toContainEqual({ kind: 'devTools' });
    expect(items(appMenu({ devTools: false }))).not.toContainEqual({ kind: 'devTools' });
  });
});
