Keywords: ui, design, ux, screen, frontend, css, layout, claude design, accessibility

# Design: senior-first, designed before it is built

Every user-facing screen is for a frightened 70-year-old at 9 pm, and for the family member who answers. The screen is designed first, agreed, then implemented; code is never the first draft of a screen.

## The rule

1. Before building or changing a user-facing screen (web app, Android, guardian page, email), produce the design with Claude Design: the Design artifact type, through the Artifact tool's `quickstart` with intent `design`. Reuse the Scam Shield design system when one exists among the artifacts; otherwise start one from the system below and keep it.
2. Get the design agreed (Hadrien for product, the requester for the change) before writing code; note the decision in the feature file (`_product/specs/<feature>.md`, Behavior and Demo path).
3. Implement to the design; a change forced by the code goes back through step 1.
4. Use `/design-consultation` to set or revisit the system (typography, color, layout, motion), `/plan-design-review` when a plan touches several screens, and `/design-review` before a screen is called Built.

## The senior-first design system

- Type 19 px or larger, three sizes the user can pick; short lines; no small print, ever.
- Tap targets 64 px; one verdict and one action per screen; the next step is one button with a verb on it.
- Plain words: "website address", not "domain"; Safe, Be careful, Scam; no jargon, no percentages, no acronyms.
- High contrast (WCAG AA at least, AAA for the verdict); color is never the only signal: red, amber and green always come with the word and an icon.
- Read aloud on every verdict card; EN and FR complete, same layout in both.
- Calm: no countdown, no blinking, no stacked dialogs; a scary message sits behind a button, the verdict in front.
- Reversible: every action has its undo on the same screen (Put it back); nothing destructive is one tap away.

## Before a screen is called Built

- Keyboard and screen-reader pass: landmarks, labels, focus order, an announcement when a live answer arrives.
- Contrast and text size checked at the largest setting on a phone width; no horizontal scroll, nothing cut off.
- A reading check: one person who is not on the team says, in their words, what the screen tells them to do.
- The feature's Demo path shows the screen as built; the `_product/spec.md` status moves to Built only after these.
