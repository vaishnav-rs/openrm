/**
 * Single source of truth for the openrm TUI's visual language: colors,
 * spacing, and icon glyphs. Every screen and the shell import from here
 * instead of hardcoding ink color strings, so the whole app reads as one
 * cohesive product rather than a pile of ad-hoc screens.
 *
 * Colors are plain ink-compatible strings (named colors / hex) -- ink
 * renders hex fine in truecolor terminals and falls back gracefully.
 */

export const colors = {
  accent: "#7C9EFF",
  accentDim: "#4A5A8C",
  accentAlt: "#C792EA",
  success: "#5FD68F",
  warning: "#F2C94C",
  error: "#FF6B6B",
  info: "#5FC9E8",
  muted: "#6B7280",
  mutedDim: "#4B5261",
  border: "#3A3F4B",
  borderFocus: "#7C9EFF",
  text: "#E4E7EC",
  textDim: "#9AA1AC",
  bg: undefined, // terminal background is left as-is intentionally
} as const;

export const waStatusColor: Record<string, string> = {
  idle: colors.muted,
  connecting: colors.warning,
  qr: colors.warning,
  connected: colors.success,
  disconnected: colors.error,
  logged_out: colors.error,
};

export const waStatusLabel: Record<string, string> = {
  idle: "Idle",
  connecting: "Connecting",
  qr: "Pairing",
  connected: "Connected",
  disconnected: "Disconnected",
  logged_out: "Logged out",
};

export const icons = {
  wordmark: "openrm",
  dotFilled: "●",
  dotHollow: "○",
  diamond: "◆",
  bullet: "▪",
  check: "✓",
  cross: "✗",
  bolt: "⚡",
  arrowRight: "▸",
  chevron: "›",
  caretUp: "▲",
  caretDown: "▼",
  in: "◂",
  out: "▸",
  clock: "⏱",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  qr: "▦",
  gear: "⚙",
  book: "▤",
  plug: "🔌",
  server: "▣",
  contact: "☺",
  msg: "✉",
  save: "💾",
  edit: "✎",
  lock: "🔒",
} as const;

export const spacing = {
  xs: 1,
  sm: 1,
  md: 2,
} as const;

export const layout = {
  navWidth: 26,
  statusBarHeight: 1,
  helpBarHeight: 1,
} as const;

/** Small block-character sparkline built from an array of non-negative counts. */
const SPARK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values
    .map((v) => {
      const idx = Math.min(SPARK_BLOCKS.length - 1, Math.floor((v / max) * (SPARK_BLOCKS.length - 1)));
      return SPARK_BLOCKS[Math.max(0, idx)];
    })
    .join("");
}

/** Pad/truncate a string to an exact display width for table-style alignment. */
export function padCol(value: string, width: number): string {
  const v = value.length > width ? value.slice(0, Math.max(0, width - 1)) + "…" : value;
  return v.padEnd(width, " ");
}
