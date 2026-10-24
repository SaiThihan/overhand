import { expect, test } from "bun:test";
import { cleanPins, cropAround, frameable, pinNotes } from "../src/onpreview";

const headers = (h: Record<string, string>) => new Headers(h);

test("a preview shows live in the dashboard's frame unless its site refuses framing", () => {
  const origin = "http://127.0.0.1:4317";
  expect(frameable(headers({}), origin)).toBe(true);
  expect(frameable(headers({ "x-frame-options": "DENY" }), origin)).toBe(false);
  expect(frameable(headers({ "x-frame-options": "sameorigin" }), origin)).toBe(false);
  expect(frameable(headers({ "content-security-policy": "default-src 'self'; frame-ancestors 'self'" }), origin)).toBe(false);
  expect(frameable(headers({ "content-security-policy": "frame-ancestors 'none'" }), origin)).toBe(false);
  expect(frameable(headers({ "content-security-policy": "frame-ancestors *" }), origin)).toBe(true);
  expect(frameable(headers({ "content-security-policy": `frame-ancestors 'self' ${origin}` }), origin)).toBe(true);
  // a CSP without frame-ancestors says nothing about framing
  expect(frameable(headers({ "content-security-policy": "default-src 'self'" }), origin)).toBe(true);
});

test("the spot cropped around a pin is centred on it and stays on the page", () => {
  const page = { width: 1280, height: 3000 };
  expect(cropAround(640, 1500, page)).toEqual({ x: 0, y: 1340, width: 1280, height: 320 });
  expect(cropAround(5, 5, page)).toEqual({ x: 0, y: 0, width: 1280, height: 320 });
  expect(cropAround(1279, 2999, page)).toEqual({ x: 0, y: 2680, width: 1280, height: 320 });
  // a page smaller than the crop: the whole page
  expect(cropAround(100, 100, { width: 300, height: 200 })).toEqual({ x: 0, y: 0, width: 300, height: 200 });
});

test("pins from the dashboard are numbered, on the page and noted, or refused in plain words", () => {
  const page = { width: 390, height: 2000 };
  expect(
    cleanPins(
      [
        { x: 100.4, y: 50, note: " Too small " },
        { x: 10, y: 1999, note: "Wrong colour" },
      ],
      page,
    ),
  ).toEqual([
    { n: 1, x: 100, y: 50, note: "Too small" },
    { n: 2, x: 10, y: 1999, note: "Wrong colour" },
  ]);
  expect(cleanPins([], page)).toBe("pin at least one spot");
  expect(cleanPins([{ x: 500, y: 10, note: "x" }], page)).toBe("a pin is off the page");
  expect(cleanPins([{ x: 1, y: 1, note: "  " }], page)).toBe("pin 1 has no note");
  expect(cleanPins("nope", page)).toBe("pin at least one spot");
});

test("pinned notes become the fix round's feedback: where, what, the size it was seen at, and the crop to open", () => {
  const text = pinNotes(
    {
      url: "https://pot-41.preview.example.com",
      viewport: "phone",
      pins: [
        { n: 1, x: 120, y: 640, note: "The button is too small" },
        { n: 2, x: 200, y: 90, note: "Text unclear" },
      ],
    },
    (n) => (n === 1 ? "/ops/proof/POT-41/review/pin-1-before.png" : ""),
  );
  expect(text).toContain("https://pot-41.preview.example.com");
  expect(text).toContain("on a phone (390×844)");
  expect(text).toContain(
    '1. At 120,640 on the page: "The button is too small". The spot as it is now: /ops/proof/POT-41/review/pin-1-before.png',
  );
  // no crop taken: the note still goes, without a file to open
  expect(text).toContain('2. At 200,90 on the page: "Text unclear".\n');
});
