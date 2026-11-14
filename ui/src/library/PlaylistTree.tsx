import { type KeyboardEvent, useMemo, useState } from "react";
import type { Playlist } from "../api";
import { buildTree, type TreeNode } from "../domain/playlistTree";
import "./library.css";

type Props = {
  histories: Playlist[];
  onSelect: (id: string | undefined) => void;
  playlists: Playlist[];
  selectedId?: string;
  trackCount: number;
};

const ICONS: Record<Playlist["kind"], string> = {
  folder: "📁",
  history: "🕘",
  playlist: "♪",
  smart: "⚙",
};

/** rekordbox playlist and history trees; selecting a node filters the track table. */
export function PlaylistTree({ histories, onSelect, playlists, selectedId, trackCount }: Props) {
  const playlistTree = useMemo(() => buildTree(playlists), [playlists]);
  const historyTree = useMemo(() => buildTree(histories), [histories]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Up/Down move between visible rows, Left/Right collapse/expand, Enter/Space select. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string | undefined, hasChildren: boolean, open: boolean) => {
    const rows = Array.from(e.currentTarget.closest(".tree")?.querySelectorAll<HTMLElement>(".tree-row") ?? []);
    const i = rows.indexOf(e.currentTarget);
    const focus = (j: number) => rows[Math.max(0, Math.min(rows.length - 1, j))]?.focus();
    const actions: Record<string, () => void> = {
      " ": () => onSelect(id),
      ArrowDown: () => focus(i + 1),
      ArrowLeft: () => id !== undefined && hasChildren && open && toggle(id),
      ArrowRight: () => id !== undefined && hasChildren && !open && toggle(id),
      ArrowUp: () => focus(i - 1),
      End: () => focus(rows.length - 1),
      Enter: () => onSelect(id),
      Home: () => focus(0),
    };
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const p = node.playlist;
    const open = !collapsed.has(p.id);
    const hasChildren = node.children.length > 0;
    return (
      <li key={p.id} role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={p.id === selectedId}>
        <div
          className={`tree-row${p.id === selectedId ? " selected" : ""}`}
          onClick={() => onSelect(p.id)}
          onKeyDown={(e) => onKeyDown(e, p.id, hasChildren, open)}
          style={{ paddingLeft: 8 + depth * 14 }}
          tabIndex={0}
          title={p.kind === "smart" ? "Smart playlist (contents not supported yet)" : p.name}
        >
          <span
            className="tree-twisty"
            onClick={(e) => {
              if (!hasChildren) return;
              e.stopPropagation();
              toggle(p.id);
            }}
          >
            {hasChildren ? (open ? "▾" : "▸") : ""}
          </span>
          <span className="tree-icon">{ICONS[p.kind]}</span>
          <span className="tree-name">{p.name}</span>
          {p.kind !== "folder" && <span className="tree-count">{p.trackIds.length}</span>}
        </div>
        {hasChildren && open && <ul role="group">{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <nav className="tree" aria-label="Playlists">
      <ul role="tree">
        <li role="treeitem" aria-selected={selectedId === undefined}>
          <div
            className={`tree-row${selectedId === undefined ? " selected" : ""}`}
            onClick={() => onSelect(undefined)}
            onKeyDown={(e) => onKeyDown(e, undefined, false, false)}
            tabIndex={0}
          >
            <span className="tree-twisty" />
            <span className="tree-icon">♫</span>
            <span className="tree-name">All tracks</span>
            <span className="tree-count">{trackCount}</span>
          </div>
        </li>
      </ul>
      <div className="tree-heading">Playlists</div>
      <ul role="tree">{playlistTree.map((n) => renderNode(n, 0))}</ul>
      {playlistTree.length === 0 && <div className="placeholder">No playlists</div>}
      <div className="tree-heading">History</div>
      <ul role="tree">{historyTree.map((n) => renderNode(n, 0))}</ul>
      {historyTree.length === 0 && <div className="placeholder">No history yet</div>}
    </nav>
  );
}
