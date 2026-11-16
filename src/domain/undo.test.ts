import { describe, expect, it } from "vitest";
import { TaskQueue, UndoStack } from "./undo";

describe("UndoStack", () => {
  it("undoes in reverse order", async () => {
    const done: string[] = [];
    const s = new UndoStack();
    s.push({ label: "a", undo: async () => void done.push("a") });
    s.push({ label: "b", undo: async () => void done.push("b") });
    expect(await s.undoLast()).toBe("b");
    expect(await s.undoLast()).toBe("a");
    expect(await s.undoLast()).toBeUndefined();
    expect(done).toEqual(["b", "a"]);
  });

  it("undoes a specific entry once (toast + Ctrl+Z don't double-undo)", async () => {
    let count = 0;
    const s = new UndoStack();
    const entry = { label: "x", undo: async () => void count++ };
    s.push(entry);
    s.push({ label: "y", undo: async () => undefined });
    expect(await s.undoEntry(entry)).toBe(true);
    expect(await s.undoEntry(entry)).toBe(false);
    expect(count).toBe(1);
    expect(s.size).toBe(1);
  });

  it("keeps only the most recent entries", () => {
    const s = new UndoStack(2);
    for (const label of ["1", "2", "3"]) s.push({ label, undo: async () => undefined });
    expect(s.size).toBe(2);
  });
});

describe("TaskQueue", () => {
  it("runs tasks in order, even after a failure", async () => {
    const q = new TaskQueue();
    const order: string[] = [];
    const slow = q.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("slow");
    });
    const failing = q.run(async () => {
      order.push("fail");
      throw new Error("x");
    });
    const fast = q.run(async () => void order.push("fast"));
    await slow;
    await expect(failing).rejects.toThrow("x");
    await fast;
    expect(order).toEqual(["slow", "fail", "fast"]);
  });
});
