import { ChevronDown, ChevronRight, Folder, History, ListMusic, type LucideIcon, Music, Sparkles } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Placeholder } from "@/components/Placeholder";
import { cn } from "@/lib/utils";
import type { Playlist } from "../api";
import { buildTree, type TreeNode } from "../domain/playlistTree";

type Props = {
  histories: Playlist[];
  /** Context menu "Import pairs as links…" on a playlist or history. */
  onImportPairs?: (playlist: Playlist) => void;
  onSelect: (id: string | undefined) => void;
  playlists: Playlist[];
  selectedId?: string;
  trackCount: number;
};

const ICONS: Record<Playlist["kind"], LucideIcon> = {
  folder: Folder,
  history: History,
  playlist: ListMusic,
  smart: Sparkles,
};

/** rekordbox playlist and history trees; selecting a node filters the track table. */
export function PlaylistTree({ histories, onImportPairs, onSelect, playlists, selectedId, trackCount }: Props) {
  const [menu, setMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number }>();
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
    const tree = e.currentTarget.closest("[data-tree]");
    const rows = Array.from(tree?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? []);
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

  const row = (opts: {
    count?: number;
    depth: number;
    hasChildren: boolean;
    icon: LucideIcon;
    id: string | undefined;
    name: string;
    open: boolean;
    playlist?: Playlist;
    title?: string;
  }): ReactNode => {
    const p = opts.playlist;
    const canImport = onImportPairs && p && (p.kind === "playlist" || p.kind === "history") && p.trackIds.length > 1;
    const Icon = opts.icon;
    const selected = opts.id === selectedId;
    return (
      <div
        className={cn(
          "flex h-6 cursor-pointer items-center gap-1 pr-2 outline-none select-none hover:bg-accent",
          "focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring",
          selected && "bg-selected hover:bg-selected",
        )}
        data-tree-row
        onClick={() => onSelect(opts.id)}
        onContextMenu={(e) => {
          if (!canImport) return;
          e.preventDefault();
          setMenu({
            items: [{ label: "Import pairs as links…", onSelect: () => onImportPairs(p) }],
            x: e.clientX,
            y: e.clientY,
          });
        }}
        onKeyDown={(e) => onKeyDown(e, opts.id, opts.hasChildren, opts.open)}
        style={{ paddingLeft: 8 + opts.depth * 14 }}
        tabIndex={0}
        title={opts.title ?? opts.name}
      >
        <span
          className="flex w-3 justify-center text-muted-foreground"
          onClick={(e) => {
            if (!opts.hasChildren || opts.id === undefined) return;
            e.stopPropagation();
            toggle(opts.id);
          }}
        >
          {opts.hasChildren && (opts.open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />)}
        </span>
        <Icon className="mx-0.5 size-3.5 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{opts.name}</span>
        {opts.count !== undefined && <span className="text-[11px] text-muted-foreground">{opts.count}</span>}
      </div>
    );
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const p = node.playlist;
    const open = !collapsed.has(p.id);
    const hasChildren = node.children.length > 0;
    return (
      <li aria-expanded={hasChildren ? open : undefined} aria-selected={p.id === selectedId} key={p.id} role="treeitem">
        {row({
          count: p.kind === "folder" ? undefined : p.trackIds.length,
          depth,
          hasChildren,
          icon: ICONS[p.kind],
          id: p.id,
          name: p.name,
          open,
          playlist: p,
          title: p.kind === "smart" ? (p.smartNote ?? `Smart playlist: ${p.name}`) : undefined,
        })}
        {hasChildren && open && <ul role="group">{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <nav aria-label="Playlists" data-tree>
      <ul role="tree">
        <li aria-selected={selectedId === undefined} role="treeitem">
          {row({
            count: trackCount,
            depth: 0,
            hasChildren: false,
            icon: Music,
            id: undefined,
            name: "All tracks",
            open: false,
          })}
        </li>
      </ul>
      <Heading>Playlists</Heading>
      <ul role="tree">{playlistTree.map((n) => renderNode(n, 0))}</ul>
      {playlistTree.length === 0 && <Placeholder>No playlists</Placeholder>}
      <Heading>History</Heading>
      <ul role="tree">{historyTree.map((n) => renderNode(n, 0))}</ul>
      {historyTree.length === 0 && <Placeholder>No history yet</Placeholder>}
      {menu && <ContextMenu items={menu.items} onClose={() => setMenu(undefined)} x={menu.x} y={menu.y} />}
    </nav>
  );
}

function Heading({ children }: { children: string }) {
  return <div className="px-2 pt-2.5 pb-1 text-[11px] tracking-wider text-muted-foreground uppercase">{children}</div>;
}
