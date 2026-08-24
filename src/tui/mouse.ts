import { useEffect } from "react";
import { EventEmitter } from "node:events";

/**
 * --- Step 1 finding (see this session's task) -----------------------------
 *
 * Ink delivers ANY unrecognized escape sequence -- including SGR mouse
 * press/release bytes like `ESC [ < 0;10;5 M` -- as a raw literal string to
 * every currently-active `useInput` consumer. Confirmed by reading:
 *
 *   - node_modules/ink/build/components/App.js `handleReadable` (~line 132):
 *     reads a raw chunk off stdin and unconditionally does
 *     `this.internal_eventEmitter.emit('input', chunk)` -- no filtering, no
 *     "is this a recognized keypress" gate of any kind.
 *   - node_modules/ink/build/hooks/use-input.js `handleData` (~line 45):
 *     every `useInput({isActive: true})` subscribes to that same 'input'
 *     event. It runs `parseKeypress(data)` on the chunk; for an SGR mouse
 *     sequence none of parse-keypress.js's patterns match (`metaKeyCodeRe`
 *     requires exactly ESC + one alnum char; `fnKeyRe`'s branches require
 *     either a digit or a trailing [a-zA-Z] immediately after the `[`/`O`/
 *     `[[` marker, and SGR mouse's next char is `<`, which satisfies
 *     neither) -- so `keypress.name` stays `''`. Back in use-input.js:
 *     `input = keypress.sequence` (the *entire* raw string, since ctrl is
 *     false), `nonAlphanumericKeys.includes('')` is false so it's left
 *     alone, the leading ESC is stripped, and the result --
 *     e.g. the literal string `"[<0;10;5M"` -- is handed to
 *     `inputHandler(input, key)` for every active useInput consumer. This is
 *     NOT inert; it is delivered exactly like real typed input.
 *   - src/tui/TextInput.tsx and src/tui/TextArea.tsx's final fallback
 *     branch (`if (input) { onChange(value.slice(0,cursor)+input+...) }`)
 *     would insert that garbage directly into whatever the user is typing.
 *
 * So mouse mode must stay OFF for as long as any TextInput/TextArea is
 * actively capturing keystrokes, globally, regardless of which screen it's
 * on -- the old nav-only gating was accidentally safe (there was never an
 * active text field while focus was on nav) but its own comment reasoning
 * ("passes through inertly") was wrong about *why*. This registry replaces
 * that nav-only gate with a text-capture-aware one that works the same way
 * on every screen.
 *
 * TextInput and TextArea are the only two primitives in this codebase that
 * ever capture free-form character input -- every editable field on every
 * screen is built on one or the other -- so wiring `useTextCapture` into
 * just those two components (see the bottom of each file) is sufficient to
 * guard every text-entry surface in the app. No per-screen plumbing needed.
 */
class TextCaptureRegistry extends EventEmitter {
  private count = 0;

  enter(): void {
    this.count++;
    if (this.count === 1) this.emit("change", true);
  }

  leave(): void {
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0) this.emit("change", false);
  }

  get active(): boolean {
    return this.count > 0;
  }
}

export const textCaptureRegistry = new TextCaptureRegistry();
textCaptureRegistry.setMaxListeners(50);

/**
 * Call with the same `active` boolean a TextInput/TextArea already gates
 * its own useInput with. While `active` is true, this field is counted as
 * "currently capturing keystrokes" for as long as it stays mounted+active,
 * which App.tsx uses to keep SGR mouse mode disabled.
 */
export function useTextCapture(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    textCaptureRegistry.enter();
    return () => textCaptureRegistry.leave();
  }, [active]);
}
