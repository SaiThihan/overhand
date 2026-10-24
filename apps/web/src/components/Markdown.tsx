import type { ReactNode } from "react";
import { type Block, type Inline, inline } from "@/lib/markdown";

/** Inline marks as React text and elements: nothing is ever set as HTML. */
function Marks({ text }: { text: Inline[] }) {
  return (
    <>
      {text.map((x, i) => {
        const key = `${i}${x.t}`;
        if (x.t === "code")
          return (
            <code key={key} className="rounded bg-muted px-1 font-mono text-[max(11px,0.9em)] break-words">
              {x.text}
            </code>
          );
        if (x.t === "strong")
          return (
            <strong key={key} className="font-semibold">
              {x.text}
            </strong>
          );
        if (x.t === "em") return <em key={key}>{x.text}</em>;
        if (x.t === "link")
          return (
            <a
              key={key}
              href={x.href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-primary underline-offset-2 hover:underline"
            >
              {x.text}
            </a>
          );
        return <span key={key}>{x.text}</span>;
      })}
    </>
  );
}

/** One line of text with its `code`, **bold** and links drawn as such. */
export function InlineMd({ text }: { text: string }) {
  return <Marks text={inline(text)} />;
}

const HEADING = ["text-lg", "text-base", "text-sm", "text-sm", "text-sm", "text-sm"];

/** A Markdown file, verbatim, from `parseMarkdown`'s blocks. */
export function Markdown({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="grid min-w-0 gap-3 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        const key = `${i}${b.t}`;
        let node: ReactNode;
        if (b.t === "h") {
          const cls = `font-display ${HEADING[b.level - 1] ?? "text-sm"} ${b.level <= 2 ? "mt-2" : ""} font-medium leading-snug`;
          const body = <Marks text={b.text} />;
          node =
            b.level === 1 ? (
              <h3 className={cls}>{body}</h3>
            ) : b.level === 2 ? (
              <h4 className={cls}>{body}</h4>
            ) : (
              <h5 className={cls}>{body}</h5>
            );
        } else if (b.t === "p")
          node = (
            <p className="break-words">
              <Marks text={b.text} />
            </p>
          );
        else if (b.t === "list") {
          const items = b.items.map((it, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items in file order; the same words may repeat
            <li key={j} style={{ marginLeft: `${it.depth * 16}px` }} className="break-words">
              <Marks text={it.text} />
            </li>
          ));
          node = b.ordered ? (
            <ol className="ml-5 grid list-decimal gap-1 marker:text-muted-foreground">{items}</ol>
          ) : (
            <ul className="ml-5 grid list-disc gap-1 marker:text-muted-foreground">{items}</ul>
          );
        } else if (b.t === "code")
          node = (
            <pre className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed">
              <code>{b.text}</code>
            </pre>
          );
        else if (b.t === "quote")
          node = (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              <Marks text={b.text} />
            </blockquote>
          );
        else if (b.t === "table")
          node = (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns in file order
                      <th key={j} className="border-b border-border px-2 py-1 font-medium">
                        <Marks text={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows in file order
                    <tr key={j}>
                      {r.map((c, k) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: columns in file order
                        <td key={k} className="border-b border-border/60 px-2 py-1 align-top">
                          <Marks text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        else node = <hr className="border-border" />;
        return <div key={key}>{node}</div>;
      })}
    </div>
  );
}
