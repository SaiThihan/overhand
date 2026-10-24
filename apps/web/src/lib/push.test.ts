import { expect, test } from "bun:test";
import { pushBranchesOf, pushOptions, togglePush } from "./push";

test("a lead's push branches: absent or malformed (an older daemon) reads as none, so the setting is off", () => {
  expect(pushBranchesOf(undefined)).toEqual([]);
  expect(pushBranchesOf(null)).toEqual([]);
  expect(pushBranchesOf("main")).toEqual([]);
  expect(pushBranchesOf(["main", 3, "", "develop"])).toEqual(["main", "develop"]);
});

test("the offered branches keep any the lead already has; toggling adds and removes one", () => {
  expect(pushOptions([])).toEqual(["develop", "main", "master", "staging"]);
  expect(pushOptions(["release", "main"])).toEqual(["develop", "main", "master", "staging", "release"]);
  expect(togglePush([], "develop")).toEqual(["develop"]);
  expect(togglePush(["develop", "main"], "develop")).toEqual(["main"]);
});
