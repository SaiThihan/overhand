import { SYSTEM } from "@overhand/themes";
import { type CSSProperties, useEffect, useRef, useState } from "react";

/**
 * The motion system's clock in milliseconds, for the few timings JavaScript needs; it is the system's own
 * (packages/themes/src/system.ts), which system.css writes as --m-* custom properties. Spec: docs/design-system.md, "Motion".
 */
export const MOTION = SYSTEM.motion;

/** Whether the viewer prefers reduced motion: every pattern then becomes an instant state change. */
export function reduced(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Keyframes that ease from rest to `to` over the first `f` of the time, hold it, and ease back over the last `f`. */
const held = (to: Keyframe, rest: Keyframe, f: number): Keyframe[] => [rest, { ...to, offset: f }, { ...to, offset: 1 - f }, rest];

/**
 * A live piece's one focus (piece.tsx, on the site's pages), once its moment has played: everything else in `root`
 * dims, `el` lifts with a soft ring (`.m-ring`'s shadow), its state mark locks on (`.dot`) and its recommended answer
 * pulses once; after `hold` it all settles back and stays still. Each is a Web Animation on transform or opacity, eased
 * in and out over the slow clock, so it never touches the CSS `animation` a card already has (its entrance): settling
 * cancels only these. Under reduced motion it does nothing. Returns a function that settles it at once.
 */
export function focusOnce(el: Element, root: Element, hold: number = MOTION.hold): () => void {
  if (reduced()) return () => {};
  // the rest: the siblings of `el` and of each of its ancestors inside `root`, never an ancestor itself
  const rest: Element[] = [];
  for (let n: Element | null = el; n && n !== root && root.contains(n); n = n.parentElement)
    rest.push(...[...(n.parentElement?.children ?? [])].filter((x) => x !== n));
  const f = Math.min(0.5, MOTION.slow / hold);
  const timing = { duration: hold, easing: MOTION.arrive };
  const lift = `translateY(${-MOTION.rise / 3}px) scale(${MOTION.lift})`;
  const dot = el.querySelector(".dot");
  el.classList.add("m-ring");
  dot?.classList.add("m-lockon");
  const runs = [
    el.animate(held({ transform: lift }, { transform: "none" }, f), timing),
    el.animate(held({ opacity: 1 }, { opacity: 0 }, f), { ...timing, pseudoElement: "::after" }),
    ...rest.map((x) => x.animate(held({ opacity: MOTION.dim }, { opacity: 1 }, f), timing)),
  ];
  const answer = el.querySelector('[data-variant="answer"], [data-variant="primary"]');
  if (answer)
    runs.push(
      answer.animate([{ transform: "none" }, { transform: "scale(1.04)" }, { transform: "none" }], {
        duration: MOTION.slow,
        delay: MOTION.slow,
        easing: MOTION.arrive,
      }),
    );
  const settle = () => {
    clearTimeout(timer);
    for (const a of runs) {
      // a cancelled animation rejects its `finished`: nothing waits on it
      a.finished.catch(() => {});
      a.cancel();
    }
    el.classList.remove("m-ring");
    dot?.classList.remove("m-lockon");
  };
  const timer = setTimeout(settle, hold);
  return settle;
}

/** The `--i` a staggered child (`.m-stagger > *`, `.m-enter`, a pane) waits by. */
export function nth(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

/** Count-up: a number that climbs to `to` and glides when it changes; it jumps under reduced motion. */
export function useCountUp(to: number, ms = MOTION.slow * 2): number {
  const [n, setN] = useState(() => (reduced() ? to : 0));
  const from = useRef(n);
  useEffect(() => {
    if (reduced()) {
      from.current = to;
      setN(to);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      // a frame's timestamp can precede `start`; unclamped, the easing swings below the starting value
      const k = Math.min(1, Math.max(0, (t - start) / ms));
      const v = a + (to - a) * (1 - (1 - k) ** 3);
      from.current = v;
      setN(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return n;
}
