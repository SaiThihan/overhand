# Overhand's mark, brand kit and loading indicator

Status: chosen 2026-10-22. The owner asked for a logo, a brand kit and "a custom main loading indicator (used sparingly);
skeletons are better for sections loading", then took the lead's recommendation: direction C, **Hand over**.

## The mark

Two squares: the work, an outline square in ink, and **you**, the signal-orange square lifted over it (offset up and
right by just under half a square). It reads as the upper hand, handing work over, and standing over the work. It
keeps today's orange square, which already means "needs you" and sits at the centre of the attention map.

- Drawn on a square grid; the outline's stroke scales with size (2px at 28px; thicker at 16px so it holds).
- Lockup: the mark, then "Overhand" in Atkinson Hyperlegible Next Bold, tracking -0.02em; clear space of one small
  square around it; smallest size 16px (favicon), where the outline thickens.
- Colours: the outline in ink 12 (or ink 1 on dark), the square in `you-fill` (#ff5a1f). No gradients, no glow.
- Own work: no borrowed motif from any reference or other product.

## The brand kit (one file set, generated from the one source)

Mark and lockup (SVG, light and dark), app icons (macOS, the phone's home-screen web app, light and dark), favicon (SVG
+ 32px PNG), the link-preview image (headline and mark on paper), colour (neutral ink and paper; orange only for the mark
and "needs you"), type (Atkinson Hyperlegible Next and Mono), icons (Lucide at one stroke width; no sparkles, no emoji
in the product), voice (plain, short, structured: what happened, who it affects, what's next). It lives in the design
catalog's Foundations page at overhand.dev/docs/design and its files in the repo.

## The loader

One custom loading indicator, used only when the whole app is starting or connecting (first load, reconnecting to your
computer from the phone, Setup's scan). Your square slides over the work and back on the system's arrive easing, about
1.8 s a cycle; under reduced motion it's the still mark with a "Starting…" line. Every section and pane that loads uses
skeleton blocks in the shape of its content instead.
