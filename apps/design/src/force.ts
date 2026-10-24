/**
 * Forced states: hover and keyboard focus shown without a pointer or a keyboard. Every stylesheet rule that styles
 * `:hover`, `:focus-visible` or `:focus` gets a twin that styles `.is-hover` or `.is-focus` instead, in the same place
 * (layer, media query, nesting), so a forced state is the dashboard's own CSS, never a copy of it. A hover twin also
 * drops its `(hover: hover)` guard, so the catalog shows it on touch screens too.
 */
const PSEUDO: [RegExp, string][] = [
  [/:hover\b/g, ".is-hover"],
  [/:focus-visible\b/g, ".is-focus"],
  [/:focus\b(?![-\w])/g, ".is-focus"],
];
const GUARD = /\(hover:\s*hover\)/g;

/** The rule's text with every forced pseudo-class swapped for its class, or null when it has none. */
export function twin(text: string, selector: string): string | null {
  if (!PSEUDO.some(([re]) => new RegExp(re.source).test(selector))) return null;
  return PSEUDO.reduce((t, [re, cls]) => t.replace(re, cls), text).replace(GUARD, "all");
}

type Parent = CSSStyleSheet | CSSGroupingRule | CSSStyleRule;

function walk(parent: Parent): void {
  const rules = parent.cssRules;
  // backwards, so a twin inserted after its rule is never visited
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (r instanceof CSSStyleRule) {
      const t = twin(r.cssText, r.selectorText);
      if (r.cssRules.length) walk(r);
      if (t)
        try {
          parent.insertRule(t, i + 1);
        } catch {
          // a selector this browser can't parse once rewritten: that state just isn't forced
        }
    } else if (r instanceof CSSGroupingRule) walk(r);
  }
}

const done = new WeakSet<CSSStyleSheet>();

/** Adds the forced-state twins to every stylesheet on the page not done yet. */
export function forceStates(doc: Document = document): void {
  for (const sheet of doc.styleSheets) {
    if (done.has(sheet)) continue;
    try {
      // a stylesheet still loading has no rules yet: the next call picks it up
      if (!sheet.cssRules.length) continue;
      walk(sheet);
      done.add(sheet);
    } catch {
      // another origin's stylesheet can't be read; the catalog has none
    }
  }
}
