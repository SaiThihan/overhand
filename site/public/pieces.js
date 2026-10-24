// Live pieces of the real dashboard on the site's pages: each `<div class="piece" data-piece="needs" data-max="3"
// data-title="…">` becomes a frame of demo/piece.html (apps/web/src/piece.tsx) when it comes near the screen, and goes
// again when it's far away, keeping its height, so a long page runs one or two dashboards at a time, never all of them.
// Each piece opens just before its moment of the sample night and plays it on `overhand:play`, which this page posts
// once per piece, when it's ready and at least half of it is on screen (never under reduced motion: the piece then opens
// at the moment's end, and so does a piece framed again after it has played). A piece is a short slice of the real thing
// (`data-max` items) and tells the page its height, so the frame fits it exactly: nothing scrolls inside, and scrolling
// over it scrolls the page. Under each, a quiet link to all of it in the live demo. Messages stay on this origin.
// Only what's on screen runs (two at most on Features; a frame boots in ~0.1s from cache). One shared frame can't serve
// them all: each piece shows its own minute of the night, and the demo's clock is per document (it moves Date.now).
// ponytail: one runtime per visible piece; a per-root demo clock if a page ever shows many pieces at once.
const root = document.querySelector('script[src$="pieces.js"]')?.src.replace(/pieces\.js.*$/, "") ?? "./";
const pieces = [...document.querySelectorAll("[data-piece]")];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const frameOf = (el) => el.querySelector("iframe");

// a piece plays its moment once: when its frame has said it's ready and half of it is on screen, whichever comes last.
// One focus at a time: a piece that comes due while another's focus holds (two side by side) waits its turn, --m-hold.
let free = 0;
function play(el) {
  const f = frameOf(el);
  if (reduced || !f || "played" in el.dataset || !("live" in el.dataset) || !("seen" in el.dataset)) return;
  el.dataset.played = "";
  const hold = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m-hold")) || 0;
  const now = performance.now();
  const at = Math.max(now, free);
  free = at + hold;
  // let go before its turn, it opens at its end when framed again (it counts as played)
  const post = () => frameOf(el)?.contentWindow?.postMessage({ type: "overhand:play" }, location.origin);
  if (at <= now) post();
  else setTimeout(post, at - now);
}

function mount(el) {
  if (frameOf(el)) return;
  const f = document.createElement("iframe");
  // played once already: it opens at the moment's end instead of playing it again
  const max = el.dataset.max ? `&max=${encodeURIComponent(el.dataset.max)}` : "";
  f.src = `${root}demo/piece.html?demo&p=${encodeURIComponent(el.dataset.piece)}${max}${"played" in el.dataset ? "&after" : ""}`;
  f.title = el.dataset.title || "A live piece of Overhand, on sample data";
  f.loading = "lazy";
  f.setAttribute("scrolling", "no");
  f.style.cssText = `display:block;width:100%;height:${el.dataset.h || 240}px;border:0;background:transparent`;
  el.prepend(f);
}

function unmount(el) {
  const f = frameOf(el);
  if (!f) return;
  delete el.dataset.live;
  // keep the space it took, so the page doesn't jump
  el.style.minHeight = `${el.getBoundingClientRect().height}px`;
  f.remove();
}

addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  const el = pieces.find((p) => frameOf(p)?.contentWindow === e.source);
  const f = el && frameOf(el);
  if (!f) return;
  if (e.data?.type === "overhand:ready") {
    el.dataset.live = "";
    play(el);
  }
  if (e.data?.type === "overhand:piece" && e.data.h > 0) {
    f.style.height = `${e.data.h}px`;
    el.dataset.h = String(e.data.h);
    el.style.minHeight = "";
    el.dataset.ready = "";
  }
});

// a piece starts loading a little before it scrolls in and is let go a screen after it has gone
const near = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && mount(e.target)), { rootMargin: "150px 0px" });
const far = new IntersectionObserver((es) => es.forEach((e) => !e.isIntersecting && unmount(e.target)), { rootMargin: "250px 0px" });
// half of it on screen counts as seen, once (an entry also comes when it barely starts to show: that isn't half)
const half = new IntersectionObserver(
  (es) => {
    for (const e of es) {
      if (!e.isIntersecting || e.intersectionRatio < 0.5) continue;
      e.target.dataset.seen = "";
      half.unobserve(e.target);
      play(e.target);
    }
  },
  { threshold: 0.5 },
);
for (const el of pieces) {
  const more = document.createElement("a");
  more.className = "more";
  more.href = `${root}#try`;
  more.innerHTML = 'See it all in the live demo <span aria-hidden="true">→</span>';
  el.append(more);
  near.observe(el);
  far.observe(el);
  half.observe(el);
}
