// macOS: a click on the window while another app is in front is a click, not only the window coming forward.
//
// AppKit asks the view under the pointer `acceptsFirstMouse:` before it hands an inactive window's first click on.
// WKWebView says no, and Electrobun leaves it so: back from the editor the plan opened in, or from a terminal, the
// first click on "Approve plan" (or any button) only activated the window, and it took a second. Every WKWebView here
// is the dashboard's, so the class answers yes for all of them. The yes is a method of Electrobun's own that returns
// it (-[ElectrobunWindow canBecomeKeyWindow]): AppKit calls it on its thread, with no JavaScript in between.
import { dlopen, FFIType } from 'bun:ffi';

const cString = (s: string): Buffer => Buffer.from(`${s}\0`);

/** Null once the dashboard takes the first click, else why it does not (the window then works as before). */
export function acceptFirstMouse(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const { symbols: objc } = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.ptr], returns: FFIType.ptr },
      class_getInstanceMethod: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
      method_getImplementation: { args: [FFIType.ptr], returns: FFIType.ptr },
      class_replaceMethod: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    });
    const webView = objc.objc_getClass(cString('WKWebView'));
    const window = objc.objc_getClass(cString('ElectrobunWindow'));
    if (!webView || !window) return 'WKWebView or ElectrobunWindow is not loaded';
    const yes = objc.class_getInstanceMethod(window, objc.sel_registerName(cString('canBecomeKeyWindow')));
    if (!yes) return 'ElectrobunWindow has no canBecomeKeyWindow';
    // `c@:@`: returns a BOOL, takes self, _cmd and the event (which the yes ignores).
    objc.class_replaceMethod(webView, objc.sel_registerName(cString('acceptsFirstMouse:')), objc.method_getImplementation(yes), cString('c@:@'));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
