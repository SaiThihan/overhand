/** Plain JSON, as the config travels between the daemon and the settings form. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** A JSON object (not an array, not null). */
export function isObject(x: Json | undefined): x is JsonObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** The value at a dotted path ("clients.0.tracker.kind"), or undefined. */
export function getAt(o: Json, path: string): Json | undefined {
  let x: Json | undefined = o;
  for (const k of path.split(".")) {
    if (Array.isArray(x)) x = x[Number(k)];
    else if (isObject(x)) x = x[k];
    else return undefined;
  }
  return x;
}

/**
 * A copy of `o` with the value at a dotted path set, creating objects and arrays on the way.
 * `undefined` removes it (an array item is spliced out, so later indices shift down).
 */
export function setAt<T extends Json>(o: T, path: string, v: Json | undefined): T {
  const root = structuredClone(o);
  const ks = path.split(".");
  const last = ks.pop() ?? "";
  let x: Json = root;
  ks.forEach((k, i) => {
    const blank: Json = /^\d+$/.test(ks[i + 1] ?? last) ? [] : {};
    if (Array.isArray(x)) {
      const n = Number(k);
      const next: Json = x[n] ?? blank;
      x[n] = next;
      x = next;
    } else if (isObject(x)) {
      const next: Json = x[k] ?? blank;
      x[k] = next;
      x = next;
    }
  });
  if (Array.isArray(x)) {
    if (v === undefined) x.splice(Number(last), 1);
    else x[Number(last)] = v;
  } else if (isObject(x)) {
    if (v === undefined) delete x[last];
    else x[last] = v;
  }
  return root;
}

/** The non-empty string at a dotted path, else `fallback` (a select's default when the config leaves the field out). */
export function stringAt(o: Json, path: string, fallback = ""): string {
  const v = getAt(o, path);
  return typeof v === "string" && v ? v : fallback;
}
