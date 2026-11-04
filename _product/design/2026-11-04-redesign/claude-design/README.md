# Claude Design output, 2026-11-04

The redesign Vlad ran in Claude Design from `../brief.md` and the eight saved screens: https://claude.ai/design/p/8d42c697-66fc-4f6c-97c9-aa5c8b98213f (private to Vlad's account). `Prudence Redesign.dc.html` is the canvas (nineteen frames, 1a to 1s, each with a "Changed / Why" note under it); `PrudenceHeader`, `PrudenceTabs` and `PrudenceProtects` are the three components the frames import (header with the Settings button, the four-tab bar, the "What Prudence protects" list in EN and FR). The files are Claude Design's own format (`<x-dc>` templates with `{{ props }}`): read them for the markup, the words and the sizes; they do not run on their own without Claude Design's `support.js`, which is not kept here.

Spec: `_product/specs/protection-menu.md` (Screens). Build: `public/js/*`, `public/styles.css`.
