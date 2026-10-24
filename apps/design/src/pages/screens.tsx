/**
 * Screens: the whole dashboard (the real App) in each of its five places, each in the five states every screen has.
 * On a computer Work, Crew, Health and Settings open as drawers beside the bridge; on a phone they're tabs.
 */
import type { Drawer } from "@/app/ui";
import type { Entry } from "../catalog";
import { broken, busy, empty, loading, type Seed } from "../fixtures";
import { Screen } from "../stage";

const NOTES = {
  loading: "Before the first state arrives from the daemon.",
  empty: "A fresh install: no projects yet.",
  busy: "07:24: the night's one call just in, pull requests open, questions waiting.",
  broken: "02:30, when BOOK-88's preview deploy fails, and the daemon has stopped answering: the last state stays, with the banner.",
  phone: "The busy moment on a 390px phone.",
};

/** One place in its five states. */
const place = (id: string, title: string, about: string, open: Drawer | undefined, extra: Partial<Entry> = {}): Entry => {
  const at = (seed: () => Seed) => () => <Screen seed={seed()} open={open} />;
  return {
    id,
    group: "screens",
    title,
    about,
    states: { loading: at(loading), empty: at(empty), busy: at(busy), broken: at(broken), phone: at(busy) },
    notes: NOTES,
    frame: { height: 820 },
    ...extra,
  };
};

/** The five places. */
export const SCREENS: Entry[] = [
  place("now", "Now", "The bridge: what needs you, the story and the map, the crew, the work and the day.", undefined, {
    covers: ["DrawerHost", "MeTeam"],
  }),
  place(
    "work",
    "Work",
    "The pipeline: every ticket from queued to merged, and every pull request in flight.",
    { kind: "work" },
    {
      covers: ["ViewDrawer", "PlaceBody", "DrawerHead"],
    },
  ),
  place("crew", "Crew", "Who's working, where, under which instructions.", { kind: "crew" }),
  place("health", "Health", "Is anything broken, and is it worth it: checks, spend and each account's usage.", { kind: "health" }),
  place(
    "settings",
    "Settings",
    "Everything Overhand is told: projects, accounts, leads, schedule, rules and the rest.",
    { kind: "settings" },
    {
      notes: { ...NOTES, empty: "A fresh install: no projects in the state; the form shows the demo's sample config." },
    },
  ),
];
