/** Shapes of the status sources the dashboard shows. */
import type { Advisory, FileCount, Outdated } from "@overhand/contract";

export interface UiPr {
  client: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
  review: string;
  checks: string;
  updated: string;
}
export interface UiCi {
  client: string;
  repo: string;
  branch: string;
  state: "pass" | "fail" | "running" | "none";
  failing: string[];
  url: string;
}
export interface UiDeploy {
  client: string;
  project: string;
  state: string;
  target: string;
  url: string;
  created: number;
}
export interface UiIssue {
  client: string;
  id: string;
  title: string;
  count: number;
  users: number;
  isNew: boolean;
  level: string;
  url: string;
}
export interface UiEvent {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
}
export interface UiStatus {
  at: number;
  myPrs: UiPr[];
  reviews: UiPr[];
  ci: UiCi[];
  deploys: UiDeploy[] | string;
  sentry: UiIssue[] | string;
  advisories: Advisory[];
  outdated: Outdated[];
  untested: FileCount[];
  todos: FileCount[];
  calendar: UiEvent[] | string;
  errors: string[];
}

/** The latest status from every source, refreshed in place by refreshStatus (status/index.ts); importable without a cycle. */
export const status: UiStatus = {
  at: 0,
  myPrs: [],
  reviews: [],
  ci: [],
  deploys: [],
  sentry: [],
  advisories: [],
  outdated: [],
  untested: [],
  todos: [],
  calendar: [],
  errors: [],
};
