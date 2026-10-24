import { expect, test } from "bun:test";
import { spendByAccount } from "./Spend";

test("Spend names each account as the person did, in their order, the idle ones at $0", () => {
  // the order and the names are Settings' (and Agent accounts'), whatever each spent; nothing is re-cased
  expect(spendByAccount({ codex: 10.3, sam: 32.1, "Work Max": 4 }, ["sam", "Work Max", "local", "codex"])).toEqual([
    ["sam", 32.1],
    ["Work Max", 4],
    ["local", 0],
    ["codex", 10.3],
  ]);
});

test("spend on an account that's since been removed still counts, after the current ones", () => {
  expect(spendByAccount({ old: 2, gone: 5, sam: 1 }, ["sam"])).toEqual([
    ["sam", 1],
    ["gone", 5],
    ["old", 2],
  ]);
});
