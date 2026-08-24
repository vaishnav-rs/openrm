/**
 * Brackets every stdout write in DEC private mode 2026 ("synchronized
 * output"): `\x1b[?2026h` before the write, `\x1b[?2026l` after.
 *
 * ## Why this exists
 *
 * Three prior fix attempts in this repo (see git log: "Fix TUI vertical
 * flicker from mismatched panel heights", "the real flicker fix", and the
 * `terminal-env.ts` legacy-console throttle) all reduced *how often* Ink
 * re-renders. None of them addressed *how a single frame reaches the
 * screen*, and the user's flicker persisted even on modern, GPU-accelerated
 * Windows Terminal (WT_SESSION set, so the legacy-console throttle in
 * `terminal-env.ts` never even engages) with render frequency already
 * minimized. That rules out "renders too often" as the mechanism.
 *
 * Reading Ink 5's actual output path (`node_modules/ink/build/log-update.js`)
 * shows every frame is a *single* `stream.write()` call:
 *
 *   stream.write(ansiEscapes.eraseLines(previousLineCount) + output)
 *
 * That one call still contains an erase step (cursor-up + erase-line,
 * repeated per line) immediately followed by the new frame's content, all
 * as one blob of escape sequences. A single Node `.write()` does not mean
 * "one atomic terminal repaint" — the terminal emulator parses and applies
 * that byte stream incrementally as its own render loop ticks, so it can
 * (and, per Microsoft's own tracking of this exact class of bug, reliably
 * does on ConPTY-hosted terminals — see microsoft/terminal#15958, "How to
 * have the screen not flicker (like a strobe light) upon redraw?") paint
 * the erased/blank intermediate state on screen before the new content
 * lands, on every single frame, independent of render rate. This matches
 * the user's report exactly: flicker on every screen, unaffected by fix #2.
 *
 * Ink does not itself use synchronized output anywhere in its source (grep
 * for "2026" across `node_modules/ink/build` turns up nothing, in this
 * repo's installed 5.2.1 or in the latest published 7.1.1), so nothing
 * brackets that erase+write in a way the terminal can treat as one atomic
 * frame. DEC mode 2026 is the terminal-level primitive designed for exactly
 * this: `\x1b[?2026h` tells a supporting terminal to buffer all subsequent
 * output and defer repainting until `\x1b[?2026l` arrives, so the
 * erase-then-redraw sequence is applied to the screen as one atomic swap
 * instead of two visible states. Windows Terminal added support for it in
 * Preview 1.24 (Aug 2025), promoted to stable shortly after, specifically
 * to fix this category of flicker in full-screen redraw apps. Terminals
 * that predate or don't implement mode 2026 simply ignore the two escape
 * sequences as unrecognized private-mode toggles (per the DEC/xterm
 * spec's documented behavior for unsupported modes) — there is no
 * degraded/garbled fallback, so this is safe to apply unconditionally on
 * any TTY.
 *
 * This is applied by monkey-patching `process.stdout.write` before Ink's
 * `render()` is called, since Ink has no public option for it and won't
 * bracket writes on our behalf.
 */
const PATCHED = Symbol("openrm.synchronizedOutputPatched");

export function enableSynchronizedOutput(stream: NodeJS.WriteStream): () => void {
  if (!stream.isTTY) {
    // Piped/redirected output (e.g. `openrm > log.txt`, CI): don't inject
    // escape sequences into a non-terminal consumer.
    return () => {};
  }

  // Idempotent: onboarding and the dashboard each call render(), and both
  // funnel through here, but process.stdout.write must only be wrapped once.
  if ((stream as unknown as Record<symbol, boolean>)[PATCHED]) {
    return () => {};
  }
  (stream as unknown as Record<symbol, boolean>)[PATCHED] = true;

  const SYNC_START = "\x1b[?2026h";
  const SYNC_END = "\x1b[?2026l";
  const originalWrite = stream.write.bind(stream);

  // Match Node's overloaded `write(chunk[, encoding][, callback])` signature.
  stream.write = ((
    chunk: unknown,
    encoding?: unknown,
    callback?: unknown
  ): boolean => {
    let cb: ((error?: Error | null) => void) | undefined;
    let enc: BufferEncoding | undefined;
    if (typeof encoding === "function") {
      cb = encoding as (error?: Error | null) => void;
    } else {
      enc = encoding as BufferEncoding | undefined;
      cb = callback as ((error?: Error | null) => void) | undefined;
    }

    originalWrite(SYNC_START);
    const result = enc
      ? originalWrite(chunk as string, enc)
      : originalWrite(chunk as string | Uint8Array);
    // The callback fires once the actual frame content is flushed, which
    // happens before this trailing write in stream-ordering terms; chaining
    // it here (rather than dropping it) preserves callers that await drain.
    originalWrite(SYNC_END, cb);
    return result;
  }) as typeof stream.write;

  return () => {
    stream.write = originalWrite;
  };
}
