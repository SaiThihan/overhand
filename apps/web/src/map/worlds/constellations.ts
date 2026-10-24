/**
 * Four constellations from DiceBear's “Constellation” style (https://www.dicebear.com), CC0 1.0, as plain data: the
 * lines between stars, the stars, and a ring round the brightest. Drawn in a 100-unit box. Originals and credits are in
 * docs/design/assets/dicebear and docs/design/CREDITS.md.
 */
export interface Constellation {
  lines: string;
  stars: [number, number, number][];
  rings: [number, number, number][];
}

export const CONSTELLATIONS: Constellation[] = [
  {
    lines: "m71.2 63.9-13.9-2.6m0 0-12.8-9.5M24.7 35.9l19.8 15.9m0 0 5.3-5.7m0 0 2.6-5.1",
    stars: [
      [71.2, 63.9, 2.4],
      [57.3, 61.3, 1.8],
      [52.4, 41, 1.5],
      [49.8, 46.1, 1.7],
      [44.5, 51.8, 2.1],
      [24.7, 35.9, 2.1],
    ],
    rings: [[71.2, 63.9, 4]],
  },
  {
    lines: "M36 36h28m0 0v28m0 0H36m0 0V36",
    stars: [
      [36, 36, 1.5],
      [64, 36, 1.9],
      [64, 64, 1.5],
      [36, 64, 1.9],
      [50, 50, 2.4],
      [43, 43, 1.9],
      [57, 43, 1.5],
      [43, 57, 1.9],
      [57, 57, 1.5],
    ],
    rings: [[50, 50, 4]],
  },
  {
    lines: "m25.7 34.2 11.2 15.7m0 0 14.4-1.3m0 0 9.1 16.3m0 0 15.3-12.5",
    stars: [
      [75.7, 52.4, 2.1],
      [60.4, 64.9, 2.1],
      [51.3, 48.6, 2.4],
      [36.9, 49.9, 2],
      [25.7, 34.2, 1.8],
    ],
    rings: [[51.3, 48.6, 4]],
  },
  {
    lines: "m68.7 36.7 3.7 10.2m0 0-13.6 8.2m0 0-6.5-6.2m0 0 16.4-12.2M52.3 48.9l-10.6 1.7m0 0-8.6.7m0 0-10.2 9.1",
    stars: [
      [72.4, 46.9, 2],
      [68.7, 36.7, 2.1],
      [58.8, 55.1, 1.9],
      [52.3, 48.9, 1.7],
      [41.7, 50.6, 2.4],
      [33.1, 51.3, 2],
      [22.9, 60.4, 2.1],
    ],
    rings: [[41.7, 50.6, 4]],
  },
];
