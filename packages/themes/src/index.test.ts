import { expect, test } from "bun:test";
import { allWorlds, FLAVOUR_KEYS, plainWords, SYSTEM, themeById, themes, type WordKey } from ".";

test("the house world is Instrument (id overhand), and its earlier ids from saved settings still load it", () => {
  for (const id of ["overhand", "plain", null, undefined, "gone"]) expect(themeById(id).id).toBe("overhand");
  expect(themeById("overhand").name).toBe("Instrument");
});

test("launch offers Instrument only: retired worlds and worlds not offered yet load it; all five keep their code", () => {
  for (const id of ["nexus", "legion", "syndicate", "tokenmaxx", "observatory", "transit", "koi", "catnap"])
    expect(themeById(id).id).toBe("overhand");
  expect(themes.map((t) => t.id)).toEqual(["overhand"]);
  expect(allWorlds.map((t) => t.id)).toEqual(["overhand", "observatory", "transit", "koi", "catnap"]);
  for (const t of allWorlds) expect(t.ink?.length).toBe(12);
});

test("every world keeps the house's two voices: Atkinson Hyperlegible Next for words and headings, Mono for data", () => {
  expect(SYSTEM.font.name).toEqual({ body: "Atkinson Hyperlegible Next", mono: "Atkinson Hyperlegible Mono" });
  for (const t of allWorlds) {
    expect(t.fonts.display).toStartWith(`"${SYSTEM.font.name.body}"`);
    expect(t.fonts.body).toStartWith(`"${SYSTEM.font.name.body}"`);
    expect(t.fonts.mono).toStartWith(`"${SYSTEM.font.name.mono}"`);
    expect(Object.keys(t.fonts).sort()).toEqual(
      t.fonts.greeting ? ["body", "display", "greeting", "href", "mono"] : ["body", "display", "href", "mono"],
    );
  }
});

test("a world rewords only the flavour lines: every other word is the house's", () => {
  const flavour = new Set<string>(FLAVOUR_KEYS);
  for (const t of allWorlds)
    for (const [k, v] of Object.entries(t.words))
      if (!flavour.has(k)) expect(v, `${t.id} overrides "${k}", which isn't a flavour key`).toBe(plainWords[k as WordKey]);
});
