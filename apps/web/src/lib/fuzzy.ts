/**
 * The command bar's matching: forgiving of typos, strict about order. An exact keyword ranks first, then a prefix, a
 * word's prefix, a substring, every word of a longer query, then a word a typo or two away ("thehe" finds Theme), and
 * last the letters in order. 0 hides the line. cmdk sorts by it.
 */

/** Edits (insert, delete, substitute, swap two neighbours) between `a` and `b`, stopping early past `max`. */
export function distance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, (prev2[j - 2] ?? 0) + 1);
      row.push(d);
      least = Math.min(least, d);
    }
    if (least > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length] ?? max + 1;
}

/** Typos a query word may carry: none up to two letters, one up to five, two beyond. */
const slack = (n: number) => (n <= 2 ? 0 : n <= 5 ? 1 : 2);

/** Whether `q`'s letters appear in `v` in order. */
const inOrder = (q: string, v: string) => {
  let at = 0;
  for (const ch of q) {
    at = v.indexOf(ch, at) + 1;
    if (!at) return false;
  }
  return true;
};

/** How well `search` matches a command line's `value`, 0 (hidden) to 1 (its keyword, exactly). */
export function fuzzyScore(value: string, search: string): number {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const v = value.toLowerCase();
  const words = v.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  if (words[0] === q) return 1;
  if (v.startsWith(q)) return 0.95;
  if (words.some((w) => w.startsWith(q))) return 0.85;
  if (v.includes(q)) return 0.75;
  const terms = q.split(/\s+/);
  if (terms.length > 1 && terms.every((t) => words.some((w) => w.startsWith(t)))) return 0.7;
  // a typo or two: each word of the query is near a word of the line (or the start of one, while still typing)
  let edits = 0;
  for (const t of terms) {
    const most = slack(t.length);
    const near = Math.min(...words.map((w) => Math.min(distance(t, w, most), distance(t, w.slice(0, t.length), most))));
    if (near > most) {
      edits = -1;
      break;
    }
    edits += near;
  }
  if (edits >= 0) return Math.max(0.3, 0.6 - edits * 0.1);
  // last, the letters in order inside one word ("hlth" finds health), never strung across a whole line
  return q.length > 2 && words.some((w) => inOrder(q, w)) ? 0.1 : 0;
}
