/**
 * Classic Windows console hosts (the legacy conhost.exe behind plain
 * powershell.exe / cmd.exe windows, as opposed to Windows Terminal) process
 * ANSI/VT escape sequences noticeably slower than modern terminal emulators.
 * Every Ink re-render involves writing cursor-repositioning + overwrite
 * escape sequences to redraw only what changed; on a slow host, frequent
 * timer-driven re-renders (a clock tick, a blinking status dot, a stats
 * poll) can visibly tear/flicker even though the same update rate is
 * perfectly smooth on Windows Terminal, iTerm, or any Unix terminal.
 *
 * There's no direct "am I running under legacy conhost" API, so this is a
 * best-effort heuristic: Windows Terminal sets WT_SESSION, the VS Code
 * integrated terminal sets TERM_PROGRAM=vscode, and ConEmu/Cmder set
 * ConEmuANSI=ON. If none of those are present and we're on win32, assume
 * the slower legacy host and scale update intervals up accordingly.
 */
export const IS_LEGACY_WINDOWS_CONSOLE =
  process.platform === "win32" &&
  !process.env.WT_SESSION &&
  process.env.TERM_PROGRAM !== "vscode" &&
  process.env.ConEmuANSI !== "ON";

/**
 * Scales a base interval (ms) up on hosts known to be slower at processing
 * ANSI redraws, so timer-driven re-renders happen less often there. No-op
 * everywhere else.
 */
export function scaledInterval(baseMs: number): number {
  return IS_LEGACY_WINDOWS_CONSOLE ? Math.round(baseMs * 1.6) : baseMs;
}
