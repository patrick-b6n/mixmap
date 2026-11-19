// A small undo stack: actions push how to undo themselves; Ctrl+Z / the toast pops.

export type UndoEntry = { label: string; undo: () => Promise<void> };

export class UndoStack {
  private entries: UndoEntry[] = [];

  constructor(private readonly limit = 50) {}

  get size(): number {
    return this.entries.length;
  }

  push(entry: UndoEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  /** Undo the most recent action. Returns its label, or undefined if empty. */
  async undoLast(): Promise<string | undefined> {
    const entry = this.entries.pop();
    if (!entry) return undefined;
    await entry.undo();
    return entry.label;
  }

  /** Undo a specific action (e.g. from its toast), wherever it is in the stack. */
  async undoEntry(entry: UndoEntry): Promise<boolean> {
    const i = this.entries.lastIndexOf(entry);
    if (i < 0) return false;
    this.entries.splice(i, 1);
    await entry.undo();
    return true;
  }
}

/** Whether a key event happens while typing (text undo must stay the field's). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
}

/** Runs async tasks strictly one after another (a failed task doesn't block later ones). */
export class TaskQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
