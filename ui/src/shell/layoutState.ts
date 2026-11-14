// Persisted layout of the main window (splitter position, collapsed panels).
// Stored per browser/app in localStorage; failures fall back to defaults.

export type LayoutState = {
  /** Share of the center column used by the graph, 0–1 (default 2/3). */
  graphShare: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};

export const DEFAULT_LAYOUT: LayoutState = {
  graphShare: 2 / 3,
  leftCollapsed: false,
  rightCollapsed: false,
};

const STORAGE_KEY = "mixmap.layout";
const MIN_SHARE = 0.15;
const MAX_SHARE = 0.85;

export function clampShare(share: number): number {
  if (!Number.isFinite(share)) return DEFAULT_LAYOUT.graphShare;
  return Math.min(MAX_SHARE, Math.max(MIN_SHARE, share));
}

/** Graph share for a splitter dragged to `y` within a column from `top` with `height`. */
export function shareFromPointer(y: number, top: number, height: number): number {
  if (height <= 0) return DEFAULT_LAYOUT.graphShare;
  return clampShare((y - top) / height);
}

export function parseLayout(raw: string | null): LayoutState {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const v = JSON.parse(raw) as Partial<LayoutState>;
    return {
      graphShare: clampShare(typeof v.graphShare === "number" ? v.graphShare : DEFAULT_LAYOUT.graphShare),
      leftCollapsed: v.leftCollapsed === true,
      rightCollapsed: v.rightCollapsed === true,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function loadLayout(): LayoutState {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable: layout just isn't remembered.
  }
}
