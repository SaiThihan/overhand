# Creative direction

The series bible for Overhand's worlds. docs/design-system.md says how the interface looks; this says how a world
feels, who makes it, and how it is made. Every theme, scene, sound, voice line and animation answers to it. It is
written the way a film or game production runs: one vision, a crew of crafts, and review gates between them.

## The vision

> You come back to your desk. While you were away, your crew worked. One glance at the world tells you how it went.

Overhand's worlds are the room your work happens in, not a game you have to play. The model is the window of a
ship's bridge or the world beyond the interface in a great open-world game: alive every second you look, never
asking for attention unless something matters, and **changed by what you did**. Immersion here comes from three
things together:

1. **It's real.** Everything on screen is caused by the real state of your agents. Nothing is staged for its own sake.
2. **It remembers.** The world keeps the history of your work: it grows with every merge and carries scars from
   failures until they're fixed.
3. **It's crafted.** Every frame, sound and line is directed by someone who owns that craft, against one vision.

## Principles of the house

From the film crews and game studios we admire, translated for a tool people leave open all day.

- **Practical before spectacular.** Effects must feel physical and grounded: light falls off, rain runs down
  glass, smoke drifts with the wind. Prefer one convincing physical detail to ten particles.
- **Time is the structure.** The world runs on the real clock and the real calendar. Night, dawn, weekends and
  seasons are real. A "previously" recap replays the night out of order only to bring you back to now.
- **Scale with restraint.** Big, deep spaces (horizons, skylines, ridges) with almost nothing moving in them. The
  emptiness is what makes the one moving light matter.
- **Sound carries the emotion.** The image tells you what happened; the sound tells you how to feel about it. A sound
  only answers new activity, never as an alarm.
- **Diegetic interface.** Wherever possible, the world itself shows state (a lighthouse, a buzzing phone, a lit
  floor) instead of a badge. The panes give the facts; the world gives the feeling.
- **Readability over detail.** A state must read in one second at 390 px wide, in greyscale, from across the room.
- **Juice in moderation.** Feedback (a settle, a glow, a small sound) on every meaningful event, and none on noise.
- **One focal point.** At any moment, at most one thing asks to be looked at.
- **The audience is working.** Nothing flashes, nothing loops faster than a breath (about 4 s), nothing moves at full
  strength behind text. Reduced motion gets composed still frames, as carefully lit as a poster.

## The crew

Every world is made by the same crew. One person (or agent) can hold several roles, but each role's brief and gate
must be met. The director has the final call; everyone else owns their craft.

### Director
- **Owns:** the vision of each world and every review gate. Says no more often than yes.
- **Rules:** every beat must be earned by real state; one focal point; restraint first.
- **Delivers:** the one-page treatment, notes at each gate, the final sign-off.

### Writer and narrative designer
- **Owns:** the world's story, its characters' manner, and every line of copy (copy is dialogue).
- **Rules:** one word, one meaning (the collision test); every themed word keeps its plain meaning in sight; lines are
  short and spoken by someone who lives in the world; humour is the character's, never the interface's.
- **Delivers:** the world bible (logline, history, the three acts in this world, the cast and how they speak), the
  word list for every interface string, a briefing script template, empty and error states in voice.

### Production designer
- **Owns:** the world itself: setting, architecture, props, era, and its rules (what exists, what never appears).
- **Rules:** one location, seen from one place, every day. The world is specific (this harbour, this safehouse),
  never generic. Every prop has a job in the story.
- **Delivers:** the location plan (layers from far to near), the prop list with their state meanings, the
  "never in this world" list.

### Art director and concept artist
- **Owns:** the visual language: shape, palette, texture, lighting key.
- **Rules:** palette from the theme's tokens only; one accent colour carries "needs you"; silhouettes before detail;
  every frame must still read in greyscale.
- **Delivers:** key art per act (setup, rising action, complication, resolution) at desktop and phone size; the
  palette and lighting key per time of day.

### Character designer
- **Owns:** the agents and leads as characters.
- **Rules:** distinct silhouettes readable at 24 px; three poses (rest, work, return) and one signature gesture used
  only for the payoff; leads are a little larger and marked; characters look at their work, never at the viewer,
  except the one beat where something needs you.
- **Delivers:** the cast sheet: silhouettes, poses, gesture, how a lead differs from an agent, how many fit on screen.

### Cinematographer
- **Owns:** framing, depth, camera and light.
- **Rules:** the frame never cuts or shakes. Three or four parallax layers move a few pixels with the pointer or the
  device tilt; a beat may drift the camera a few percent toward its subject and back. Light motivates the eye: the
  brightest point is the focal point. Composition keeps the art clear of the panes (bottom third and edges).
- **Delivers:** the shot plan (one fixed wide shot per world, with its depth layers), lighting per time of day and
  per state, phone and ultra-wide recompositions.

### Animator
- **Owns:** all motion: characters, world life, transitions.
- **Rules:** anticipation, ease in and out, overlap, weight (big things move slower), arcs. Timing: idle motion cycles
  6–30 s; state transitions 1.5–4 s; a story beat 3–6 s from start to settle; nothing on screen shorter than 300 ms.
- **Delivers:** the motion library per world (idle life, work loop, return, gesture, transitions), timed against the
  editor's beat sheet.

### Technical artist (VFX and performance)
- **Owns:** how it renders: shaders, particles, weather, and the performance budget.
- **Rules:** idle renders on change only; active scenes at most 10 fps with a GPU and 4 fps without; hidden tabs render
  nothing; idle CPU under about 2%; no new dependency without a measured reason; everything drawn in code.
- **Delivers:** the renderer, the weather and light systems, a perf table per world (idle, active, GPU, no GPU, phone).

### Game designer (systems)
- **Owns:** how real state becomes the world: the state model, the beat rules, and progression.
- **Rules:** every input traces to real data (the same alert list as Needs you); beats are events, not polls;
  progression rewards real outcomes only (merges, first-try fixes, a clean week), never time spent or tokens burned.
- **Delivers:** the state map (state → scene, beat, sound, line), the progression design (below), the tuning table.

### Editor
- **Owns:** rhythm: when beats play, how long they hold, how they're cut together.
- **Rules:** cut on the event, not the poll; a beat plays to its end, then the next state fades in; beats queue at
  least 8 s apart; several merges in one poll play as one beat with a count; hold the payoff before the next change;
  the morning recap is at most 10 s, cut fast, ends on the present, skippable with any key.
- **Delivers:** the beat sheet per world and the 30-second animatic.

### Sound designer
- **Owns:** every sound in the world.
- **Rules:** diegetic first (a bell, a phone on wood, a purr), never interface beeps; one sound per beat, under 0.6 s,
  landing on the visual peak, not the start; mixed quiet (noticeable in a silent room, invisible in a busy one);
  synthesised in code, so no files and the same sound on every device.
- **Delivers:** each world's palette (needs you, merged, failure, agent start and stop) and the mix sheet.

### Composer
- **Owns:** the musical idea of each world.
- **Rules:** nothing plays on its own: no ambient bed, no loop, only the short sounds for new activity. Each world has
  a leitmotif of three or four notes that the payoff sounds quote.
- **Delivers:** the leitmotif.

### Voice director
- **Owns:** the briefing voice as a character (the harbour master, the general, the handler).
- **Rules:** the browser's own speech voice, nothing downloaded; the character's manner comes from the writer's script
  and the voice's delivery (preferred voices, rate, pitch); the briefing's text is always on screen too, for devices
  without a voice.
- **Delivers:** the preferred voices, rate, pitch and delivery notes per world, and a sample read of the briefing.

### Colourist
- **Owns:** the grade across the day and across states.
- **Rules:** one grade curve per world over 24 hours; states shift the grade subtly (a cold cast for failure, warmth
  for resolution); text contrast is never sacrificed.
- **Delivers:** the time-of-day grade and the state grades.

### Experience lead (UX)
- **Owns:** the meeting of world and interface.
- **Rules:** the panes always win: art never competes with text; the plain meaning is always in reach; every world
  works at every screen size (`bun run shots`) and under reduced motion; the Scene setting (On, Still, Off) is
  respected everywhere.
- **Delivers:** contrast checks, the screen-size sweep, the reduced-motion frames.

### Producer
- **Owns:** schedule, scope and the gates.
- **Rules:** a world moves to the next stage only when its gate passes. Cut scope before cutting quality.
- **Delivers:** the production board and the gate log.

### Continuity supervisor
- **Owns:** consistency across worlds and over time.
- **Rules:** the same state means the same thing in every world (one beacon for needs you, one payoff per merge);
  the logo never changes; no word, image or sound is shared between worlds that must stay distinct; the world's
  memory (progression, scars) never contradicts the facts.
- **Delivers:** the continuity checklist run at every gate.

## The story every world tells

Each world stages the same night in its own genre: three acts, the same beats.

| Act | State | The viewer should feel | Staging rule |
|---|---|---|---|
| Setup | idle, evening | calm, safe to leave | the world at rest; light low and warm; one small detail alive |
| Rising action | agents working | quiet momentum | one character per agent, at work; the world a little brighter |
| Complication | needs you, failure | a pull, not an alarm | one beacon per world, breathing; damage that lingers until fixed |
| Resolution | merged, dawn | relief and a small reward | one payoff per merge; the dawn grade |

## A world that remembers: progression

The deepest immersion is a world that keeps your history. Progression rewards **real outcomes only**: merges,
first-try fixes, clean weeks. Never time spent, tokens burned or runs started.

- **Growth.** Each merged PR leaves something permanent: a new light in the harbour town, another tent pitched in
  the camp, a new lit window in the safehouse's skyline, a denser fold in the cortex, another floor on the tower.
  Growth is slow and logarithmic, so a year of work shows and a busy week doesn't clutter.
- **Scars.** Failures leave a mark (a broken lamp, a scorched tent, a dead screen) until the cause is fixed; then
  it is repaired visibly, and the repair is a small payoff of its own.
- **Seasons and milestones.** The real calendar changes the world (winter light, longer nights); milestones (the
  100th merge, a week with no failures) unlock one quiet, permanent detail each, named in the brief.
- **Per project.** Each project has its place in the world (a quarter of the harbour, a front of the camp), so a
  glance shows which project is thriving.
- **Never punishing.** Quiet weeks don't decay the world; it simply rests.

## How a world is made

Every world goes through the same production. Each stage ends at a gate; the director signs off with the listed
reviewers. A world ships only when its animatic makes you want to leave it open.

| Stage | Output | Gate reviewers |
|---|---|---|
| 1. Treatment | One page: logline, the three acts here, the cast, palette, sound palette, voice, five lines of copy | director, writer, producer |
| 2. World bible | Setting and its rules, location plan, cast sheet, word list, the state map, the progression design | director, writer, production designer, game designer |
| 3. Storyboard | Key frames for every act and beat at desktop, phone and ultra-wide, plus the reduced-motion stills | director, art director, cinematographer, experience lead |
| 4. Animatic | A 30-second cut through a whole night (setup → work → needs you → failure → merge → dawn) with temp sound, and a "previously" recap | director, editor, animator, sound designer |
| 5. Build | The scene, motion, sounds, voice and words in the app on the shared state model | technical artist, game designer, experience lead |
| 6. Polish | Timing, rhythm, mix and grade tuned against the animatic; perf table; screen-size sweep; continuity check | everyone |

## Originality

Every world is our own. A genre, a feeling or an era is free to use; another work's names, symbols, characters,
creatures or signature images are not: no masks, coins, hotels, logos, slogans or anything else lifted from films,
games, books or real groups. When a reference is the inspiration, take its craft (how it lights, paces or sounds),
never its iconography.
