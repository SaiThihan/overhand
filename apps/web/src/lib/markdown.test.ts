import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/Markdown";
import { inline, parseMarkdown, safeHref, sectionCount } from "./markdown";

const html = (src: string, base = "") => renderToStaticMarkup(createElement(Markdown, { blocks: parseMarkdown(src, base) }));

test("headings, lists, code blocks, quotes, tables and links", () => {
  const blocks = parseMarkdown(
    [
      "# Shop",
      "",
      "Online ordering for **Honeycrust**, see [the docs](https://example.com/docs).",
      "",
      "## Install",
      "",
      "1. Install bun",
      "2. Run `bun install`",
      "   and wait",
      "",
      "```sh",
      "bun run dev",
      "```",
      "",
      "> Ask in #shop.",
      "",
      "| Script | What |",
      "| --- | --- |",
      "| `dev` | runs it |",
      "",
      "---",
    ].join("\n"),
  );
  expect(blocks.map((b) => b.t)).toEqual(["h", "p", "h", "list", "code", "quote", "table", "hr"]);
  expect(sectionCount(blocks)).toBe(1);
  expect(blocks[3]).toMatchObject({ t: "list", ordered: true, items: [{ depth: 0 }, { depth: 0 }] });
  expect(blocks[4]).toEqual({ t: "code", lang: "sh", text: "bun run dev" });
  expect(inline("a `b` **c** *d* [e](https://x.dev)")).toEqual([
    { t: "text", text: "a " },
    { t: "code", text: "b" },
    { t: "text", text: " " },
    { t: "strong", text: "c" },
    { t: "text", text: " " },
    { t: "em", text: "d" },
    { t: "text", text: " " },
    { t: "link", text: "e", href: "https://x.dev/" },
  ]);
  const out = html("## Run\n\n- `bun dev`\n\n```\nbun test\n```");
  expect(out).toContain("<h4");
  expect(out).toContain("<ul");
  expect(out).toContain("<pre");
});

test("raw HTML in the file is shown as text, never injected", () => {
  const evil = [
    "<script>alert(1)</script>",
    "",
    '<img src=x onerror="alert(1)">',
    "",
    "## <b>bold</b> heading",
    "",
    "- <iframe src=https://evil.example></iframe>",
    "",
    "```html",
    "<div onclick=steal()>x</div>",
    "```",
  ].join("\n");
  const out = html(evil);
  for (const tag of ["<script", "<img", "<b>", "<iframe", "<div onclick"]) expect(out).not.toContain(tag);
  expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(out).toContain("&lt;img src=x onerror=");
  expect(out).not.toMatch(/<[^>]*\son\w+=/); // no event handler on any real element
});

test("links go out only as http(s) or mailto; relative ones resolve against the file's folder", () => {
  expect(safeHref("javascript:alert(1)")).toBe("");
  expect(safeHref("JaVaScRiPt:alert(1)")).toBe("");
  expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("");
  expect(safeHref("vbscript:x")).toBe("");
  expect(safeHref("#install")).toBe("");
  expect(safeHref("docs/setup.md")).toBe(""); // relative, with nowhere to resolve it
  expect(safeHref("mailto:team@example.com")).toBe("mailto:team@example.com");
  const base = "https://github.com/acme/shop/blob/HEAD/";
  expect(safeHref("docs/setup.md", base)).toBe("https://github.com/acme/shop/blob/HEAD/docs/setup.md");
  expect(safeHref("javascript:alert(1)", base)).toBe("");
  const out = html("[click](javascript:alert(1)) and <javascript:alert(2)> and [ok](https://example.com)");
  expect(out).not.toContain('javascript:alert(1)"');
  expect(out).not.toMatch(/href="javascript/i);
  expect(out).toContain('href="https://example.com/"');
  expect(out).toContain('rel="noopener noreferrer"');
});
