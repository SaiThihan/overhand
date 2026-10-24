import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clientByText, HOME, http, statusTokens } from "../env";
import type { UiDeploy } from "./types";

/** The Vercel CLI's own login token (`vercel login`), from its data folder on macOS or Linux; "" when signed out. */
export function vercelCliToken(home = HOME): string {
  const data =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : (process.env.XDG_DATA_HOME ?? join(home, ".local", "share"));
  const authFile = join(data, "com.vercel.cli", "auth.json");
  try {
    const j: unknown = existsSync(authFile) ? JSON.parse(readFileSync(authFile, "utf8")) : null;
    return typeof j === "object" && j !== null && "token" in j && typeof j.token === "string" ? j.token : "";
  } catch {
    return "";
  }
}

/** Recent Vercel deployments, using the Vercel CLI's existing login (read-only). */
export async function vercelDeploys(): Promise<UiDeploy[] | string> {
  const cli = vercelCliToken();
  // project tokens first, so a deploy their scope sees is credited to that project rather than matched by name
  const tokens = [...statusTokens("vercelSecrets"), ...(cli ? [{ token: cli, client: "" }] : [])];
  if (!tokens.length) return "Vercel CLI isn't logged in";
  const out: UiDeploy[] = [];
  const seen = new Set<string>(); // teams first, so a project listed in a team isn't repeated under the personal scope
  for (const { token, client } of tokens) {
    const h = { headers: { Authorization: `Bearer ${token}` } };
    const teams = (await http<{ teams: { id: string; slug: string; name: string }[] }>("https://api.vercel.com/v2/teams", h)).teams;
    for (const scope of [...teams, { id: "", slug: "personal", name: "personal" }]) {
      const q = scope.id ? `&teamId=${scope.id}` : "";
      const d = await http<{
        deployments: { name: string; url: string; state?: string; readyState?: string; target: string | null; created: number }[];
      }>(`https://api.vercel.com/v6/deployments?limit=20${q}`, h).catch(() => ({ deployments: [] }));
      for (const x of d.deployments) {
        if (seen.has(x.name) || x.target !== "production") continue;
        seen.add(x.name);
        out.push({
          client: client || clientByText(`${scope.slug} ${scope.name} ${x.name}`),
          project: x.name,
          state: x.state ?? x.readyState ?? "",
          target: x.target ?? "preview",
          url: `https://${x.url}`,
          created: x.created,
        });
      }
    }
  }
  return out;
}
