import type { DashboardState } from "@overhand/contract";

type Clients = Pick<DashboardState, "clients">["clients"];

/** Which project a sentence is about, and the request with a leading "Project:" taken off. */
export interface TaskGuess {
  /** Projects, the likeliest first; every project is listed so a wrong guess is one tap to correct. */
  projects: string[];
  /** The guess named the project (its name, ticket prefix or an alias); false when it's only the first in the list. */
  sure: boolean;
  /** What to build, as the person said it. */
  text: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whether `word` appears in `text` as a whole word, ignoring case. */
const says = (text: string, word: string) =>
  word.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${esc(word)}($|[^\\p{L}\\p{N}])`, "iu").test(text);

/**
 * Guesses the project a request is about: by its name, ticket prefix or an alias said anywhere in it ("make the invite
 * page friendlier on Potluck"), a "Project:" lead-in winning outright. With no project named, or two, the guess isn't
 * sure and the list keeps its order. Pure.
 */
export function guessProject(clients: Clients, sentence: string): TaskGuess {
  const raw = sentence.trim();
  const lead = /^([^:]{1,40}):\s*(.+)$/s.exec(raw);
  const led = lead
    ? clients.find((c) => [c.name, c.prefix, ...(c.aliases ?? [])].some((w) => w.toLowerCase() === lead[1]?.trim().toLowerCase()))
    : undefined;
  const text = led && lead?.[2] ? lead[2].trim() : raw;
  const named = led ? [led] : clients.filter((c) => [c.name, c.prefix, ...(c.aliases ?? [])].some((w) => says(raw, w)));
  const first = named.length === 1 ? named[0]?.name : undefined;
  const projects = first ? [first, ...clients.map((c) => c.name).filter((n) => n !== first)] : clients.map((c) => c.name);
  return { projects, sure: Boolean(first), text };
}

/** Whether what's typed in the command bar reads like a request for work rather than a command: three words or more. */
export const looksLikeTask = (text: string): boolean => text.trim().split(/\s+/).length >= 3;
