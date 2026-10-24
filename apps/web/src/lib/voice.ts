import type { ThemeDefinition } from "@overhand/themes";
import { useSyncExternalStore } from "react";

// the removed in-page voice kept its 28 MB model in Cache Storage: give the space back
if (typeof caches !== "undefined") void caches.delete("overhand-voice-1").catch(() => {});

/** A ticket number as people say it: 142 "one forty-two", 1204 "twelve oh four", 88 as it is. */
const ticketNumber = (n: string): string => {
  if (n.length < 3) return n;
  const tail = n.slice(-2);
  return [n.slice(0, -2), tail.startsWith("0") ? `oh ${tail.slice(1)}` : tail].join(" ");
};

/** Text as any voice reads it best: a ticket key "HONEY-142" is "Honey one forty-two", not "honey minus 142". */
export const spoken = (text: string): string =>
  text.replace(/\b([A-Z][A-Z0-9]*)-(\d+)\b/g, (_, p: string, n: string) =>
    [p.charAt(0) + p.slice(1).toLowerCase(), ticketNumber(n)].join(" "),
  );

/**
 * The browser voice for a theme: the first of its preferred names this device has, else any British English voice,
 * else the browser's default (null).
 */
export function pickVoice<V extends { name: string; lang: string }>(voices: readonly V[], prefer: readonly string[]): V | null {
  for (const name of prefer) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return voices.find((x) => /en-GB/.test(x.lang)) ?? null;
}

/** The line being said now, if any: only its own end clears it, so a line cut off by the next one doesn't. */
let current: SpeechSynthesisUtterance | null = null;
const talkers = new Set<() => void>();
const said = (u: SpeechSynthesisUtterance | null): void => {
  current = u;
  for (const l of talkers) l();
};
/** Escape stops the voice, wherever focus is. */
const onKey = (e: KeyboardEvent): void => {
  if (e.key === "Escape") stopSpeaking();
};

/**
 * Says a line with the browser's own voice, in the theme's character (its preferred voice, rate and pitch); a new
 * line cuts off the one before, and Escape stops it. Silent where the browser has no speech synthesis: the briefing's
 * text stays on screen.
 */
export function speak(text: string, theme: Pick<ThemeDefinition, "voice">): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(spoken(text));
  u.voice = pickVoice(speechSynthesis.getVoices(), theme.voice.prefer);
  u.rate = theme.voice.rate;
  u.pitch = theme.voice.pitch;
  u.onend = u.onerror = () => {
    if (current === u) stopSpeaking();
  };
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  addEventListener("keydown", onKey);
  addEventListener("pagehide", stopSpeaking);
  said(u);
}

/** Stops the voice at once, mid-word; nothing when it's quiet. */
export function stopSpeaking(): void {
  if (!current) return;
  removeEventListener("keydown", onKey);
  removeEventListener("pagehide", stopSpeaking);
  said(null);
  speechSynthesis.cancel();
}

const subscribe = (l: () => void): (() => void) => {
  talkers.add(l);
  return () => talkers.delete(l);
};

/** Whether the voice is speaking now: what turns Brief me into Stop. */
export function useSpeaking(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => current !== null,
    () => false,
  );
}

/** The parts of the Web Speech recognition API the mic button uses (not yet in TypeScript's DOM types). */
export interface Recognition {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;
declare global {
  interface Window {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  }
}

/** A speech recogniser, or null when the browser has none (the mic button then hides). */
export function recognition(): Recognition | null {
  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}
