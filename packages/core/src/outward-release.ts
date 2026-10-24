/**
 * Sending what the outward firewall held, once you've looked: Edit and post (your text, checked again), or Post anyway
 * (the held text, secrets still blanked). Either way it goes where it was going and the finding is closed for good.
 */
import { type Finding, type LeakHit, TeamSendSchema, withMark } from "@overhand/contract";
import { createPr } from "./agent";
import { dropFinding } from "./assign";
import { CFG, CLIENTS, clientOf, shAsync } from "./env";
import { allowOnce, scanOutward } from "./outward";
import { send } from "./team";
import { comment, createTicket, tickets } from "./trackers/index";
import { plainPayload, postBody } from "./updates";

/** The held text's first paragraph and the rest: a ticket's or PR's title and body. */
const split = (text: string): [string, string] => {
  const at = text.indexOf("\n\n");
  return at < 0 ? [text.trim(), ""] : [text.slice(0, at).trim(), text.slice(at + 2)];
};

/** The projects a held message was bound for. */
const destOf = (f: Finding): string[] => {
  const to = f.leak?.payload.to;
  return to !== undefined ? to.split("\n").filter(Boolean) : f.project ? [f.project] : [];
};

/**
 * Sends a held finding: `edited` is your text (null = the held text as it is). Your text is checked again and, unless
 * `force` (you confirmed Post anyway), returned as hits instead of sent. The held text goes only with `force`. Throws
 * with a message the dashboard shows when it can't go.
 */
export async function releaseLeak(f: Finding, edited: string | null, force: boolean): Promise<{ sent: true } | { hits: LeakHit[] }> {
  const leak = f.leak;
  if (!leak) throw new Error("That wasn't held by the outward firewall.");
  if (edited === null && !force) throw new Error("Confirm Post anyway first.");
  const text = edited ?? f.text;
  if (edited !== null && !force) {
    const hits = scanOutward(edited, destOf(f));
    if (hits.length) return { hits };
  }
  const p = leak.payload;
  const project = CLIENTS.find((c) => c.name === f.project);
  switch (leak.kind) {
    case "comment": {
      const c = clientOf(f.key);
      const tk = c ? (await tickets(c, { key: f.key }).catch(() => []))[0] : undefined;
      if (!tk) throw new Error(`${f.key} isn't there any more.`);
      await comment(tk, text, "owner", true);
      break;
    }
    case "ticket": {
      if (!project) throw new Error(`No project ${f.project}.`);
      const [title, body] = split(text);
      await createTicket(project, title, body, p.label ?? "", "owner", true);
      break;
    }
    case "pr": {
      const [title, body] = split(text);
      const host = p.host === "bitbucket" ? "bitbucket" : "github";
      const flags = (p.flags ?? "").split(" ").filter(Boolean);
      // ponytail: a released PR isn't tracked for fix rounds; it's on the code host, and its review comes from there
      await createPr({ host, dir: p.dir ?? "", branch: p.branch ?? "", base: p.base ?? "", title, body, flags });
      break;
    }
    case "pr-comment": {
      const r = await shAsync(["gh", "pr", "comment", p.number ?? "", "-R", p.repo ?? "", "--body", withMark(text)]);
      if (!r.ok) throw new Error(`gh pr comment: ${r.err.slice(0, 200)}`);
      break;
    }
    case "update": {
      const ch = CFG.updates.find((u) => u.id === p.channel);
      if (!ch) throw new Error("That status channel is gone.");
      const error = await postBody(ch, edited === null ? (p.body ?? "") : plainPayload(ch.kind, text), Date.now());
      if (error) throw new Error(error);
      break;
    }
    case "team": {
      const m = TeamSendSchema.safeParse(JSON.parse(p.msg ?? "null"));
      if (!m.success) throw new Error("That team message can't be read any more.");
      const msg = m.data;
      // your words replace the message's own: its text, else its note, else its title
      const out =
        edited === null
          ? msg
          : "text" in msg
            ? { ...msg, text: edited }
            : "note" in msg
              ? { ...msg, note: edited }
              : "title" in msg
                ? { ...msg, title: edited }
                : msg;
      if (!send(out, true)) throw new Error("Not connected to the team right now, or it's too long.");
      break;
    }
    case "agent":
      // the agent sends its own command: Post anyway lets that same text through when it tries again
      if (edited !== null) throw new Error("The agent writes its own text: Post anyway, or Dismiss and tell it what to change.");
      allowOnce(f.id);
      break;
  }
  // dismissed, so the same text isn't held again
  dropFinding(f.id, true);
  return { sent: true };
}
