import type { Model } from "@/app/data";
import { useWords } from "@/app/theme";
import { brokenCount } from "@/lib/alerts";
import { explainSystems } from "@/lib/explain";
import { fmt } from "@/lib/format";
import { Explain } from "../Explain";
import { Dot, Pane } from "../Pane";

/** One client's CI, latest deploy and errors as three dots: green fine, starlight running, amber attention, red broken. */
function ClientDots({ name, m }: { name: string; m: Model }) {
  const w = useWords();
  const st = m.s.status;
  const ci = st.ci.filter((c) => c.client === name);
  const deploy = Array.isArray(st.deploys) ? st.deploys.find((d) => d.client === name) : undefined;
  const errs = Array.isArray(st.sentry) ? st.sentry.filter((i) => i.client === name) : [];
  const quiet = "var(--muted-foreground)";
  const ciColor = ci.some((c) => c.state === "fail")
    ? "var(--bad)"
    : ci.some((c) => c.state === "running")
      ? "var(--primary)"
      : ci.some((c) => c.state === "pass")
        ? "var(--ok)"
        : quiet;
  const ciText = ci.length ? `CI: ${ci.map((c) => `${c.repo} ${c.state}`).join(", ")}` : `CI: ${w.noRepos}`;
  const depColor = !deploy
    ? quiet
    : /ERROR|CANCELED/.test(deploy.state)
      ? "var(--bad)"
      : deploy.state === "READY"
        ? "var(--ok)"
        : "var(--primary)";
  const errColor = errs.some((e) => e.isNew) ? "var(--bad)" : errs.length ? "var(--warn)" : "var(--ok)";
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-2 py-1 text-sm">
      <span className="truncate" style={{ color: m.hue(name) }}>
        {name}
      </span>
      <span className="flex items-center gap-2.5">
        <Dot color={ciColor} label={ciText} />
        <Dot color={depColor} label={deploy ? `Deploy ${deploy.project}: ${deploy.state}` : "Deploy: none"} />
        <Dot color={errColor} label={fmt(w.errorsToday, { n: errs.length })} />
        <Explain x={explainSystems(ci, deploy, errs, w)} about={name} />
      </span>
    </li>
  );
}

/** The bridge's view of health: per client, CI, deploys and errors at a glance. The full picture is in the Health view. */
export function Systems({ m }: { m: Model }) {
  return (
    <Pane title="paneSystems" count={brokenCount(m.s)} countTone="var(--bad)" view="health">
      <ul className="divide-y divide-border">
        {m.s.clients.map((c) => (
          <ClientDots key={c.name} name={c.name} m={m} />
        ))}
      </ul>
    </Pane>
  );
}
