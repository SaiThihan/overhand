import { expect, spyOn, test } from "bun:test";
import { type FeedbackPreview, REPO_URL } from "@overhand/contract";
import { plainWords as w } from "@overhand/themes";
import { render, withDom } from "../render.test-util";

/**
 * Suggest or report, rendered: Preview shows the exact issue and asks the daemon for nothing but the draft; only Send
 * posts, and while the firewall marks a word Send waits for an edit.
 */
withDom();

const button = (el: HTMLElement, name: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === name);
/** Types into a React-controlled field. */
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const { act } = await import("react");
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(b: HTMLElement | undefined) {
  const { act } = await import("react");
  await act(async () => {
    b?.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

test("Preview sends nothing; Send waits for an edit while a word is marked, then posts the exact text once", async () => {
  const calls: { url: string; body: unknown }[] = [];
  let preview: FeedbackPreview = {
    title: "Honeycrust map",
    body: "It flickers.",
    hits: { title: [{ start: 0, end: 10, term: "Honeycrust", why: "project", project: "Honeycrust" }], body: [] },
    via: "gh",
    login: "octo",
  };
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: string | URL | Request, init?: RequestInit) => {
        // the state stays in flight, as everywhere in these tests
        if (!String(url).startsWith("/api/feedback/")) return new Promise<Response>(() => {});
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        const out = String(url).endsWith("/preview") ? preview : { via: "gh", url: `${REPO_URL}/issues/7` };
        return new Response(JSON.stringify(out));
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const { FeedbackDrawer } = await import("./FeedbackDrawer");
  const el = await render(() => <FeedbackDrawer />, false, true);
  expect(el.textContent).toContain(w.feedbackIdea);
  expect(button(el, w.feedbackPreview)?.disabled).toBe(true);
  const title = el.querySelector("input");
  if (!title) throw new Error("no title field");
  await type(title, "Honeycrust map");
  await click(button(el, w.feedbackPreview));

  // the preview: the public note, the marked word, Send blocked until an edit; only the draft was asked for
  expect(calls.map((c) => c.url)).toEqual(["/api/feedback/preview"]);
  expect(calls[0]?.body).toEqual({ kind: "idea", title: "Honeycrust map", details: "", diagnostics: false });
  expect(el.textContent).toContain(w.feedbackPublic);
  expect(el.querySelector("mark")?.textContent).toBe("Honeycrust");
  expect(button(el, w.feedbackSend)?.disabled).toBe(true);

  const issueTitle = el.querySelector("input");
  if (!issueTitle) throw new Error("no issue title field");
  preview = { ...preview, title: "The map" };
  await type(issueTitle, "The map");
  expect(calls).toHaveLength(1);
  await click(button(el, w.feedbackSend));
  expect(calls.map((c) => c.url)).toEqual(["/api/feedback/preview", "/api/feedback/send"]);
  expect(calls[1]?.body).toEqual({ title: "The map", body: "It flickers." });
});
