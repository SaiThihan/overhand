import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

// the tracker is the user's: a pick that becomes a ticket files it there, so here it's recorded instead
const filed: { title: string; body: string; label: string }[] = [];
const fake = async (_c: unknown, title: string, body: string, label: string) => {
  filed.push({ title, body, label });
  return "HONEY-42";
};
const { CLIENTS, CODE, LABEL, OPS } = await import("../src/env");
const { loadWin, pickTask: pickWith, saveWin } = await import("../src/firstwin");
const pickTask = (repo: string, t: typeof task) => pickWith(repo, t, fake);

const task = { kind: "ci" as const, title: "Add a CI workflow", brief: "No CI; add one." };

test("a check-up pick becomes the first win when none is under way, else a ticket labelled for the agents", async () => {
  const c = CLIENTS[0];
  if (!c) throw new Error("the example config has projects");
  const repo = join(CODE, c.dir, "web"); // only named: nothing is read or written there
  rmSync(join(OPS, "first-win.json"), { force: true });
  try {
    // no first win yet: this is it, local and keyed PREFIX-0, and a work pass is asked for
    expect(await pickTask(repo, task)).toEqual({ state: "queued", key: `${c.prefix}-0` });
    expect(loadWin()).toMatchObject({
      state: "queued",
      kind: "ci",
      title: "Add a CI workflow",
      project: c.name,
      repoPath: repo,
      brief: "No CI; add one.",
    });
    expect(filed).toEqual([]);

    // one is under way: the next pick is a real ticket, reviewable like any other
    expect(await pickTask(repo, { ...task, title: "Fix the TODOs" })).toEqual({ state: "ticket", key: "HONEY-42" });
    expect(filed).toEqual([{ title: "Fix the TODOs", body: expect.stringContaining("No CI; add one."), label: LABEL.queue }]);

    // a first win that found nothing makes room for the pick
    const w = loadWin();
    if (w) saveWin({ ...w, state: "none" });
    expect((await pickTask(repo, task)).state).toBe("queued");

    // a folder outside every project is refused
    await expect(pickTask("/nowhere/else", task)).rejects.toThrow("isn't in any project");
  } finally {
    rmSync(join(OPS, "first-win.json"), { force: true });
    rmSync(join(OPS, ".request-work"), { force: true });
  }
});

test("on a watch project a check-up pick is you assigning an agent: a task with no ticket, nothing filed in the tracker", async () => {
  const { loadAssignments } = await import("../src/assign");
  const c = CLIENTS[0];
  if (!c) throw new Error("the example config has projects");
  const was = c.autonomy;
  c.autonomy = "watch";
  filed.length = 0;
  rmSync(join(OPS, "first-win.json"), { force: true });
  rmSync(join(OPS, "assigned.json"), { force: true });
  try {
    const r = await pickTask(join(CODE, c.dir, "web"), task);
    expect(r.state).toBe("assigned");
    expect(r.key).toMatch(new RegExp(`^${c.prefix}-9\\d{8}$`));
    expect(loadAssignments()[r.key]).toMatchObject({ project: c.name, local: true, title: task.title, by: "dashboard" });
    expect(filed).toEqual([]);
    expect(loadWin()).toBeNull(); // not a read-only first win either
  } finally {
    c.autonomy = was;
    rmSync(join(OPS, "assigned.json"), { force: true });
    rmSync(join(OPS, ".request-work"), { force: true });
  }
});
