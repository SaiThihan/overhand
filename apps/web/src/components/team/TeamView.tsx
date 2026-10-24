/**
 * The Team view on Now (docs/teams.md): each person is a hub, a larger dial with their own rings; the projects they own
 * and back up sit with them; what waits on YOU is the only warm thing on it. Kept apart from the rest of Now, so the
 * visual pass can restyle it without touching anything else: `TeamMap` is pure (props in, markup out, no timers, no
 * animation), and `TeamView` only wires it to the daemon.
 */
import type { Finding, TeamState } from "@overhand/contract";
import type { Words } from "@overhand/themes";
import { type DragEvent, type FormEvent, useState } from "react";
import { toast } from "sonner";
import type { Model } from "@/app/data";
import { useTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HubMap } from "@/map/AttentionMap";
import type { WorldId } from "@/map/worlds";
import { claims, commentsOn, type Hub, hubs, nameIn, type TeamItem, teamItems, viewersOf } from "./model";
import { teamPost, useTeamUi } from "./store";
import { useTeamViewing } from "./viewing";

/** What a hand-off carries: never the finding's text, only what names the work. */
export type Handable = { id: string; project: string; title: string; key: string };
const DRAG = "application/x-overhand-handoff";

/** What the map can ask for. */
export type TeamActs = {
  claim: (item: string, label: string, on: boolean) => void;
  answer: (question: string, text: string) => void;
  handoff: (to: string, h: Handable) => void;
  comment: (item: string, text: string) => void;
  follow: (user: string | null) => void;
  /** An item's thread opened (`item`) or closed (null): shown to the team as a quiet dot. */
  open: (item: string | null, label: string) => void;
};

/**
 * A person's hub: their own small attention map in the active world (their projects in their rings, their name at the
 * centre); offline, it dims.
 */
function Dial({ hub, size, look, w }: { hub: Hub; size: number; look: TeamLook; w: Words }) {
  return (
    <span className={cn("block", !hub.online && "opacity-45")}>
      <HubMap projects={hub.projects} name={hub.initials} me={hub.me} size={size} world={look.world} light={look.light} w={w} />
    </span>
  );
}

/** How the hubs are drawn: the active world, on paper or not. */
export type TeamLook = { world: WorldId; light: boolean };

function HubCard({ hub, w, act, following, look }: { hub: Hub; w: Words; act: TeamActs; following: boolean; look: TeamLook }) {
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    setOver(false);
    const raw = e.dataTransfer.getData(DRAG);
    if (!raw || hub.me) return;
    e.preventDefault();
    try {
      const h: unknown = JSON.parse(raw);
      if (typeof h === "object" && h !== null && "id" in h && "project" in h && "title" in h && "key" in h)
        act.handoff(hub.user, { id: String(h.id), project: String(h.project), title: String(h.title), key: String(h.key) });
    } catch {
      // not ours
    }
  };
  const status = hub.online ? (hub.quiet ? w.teamQuiet : fmt(w.teamWorking, { n: hub.agents })) : w.teamOffline;
  return (
    <li
      className={cn(
        "team-hub grid justify-items-center gap-1 rounded-lg border border-border p-3 text-center",
        over && "border-foreground",
      )}
      onDragOver={(e) => {
        if (hub.me || !e.dataTransfer.types.includes(DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <button
        type="button"
        className="grid justify-items-center gap-1 rounded-full"
        aria-pressed={following}
        aria-label={hub.me ? w.teamYou : fmt(following ? w.teamStopFollow : w.teamFollow, { name: hub.name })}
        onClick={() => (hub.me ? undefined : act.follow(following ? null : hub.user))}
      >
        <Dial hub={hub} size={hub.me ? 188 : 164} look={look} w={w} />
      </button>
      <p className="team-name text-base">{hub.me ? w.teamYou : hub.name}</p>
      <p className="text-xs text-muted-foreground">{status}</p>
      {hub.owns.length ? <p className="text-xs">{fmt(w.teamOwns, { list: hub.owns.join(", ") })}</p> : null}
      {hub.backs.length ? <p className="text-xs text-muted-foreground">{fmt(w.teamBacks, { list: hub.backs.join(", ") })}</p> : null}
    </li>
  );
}

function Marks({ t, item, w }: { t: TeamState; item: string; w: Words }) {
  const on = claims(t).get(item) ?? [];
  const viewers = viewersOf(t, item);
  if (!on.length && !viewers.length) return null;
  return (
    <span className="flex items-center gap-1">
      {on.map((u) => (
        <span
          key={u}
          title={fmt(w.teamClaimed, { name: nameIn(t, u) })}
          className="team-av inline-flex size-5 items-center justify-center rounded-full border border-foreground/70 text-[10px] font-semibold"
        >
          {nameIn(t, u).charAt(0)}
        </span>
      ))}
      {/* a quiet, static dot: someone has it open; no cursor, no animation */}
      {viewers.map((u) => (
        <span
          key={u}
          role="img"
          aria-label={fmt(w.teamViewing, { name: nameIn(t, u) })}
          className="size-2 rounded-full bg-muted-foreground"
        />
      ))}
    </span>
  );
}

function ItemRow({ x, t, w, act }: { x: TeamItem; t: TeamState; w: Words; act: TeamActs }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const me = t.roster.me;
  const mineClaim = (claims(t).get(x.item) ?? []).includes(me);
  const who = nameIn(t, x.by);
  const head =
    x.kind === "question"
      ? fmt(w.teamAsks, { name: who, project: x.project })
      : x.kind === "handoff"
        ? fmt(w.teamHanded, { name: who, title: x.title })
        : x.kind === "mention"
          ? fmt(w.teamMentioned, { name: who })
          : fmt(w.teamResult, { name: who, title: x.title, outcome: x.text, project: x.project });
  const thread = commentsOn(t.log, x.item);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (x.question && x.by !== me) act.answer(x.question, text.trim());
    else act.comment(x.item, text.trim());
    setText("");
  };
  const toggle = () => {
    setOpen(!open);
    act.open(open ? null : x.item, head);
  };
  return (
    <li className={cn("need-row grid gap-1 p-3", x.mine && "border-l-2 border-l-warn")} data-mine={x.mine ? "" : undefined}>
      <div className="flex items-start gap-2">
        <p className={cn("min-w-0 flex-1 text-sm", x.mine && "text-warn")}>{head}</p>
        <Marks t={t} item={x.item} w={w} />
      </div>
      {x.kind !== "result" && x.text ? <p className="text-sm text-muted-foreground">{x.text}</p> : null}
      {x.kind !== "result" ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            variant="outline"
            title={w.teamOnItHint}
            aria-pressed={mineClaim}
            onClick={() => act.claim(x.item, head.slice(0, 80), !mineClaim)}
          >
            {mineClaim ? w.teamRelease : w.teamOnIt}
          </Button>
          <Button size="xs" variant="ghost" aria-expanded={open} onClick={toggle}>
            {x.question && x.by !== me ? w.teamAnswer : w.teamComment}
            {thread.length ? ` (${thread.length})` : ""}
          </Button>
        </div>
      ) : null}
      {open ? (
        <div className="grid gap-1.5">
          {thread.map((c) => (
            <p key={c.id} className="text-xs">
              <b className="font-medium">{nameIn(t, c.by)}</b> {c.text}
            </p>
          ))}
          <form className="flex gap-1.5" onSubmit={submit}>
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
              value={text}
              maxLength={400}
              placeholder={w.teamCommentHint}
              aria-label={x.question && x.by !== me ? w.teamAnswer : w.teamComment}
              onChange={(e) => setText(e.target.value)}
            />
            <Button size="xs" type="submit">
              {w.teamSend}
            </Button>
          </form>
        </div>
      ) : null}
    </li>
  );
}

function HeldRow({ h, t, w, act }: { h: Handable; t: TeamState; w: Words; act: TeamActs }) {
  const others = t.roster.members.filter((m) => m.user !== t.roster.me);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG, JSON.stringify(h));
        e.dataTransfer.effectAllowed = "move";
      }}
      className="need-row flex cursor-grab items-center gap-2 p-2.5"
    >
      <span className="min-w-0 flex-1 truncate text-sm">
        {h.key ? `${h.key} ` : ""}
        {h.title}
        <span className="text-muted-foreground"> · {h.project}</span>
      </span>
      {/* the keyboard and screen-reader way to do what dragging onto a hub does */}
      <select
        aria-label={`${w.teamHandOff} ${h.title}`}
        title={w.teamHandOffHint}
        className="rounded-md border border-border bg-transparent px-1.5 py-1 text-xs"
        value=""
        onChange={(e) => e.target.value && act.handoff(e.target.value, h)}
      >
        <option value="">{w.teamHandOff}</option>
        {others.map((m) => (
          <option key={m.user} value={m.user}>
            {nameIn(t, m.user)}
          </option>
        ))}
      </select>
    </li>
  );
}

/**
 * The Team view itself, pure: the brief, what waits on you, every person as a hub (or, following someone, their map as
 * they see it), the team's items, and what you hold to hand off.
 */
export function TeamMap({
  t,
  w,
  now,
  follow,
  held,
  brief,
  act,
  look,
}: {
  look: TeamLook;
  t: TeamState;
  w: Words;
  now: number;
  follow: string | null;
  held: Handable[];
  brief: string[];
  act: TeamActs;
}) {
  const all = hubs(t);
  const followed = follow ? all.find((h) => h.user === follow) : undefined;
  const list = teamItems(t, now);
  const waiting = list.filter((x) => x.mine);
  return (
    <div className="team-map grid gap-4" data-team={t.roster.team.id}>
      <section aria-label={w.teamBrief} className="grid gap-0.5">
        <h2 className="font-display text-xs tracking-[0.08em] text-muted-foreground">{w.teamBrief}</h2>
        {brief.map((l) => (
          <p key={l} className="text-sm">
            {l}
          </p>
        ))}
        {t.problem ? <p className="text-sm text-muted-foreground">{fmt(w.teamFeedDown, { reason: t.problem })}</p> : null}
      </section>
      {followed ? (
        <section aria-label={fmt(w.teamFollowing, { name: followed.name })} className="grid justify-items-center gap-2">
          <p className="text-sm">{fmt(w.teamFollowing, { name: followed.name })}</p>
          <Dial hub={followed} size={320} look={look} w={w} />
          <ul className="grid w-full max-w-md gap-1">
            {followed.projects.map((p) => (
              <li key={p.name} className="flex justify-between border-b border-border py-1 text-sm">
                <span>{p.name}</span>
                <span className="text-muted-foreground">{p.agents ? fmt(w.teamWorking, { n: p.agents }) : p.state}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" onClick={() => act.follow(null)}>
            {w.teamStopFollow}
          </Button>
        </section>
      ) : (
        <ul aria-label={w.teamHere} className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
          {all.map((h) => (
            <HubCard key={h.user} hub={h} w={w} act={act} following={false} look={look} />
          ))}
        </ul>
      )}
      <section aria-label={w.teamWaits} className="grid gap-2">
        <h2 className={cn("font-display text-xs tracking-[0.08em]", waiting.length ? "text-warn" : "text-muted-foreground")}>
          {waiting.length ? w.teamWaits : w.teamNothingWaits}
        </h2>
        <ul className="grid gap-2">
          {list.map((x) => (
            <ItemRow key={`${x.kind}:${x.item}`} x={x} t={t} w={w} act={act} />
          ))}
        </ul>
      </section>
      {held.length && t.roster.members.length > 1 ? (
        <section aria-label={w.teamHeld} className="grid gap-2">
          <h2 className="font-display text-xs tracking-[0.08em] text-muted-foreground">{w.teamHeld}</h2>
          <p className="text-xs text-muted-foreground">{w.teamHandOffHint}</p>
          <ul className="grid gap-1.5">
            {held.map((h) => (
              <HeldRow key={h.id} h={h} t={t} w={w} act={act} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** What you hold that a teammate's crew could take: findings, as a project, a title and a ticket key. */
const handable = (findings: readonly Finding[]): Handable[] =>
  findings.filter((f) => f.from !== "team" && !f.leak).map((f) => ({ id: f.id, project: f.project, title: f.title, key: f.key }));

/** The Team view on Now, wired to the daemon. */
export function TeamView({ m, brief }: { m: Model; brief: string[] }) {
  const { words: w, theme, light } = useTheme();
  const ui = useTeamUi();
  const [opened, setOpened] = useState<{ item: string; label: string } | null>(null);
  useTeamViewing(opened);
  const t = m.s.team;
  if (!t) return <p className="text-sm text-muted-foreground">{w.teamNone}</p>;
  const run = (action: string, body: object, done?: string) =>
    void teamPost(action, body).then(
      () => (done ? toast(done) : undefined),
      (e: unknown) => toast(e instanceof Error ? e.message : String(e)),
    );
  const act: TeamActs = {
    claim: (item, label, on) => run("claim", { item, label, on }),
    answer: (id, text) => run("answer", { id, text }),
    handoff: (to, h) =>
      run("handoff", { to, project: h.project, title: h.title, key: h.key, note: "" }, fmt(w.teamHandedOff, { name: nameIn(t, to) })),
    comment: (item, text) => run("comment", { item, text }),
    follow: ui.setFollow,
    open: (item, label) => setOpened(item ? { item, label: label.slice(0, 80) } : null),
  };
  return (
    <TeamMap
      t={t}
      w={w}
      now={m.s.now}
      follow={ui.follow}
      held={handable(m.s.findings)}
      brief={brief}
      act={act}
      look={{ world: theme.world, light }}
    />
  );
}
