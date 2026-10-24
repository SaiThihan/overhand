import { expect, test } from "bun:test";
import type { DashboardState } from "@overhand/contract";
import { guessProject, looksLikeTask } from "./task";

const cs: DashboardState["clients"] = [
  { name: "Fernway", prefix: "FERN", host: "github", autonomy: "act", assignedAutonomy: "act", aliases: ["fernway-booking"] },
  { name: "Potluck", prefix: "POT", host: "github", autonomy: "propose", assignedAutonomy: "act" },
  { name: "Honeycrust", prefix: "HONEY", host: "github", autonomy: "watch", assignedAutonomy: "propose", aliases: ["shop"] },
];

test("a project named anywhere in the sentence is the sure guess, the others follow to correct it", () => {
  const g = guessProject(cs, "make the invite page friendlier on Potluck");
  expect(g).toEqual({ projects: ["Potluck", "Fernway", "Honeycrust"], sure: true, text: "make the invite page friendlier on Potluck" });
});

test("a ticket prefix or an alias names the project too, ignoring case, whole words only", () => {
  expect(guessProject(cs, "the shop checkout button is too small").projects[0]).toBe("Honeycrust");
  expect(guessProject(cs, "fern: tidy the footer").projects[0]).toBe("Fernway");
  // "pot" inside "spotty" is not Potluck
  expect(guessProject(cs, "the spotty loading spinner").sure).toBe(false);
});

test('a "Project:" lead-in wins and is taken off the request', () => {
  expect(guessProject(cs, "Honeycrust: mention Potluck in the footer")).toEqual({
    projects: ["Honeycrust", "Fernway", "Potluck"],
    sure: true,
    text: "mention Potluck in the footer",
  });
});

test("no project or two named: not sure, the list keeps its order", () => {
  expect(guessProject(cs, "add a dark mode toggle")).toMatchObject({ projects: ["Fernway", "Potluck", "Honeycrust"], sure: false });
  expect(guessProject(cs, "copy the Fernway header into Potluck").sure).toBe(false);
});

test("three words or more read as a request, shorter is a command", () => {
  expect(looksLikeTask("theme")).toBe(false);
  expect(looksLikeTask("review KITE-31")).toBe(false);
  expect(looksLikeTask("make it friendlier")).toBe(true);
});
