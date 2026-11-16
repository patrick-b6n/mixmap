import type { Playlist } from "../api";

export type TreeNode = { children: TreeNode[]; playlist: Playlist };

/**
 * Build a nested tree from rekordbox's flat playlist list (by `parentId`, sorted by
 * `seq`). Nodes whose parent is missing, or that sit in a parent cycle, become roots,
 * so nothing gets lost.
 */
export function buildTree(lists: Playlist[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const p of lists) nodes.set(p.id, { children: [], playlist: p });
  const parentOf = (n: TreeNode) => {
    const id = n.playlist.parentId;
    return id === null ? undefined : nodes.get(id);
  };
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    // Walk up; if we come back to this node it sits in a cycle → make it a root.
    // (Nodes merely below a cycle keep their parent, which itself becomes a root.)
    const seen = new Set<TreeNode>([node]);
    let up = parentOf(node);
    while (up && !seen.has(up)) {
      seen.add(up);
      up = parentOf(up);
    }
    const parent = up === node ? undefined : parentOf(node);
    (parent ? parent.children : roots).push(node);
  }
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => a.playlist.seq - b.playlist.seq || a.playlist.name.localeCompare(b.playlist.name));
    ns.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/**
 * Track ids shown when a tree node is selected: a playlist's own ordered contents,
 * or for a folder the contents of everything below it (first occurrence wins).
 */
export function trackIdsOf(node: TreeNode): string[] {
  if (node.playlist.kind !== "folder") return node.playlist.trackIds;
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    for (const id of n.playlist.trackIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** Find a node by playlist id anywhere in the tree. */
export function findNode(roots: TreeNode[], id: string): TreeNode | undefined {
  for (const n of roots) {
    if (n.playlist.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return undefined;
}
