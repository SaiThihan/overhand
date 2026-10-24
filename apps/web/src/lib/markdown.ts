/**
 * A small, safe Markdown reader for repo files the dashboard shows verbatim (the onboarding guide): headings, lists,
 * fenced code, quotes, tables, links, `code`, **bold** and *italic*. It returns plain data that React renders as text, so
 * raw HTML in the file shows as the characters it is and never becomes markup. Links go out only as http(s) or mailto.
 */

export type Inline = { t: "text" | "code" | "strong" | "em"; text: string } | { t: "link"; text: string; href: string };

export type Block =
  | { t: "h"; level: number; text: Inline[] }
  | { t: "p"; text: Inline[] }
  | { t: "list"; ordered: boolean; items: { depth: number; text: Inline[] }[] }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; text: Inline[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

/**
 * A link's target, or "" when it mustn't be one: only http, https and mailto, with relative paths resolved against
 * `base` (the file's folder on the code host) when there is one. `javascript:`, `data:` and the like never pass.
 */
export function safeHref(href: string, base = ""): string {
  if (!href || href.startsWith("#")) return "";
  try {
    const u = base ? new URL(href, base) : new URL(href);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

const INLINE =
  /(`+)([^`]+?)\1|\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<((?:https?:\/\/|mailto:)[^>\s]+)>|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*/g;

/** One line's inline marks, in order. A link that isn't safe stays as its text. */
export function inline(text: string, base = ""): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: "text", text: text.slice(last, i) });
    last = i + m[0].length;
    const [, , code, label, href, auto, bold, bold2, em] = m;
    if (code !== undefined) out.push({ t: "code", text: code.trim() });
    else if (label !== undefined) {
      const h = safeHref(href ?? "", base);
      out.push(h ? { t: "link", text: label, href: h } : { t: "text", text: label });
    } else if (auto !== undefined) {
      const h = safeHref(auto);
      out.push(h ? { t: "link", text: auto, href: h } : { t: "text", text: auto });
    } else if (bold !== undefined || bold2 !== undefined) out.push({ t: "strong", text: bold ?? bold2 ?? "" });
    else out.push({ t: "em", text: em ?? "" });
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) });
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** The file as blocks. `base` resolves relative links (see `safeHref`). */
export function parseMarkdown(src: string, base = ""): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: inline(para.join(" "), base) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      const close = fence[1] ?? "```";
      for (i++; i < lines.length && !(lines[i] ?? "").trim().startsWith(close); i++) body.push(lines[i] ?? "");
      out.push({ t: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    if (!line.trim() || /^\s*<!--.*-->\s*$/.test(line)) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: (h[1] ?? "#").length, text: inline(h[2] ?? "", base) });
      continue;
    }
    if (/^\s*(?:\*\s*){3,}$|^\s*(?:-\s*){3,}$|^\s*(?:_\s*){3,}$/.test(line)) {
      flush();
      out.push({ t: "hr" });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i] ?? ""); i++) body.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
      i--;
      out.push({ t: "quote", text: inline(body.join(" "), base) });
      continue;
    }
    const sep = lines[i + 1] ?? "";
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(sep) && sep.includes("-")) {
      flush();
      const head = cells(line).map((c) => inline(c, base));
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim(); i++)
        rows.push(cells(lines[i] ?? "").map((c) => inline(c, base)));
      i--;
      out.push({ t: "table", head, rows });
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const items: { depth: number; text: Inline[] }[] = [];
      const ordered = /\d/.test(item[2] ?? "");
      for (; i < lines.length; i++) {
        const l = lines[i] ?? "";
        const it = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
        if (it)
          items.push({ depth: Math.min(Math.floor((it[1] ?? "").replace(/\t/g, "  ").length / 2), 4), text: inline(it[3] ?? "", base) });
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) {
          // a wrapped line continues the item above it
          const prev = items[items.length - 1];
          if (prev) prev.text = [...prev.text, { t: "text", text: " " }, ...inline(l.trim(), base)];
        } else break;
      }
      i--;
      out.push({ t: "list", ordered, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** How many `##` sections a guide has (its summary line counts them). */
export const sectionCount = (blocks: readonly Block[]): number => blocks.filter((b) => b.t === "h" && b.level === 2).length;
