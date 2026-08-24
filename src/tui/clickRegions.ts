import { useEffect, useRef } from "react";

export interface ClickRegion {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  onClick: (x: number, y: number) => void;
}

/**
 * Global click-region registry, keyed by an opaque per-component owner id
 * so each registering component's regions fully replace (never append to)
 * whatever it registered last render, and are cleaned up automatically on
 * unmount.
 *
 * Regions are populated declaratively during render via `useClickRegions`
 * below, computed fresh every render, rather than once at module load --
 * every clickable surface past the old nav-only implementation (DB-backed
 * list rows, hint-bar action buttons) can move or change count between
 * renders (scrolling, polling, list mutation), so there is no static row
 * map to precompute the way the old nav-only NAV_ROW_MAP could.
 *
 * App.tsx is the sole place that parses raw SGR mouse press bytes off
 * stdin (see MOUSE_ENABLE_SEQUENCE / SGR_MOUSE_PATTERN there); on every
 * left-click press it calls `dispatch(x, y)`, the only consumer of this
 * registry.
 */
class ClickRegistry {
  private owners = new Map<string, ClickRegion[]>();

  set(ownerId: string, regions: ClickRegion[]): void {
    if (regions.length === 0) this.owners.delete(ownerId);
    else this.owners.set(ownerId, regions);
  }

  clear(ownerId: string): void {
    this.owners.delete(ownerId);
  }

  /** Finds and invokes the first region containing (x, y). Returns whether one was hit. */
  dispatch(x: number, y: number): boolean {
    for (const regions of this.owners.values()) {
      for (const region of regions) {
        if (y >= region.rowStart && y <= region.rowEnd && x >= region.colStart && x <= region.colEnd) {
          region.onClick(x, y);
          return true;
        }
      }
    }
    return false;
  }
}

export const clickRegistry = new ClickRegistry();

let ownerSeq = 0;

/**
 * Registers `regions` as this component's clickable surface, replacing
 * whatever it registered on the previous render. Recompute `regions` fresh
 * every render from current render state (selection, scroll window, list
 * length, ...) -- do not memoize across data changes.
 *
 * `enabled=false` (e.g. this screen isn't the active one, or a sub-mode
 * makes the rows non-clickable right now) clears this component's regions
 * entirely rather than leaving stale ones hit-testable underneath a modal
 * or a different screen.
 */
export function useClickRegions(regions: ClickRegion[], enabled = true): void {
  const idRef = useRef<string>();
  if (idRef.current === undefined) idRef.current = `click-owner-${++ownerSeq}`;
  const id = idRef.current;

  useEffect(() => {
    clickRegistry.set(id, enabled ? regions : []);
  });

  useEffect(() => {
    return () => clickRegistry.clear(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Finds `label` as an exact substring of `line` -- the same string actually
 * rendered on screen -- and turns it into a one-row ClickRegion, so a
 * clickable hint-bar button's hit box is always derived from, and can never
 * drift out of sync with, the visible text itself. Returns undefined if
 * `label` isn't present in `line` (e.g. a hint that's conditionally shown),
 * so callers can freely `.filter(Boolean)` a list of maybe-present buttons.
 */
export function labelRegion(
  line: string,
  row: number,
  colOffset: number,
  label: string,
  onClick: () => void
): ClickRegion | undefined {
  const idx = line.indexOf(label);
  if (idx === -1) return undefined;
  return {
    rowStart: row,
    rowEnd: row,
    colStart: colOffset + idx,
    colEnd: colOffset + idx + label.length - 1,
    onClick,
  };
}

/**
 * Convenience for the extremely common "N stacked single-line rows starting
 * at `startRow`, one per list item" shape (Contacts, RagDocuments, the
 * conversation list, ...). Returns one ClickRegion per item calling
 * `onSelect(index)`. `colEnd` defaults to a generously large value since
 * for a whole-row selection click, exact right-edge precision doesn't
 * matter -- any x at or past `colStart` within the row counts.
 */
export function listRowRegions(
  startRow: number,
  colStart: number,
  count: number,
  onSelect: (index: number) => void,
  colEnd = 9999
): ClickRegion[] {
  const regions: ClickRegion[] = [];
  for (let i = 0; i < count; i++) {
    regions.push({
      rowStart: startRow + i,
      rowEnd: startRow + i,
      colStart,
      colEnd,
      onClick: () => onSelect(i),
    });
  }
  return regions;
}
