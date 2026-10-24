import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useWords } from "@/app/theme";
import { GithubFix, Mark, type Tone } from "@/components/Connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { get, post } from "@/lib/api";
import { ago, fmt } from "@/lib/format";
import { nth } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ProblemSchema = z.object({ owner: z.string(), message: z.string(), fix: z.string() });

/** `GET /api/projects/github`: every repo the GitHub sign-in can pick, and owners it couldn't read with their fix. */
const ReposSchema = z.object({
  repos: z.array(z.object({ owner: z.string(), name: z.string(), private: z.boolean(), pushedAt: z.string(), language: z.string() })),
  problems: z.array(ProblemSchema),
});

/** A project the ready repos make, as setup and Settings add it. */
const ProposedSchema = z.object({
  name: z.string(),
  dir: z.string(),
  prefix: z.string(),
  trackerRepo: z.string(),
  trackerRepos: z.array(z.string()).default([]),
  repos: z.array(z.string()),
});
export type Proposed = z.infer<typeof ProposedSchema>;

/** `GET /api/projects/added`: each repo on its way into the projects folder, and the projects the ready ones make. */
const AddedSchema = z.object({
  projectsDir: z.string(),
  additions: z.array(
    z.object({
      owner: z.string(),
      name: z.string(),
      url: z.string(),
      state: z.enum(["looking", "cloning", "ready", "failed"]),
      via: z.enum(["copy", "clone", ""]),
      copy: z
        .object({ path: z.string(), committed: z.number(), branch: z.string(), defaultBranch: z.string(), dirty: z.boolean() })
        .nullable(),
      others: z.array(z.string()),
      problem: ProblemSchema.nullable(),
    }),
  ),
  projects: z.array(ProposedSchema),
});
type Addition = z.infer<typeof AddedSchema>["additions"][number];

const POLL_MS = 1500;

/** A fix to act on: a command to copy, or a page to open. */
function Fix({ fix }: { fix: string }) {
  if (!fix) return null;
  return fix.startsWith("https://") ? (
    <a className="w-fit text-sm break-all text-primary underline" href={fix} target="_blank" rel="noopener noreferrer">
      {fix}
    </a>
  ) : (
    <code className="w-fit rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-sm select-all">{fix}</code>
  );
}

const tone = (a: Addition): Tone => (a.state === "ready" ? "ok" : a.state === "failed" ? "warn" : "pending");

/**
 * Projects from GitHub: pick from your repos and your organisations' (searchable, grouped by owner, private or public,
 * language and last push), or paste a URL. Overhand uses a copy you already have, else clones its own, and shows each
 * repo's progress; a failure says what fixes it. `onReady` gets the projects the ready repos make, as they land.
 */
export function AddProjects({
  codeRoot = "",
  githubAsked = false,
  onReady,
  className,
  style,
}: {
  codeRoot?: string;
  /** Setup already asks for GitHub's sign-in in amber, so the list leaves its own note out. */
  githubAsked?: boolean;
  onReady: (projects: Proposed[]) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const w = useWords();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const repos = useQuery({ queryKey: ["projects-github"], queryFn: () => get("/api/projects/github", ReposSchema), staleTime: 5 * 60_000 });
  const addedKey = ["projects-added", codeRoot];
  const added = useQuery({
    queryKey: addedKey,
    queryFn: () => get(`/api/projects/added${codeRoot ? `?codeRoot=${encodeURIComponent(codeRoot)}` : ""}`, AddedSchema),
    // while something is being looked for or cloned, look again every moment
    refetchInterval: (q) => (busy || q.state.data?.additions.some((a) => a.state === "looking" || a.state === "cloning") ? POLL_MS : false),
  });
  const additions = added.data?.additions ?? [];
  const byKey = new Map(additions.map((a) => [`${a.owner}/${a.name}`.toLowerCase(), a]));
  const projects = added.data?.projects;
  const readyKey = projects?.map((p) => `${p.dir}:${p.repos.join(",")}`).join(" ") ?? "";

  // the projects the ready repos make reach setup or Settings as each one lands
  // biome-ignore lint/correctness/useExhaustiveDependencies: readyKey stands for projects; onReady is the caller's
  useEffect(() => {
    if (projects) onReady(projects);
  }, [readyKey]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = new Map<string, NonNullable<typeof repos.data>["repos"]>();
    for (const r of repos.data?.repos ?? [])
      if (!q || `${r.owner}/${r.name} ${r.language}`.toLowerCase().includes(q)) out.set(r.owner, [...(out.get(r.owner) ?? []), r]);
    return [...out];
  }, [repos.data, search]);

  const add = async (inputs: string[], fresh = false) => {
    setError("");
    setBusy(true);
    try {
      await post("/api/projects/add", { repos: inputs, fresh, codeRoot }, z.object({ ok: z.boolean() }));
      setTicked(new Set());
      setPaste("");
      await qc.invalidateQueries({ queryKey: addedKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // keep polling a moment: the server looks for copies before the first state shows
      setTimeout(() => setBusy(false), POLL_MS * 2);
    }
  };
  const toggle = (k: string) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const looking = additions.some((a) => a.state === "looking");
  const noList = repos.data !== undefined && repos.data.repos.length === 0 && repos.data.problems.length > 0;

  return (
    <section className={cn("hud-pane gap-3", className)} style={style} aria-labelledby="add-projects">
      <header className="grid gap-1">
        <h2 id="add-projects" className="font-display text-base tracking-wide">
          {w.setupPickTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{w.setupPickHint}</p>
      </header>

      {/* no GitHub CLI or signed out (owner ""): a quiet note with the one fix; setup asks for it in amber instead */}
      {repos.data?.problems.map((p) =>
        p.owner === "" ? (
          githubAsked ? null : (
            <div key="gh" className="grid gap-1.5 text-sm text-muted-foreground">
              {p.message}
              <GithubFix installed={!p.fix.startsWith("https://")} />
            </div>
          )
        ) : (
          <div key={p.owner} role="alert" className="grid gap-1.5 rounded-lg border border-warn/50 bg-warn/5 p-3 text-sm">
            <span className="flex items-start gap-2">
              <Mark tone="warn" />
              {p.message}
            </span>
            <Fix fix={p.fix} />
          </div>
        ),
      )}

      {/* nothing to pick from (no GitHub CLI, or signed out): the paste box alone, under what fixes it */}
      {noList ? null : (
        <>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={w.setupPickSearch}
            placeholder={w.setupPickSearch}
          />
          <div className="grid max-h-80 gap-3 overflow-y-auto rounded-lg border border-border bg-background/40 p-2">
            {repos.isPending ? (
              <SkeletonRows label={w.setupPickLoading} rows={4} row="h-8" className="p-1" />
            ) : repos.isError ? (
              <p className="p-1 text-sm text-warn">{repos.error.message}</p>
            ) : groups.length === 0 ? (
              <p className="p-1 text-sm text-muted-foreground">{w.setupPickEmpty}</p>
            ) : (
              groups.map(([owner, rs]) => (
                <fieldset key={owner} className="grid gap-1">
                  <legend className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
                    {owner} · {rs.length}
                  </legend>
                  {rs.map((r) => {
                    const k = `${r.owner}/${r.name}`;
                    const a = byKey.get(k.toLowerCase());
                    const meta = [
                      r.private ? w.setupPickPrivate : w.setupPickPublic,
                      r.language,
                      r.pushedAt ? ago(Date.parse(r.pushedAt)) : "",
                    ].filter(Boolean);
                    return (
                      <label
                        key={k}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted has-disabled:cursor-default"
                      >
                        {/* added (or on its way): ticked for good, with its progress mark */}
                        <input
                          type="checkbox"
                          checked={ticked.has(k) || (a !== undefined && a.state !== "failed")}
                          disabled={a !== undefined && a.state !== "failed"}
                          onChange={() => toggle(k)}
                          className="size-4 accent-(--primary)"
                          aria-label={k}
                        />
                        {/* on a phone the facts go under the name, so the name keeps its room */}
                        <span className="grid min-w-0 flex-1 gap-0.5 sm:flex sm:items-center sm:gap-3">
                          <span className="min-w-0 truncate text-sm font-medium sm:flex-1">{r.name}</span>
                          <span className="truncate text-xs text-muted-foreground sm:shrink-0">{meta.join(" · ")}</span>
                        </span>
                        {a ? <Mark key={a.state} tone={tone(a)} /> : null}
                      </label>
                    );
                  })}
                </fieldset>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={!ticked.size || busy} onClick={() => void add([...ticked])}>
              {fmt(w.setupPickAdd, { n: ticked.size })}
            </Button>
          </div>
        </>
      )}

      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (paste.trim()) void add([paste.trim()]);
        }}
      >
        <label htmlFor="paste-repo" className="text-xs text-muted-foreground">
          {w.setupPickPaste}
        </label>
        <div className="flex gap-2">
          <Input
            id="paste-repo"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="outline" disabled={!paste.trim() || busy}>
            {w.setupPickPasteAdd}
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      {additions.length || busy ? (
        <ul className="m-stagger grid gap-2" aria-live="polite">
          {looking || (busy && !additions.length) ? (
            <li>
              <SkeletonRows label={w.setupPickLooking} rows={1} row="h-11 rounded-lg" />
            </li>
          ) : null}
          {additions.map((a, i) => (
            <li key={`${a.owner}/${a.name}`} style={nth(i)} className="grid gap-1.5 rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-3">
                <Mark key={a.state} tone={tone(a)} />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {a.owner}/{a.name}
                </span>
                <span className={cn("text-xs", a.state === "failed" ? "text-warn" : "text-muted-foreground")}>
                  {a.state === "ready" ? w.setupPickReady : a.state === "cloning" ? w.setupPickCloning : a.state === "looking" ? "…" : ""}
                </span>
              </div>
              {a.via === "copy" && a.copy ? (
                <div className="grid gap-1 pl-8 text-sm">
                  <span>{fmt(w.setupPickCopy, { path: a.copy.path })}</span>
                  {a.copy.dirty || (a.copy.defaultBranch && a.copy.branch !== a.copy.defaultBranch) ? (
                    <span className="text-xs text-muted-foreground">{w.setupPickCopyNote}</span>
                  ) : null}
                  {a.others.length ? (
                    <span className="text-xs text-muted-foreground">{fmt(w.setupPickOthers, { n: a.others.length })}</span>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void add([a.url], true)}>
                    {w.setupPickFresh}
                  </Button>
                </div>
              ) : null}
              {a.problem ? (
                <div className="grid gap-1.5 pl-8 text-sm">
                  <span>{a.problem.message}</span>
                  <Fix fix={a.problem.fix} />
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void add([a.url])}>
                    {w.setupPickRetry}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
