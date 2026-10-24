import { buildsItself, type DashboardState, plainLine } from "@overhand/contract";

/**
 * What Assign an agent sends: a ticket by key, a held finding by id, or (a lead's report) a task from a title and brief.
 * `project` names where it runs; the daemon refuses unknown projects and ones on act.
 */
export interface AssignOffer {
  project: string;
  key?: string;
  id?: string;
  title?: string;
  brief?: string;
}

type Clients = Pick<DashboardState, "clients">;

/** The project a ticket key belongs to, by its prefix; empty when none matches. */
export const projectOfKey = (s: Clients, key: string): string => s.clients.find((c) => key.startsWith(`${c.prefix}-`))?.name ?? "";

/** Whether you can assign an agent on a project: on watch and propose; act and ship build on their own already. */
export const canAssign = (s: Clients, project: string): boolean => {
  const c = s.clients.find((x) => x.name === project);
  return c ? !buildsItself(c.autonomy) : false;
};

/** What to call a task made from a lead's report: its newest section's heading, else its first sentence, plain. */
export const reportTitle = (text: string): string =>
  plainLine(
    text
      .split("\n")
      .filter((l) => /^##\s/.test(l))
      .at(-1) ?? text,
  );

/** Whether a project is on watch: its leads only report, so what they find is offered to an agent. */
export const onWatch = (s: Clients, project: string): boolean => s.clients.some((c) => c.name === project && c.autonomy === "watch");

/** Whether a ticket already has an agent assigned to build it. */
export const isAssigned = (s: Pick<DashboardState, "assigned">, key: string): boolean => s.assigned.some((a) => a.key === key);
