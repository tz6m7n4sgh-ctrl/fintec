# Phase 2 — Design Record

**Status:** Design file in progress · **Date:** 3 Aug 2026 · **Tracked as:** [HAD-99](https://linear.app/haddad/issue/HAD-99/phase-2-design-fill-the-missing-frames-before-implementation-starts)

> `phase-2-discovery.md` decides *what* Phase 2 is. This records *what has been drawn*, what the
> drawings commit to, and what is still missing — so implementation reads from a file rather than
> inventing screens in code.
>
> Where this document and the discovery record disagree about intent, the discovery record wins.
> Where they disagree about what has been drawn, this one does.

**File:** [Fintec — Phase 2](https://www.figma.com/design/EoBOWZhkP9ZrY9gpEdeC78/Fintec-%E2%80%94-Phase-2?node-id=0-1) · one page, `Page 1` · file key `EoBOWZhkP9ZrY9gpEdeC78`

---

## 1. Frame inventory

Node IDs are stable and link directly: append `?node-id=<id with : replaced by ->` to the file URL.

| Frame | Node | Size | Workstream | Drawn by |
|---|---|---|---|---|
| Answer — mobile 390 | `1:26` | 390 × 1014 | B2 — the date-driven answer | initial |
| Answer — gratuity expanded | `3:2` | 390 × 1190 | B3 — deterministic working | initial |
| Doorway — mobile 390 | `4:2` | 390 × 714 | B1 — the three doorways | initial |
| Six fields — mobile 390 | `5:2` | 390 × 992 | B1 — six-field onboarding | initial |
| Navigation — four sections | `6:2` | 390 × 740 | C — collapse the IA | initial |
| **Compare — two last days** | `16:2` | 390 × 757 | B2 — the *expecting it* doorway | this pass |
| **Answer — nothing entered yet** | `17:2` | 390 × 984 | B2 + P2-5 — empty state | this pass |
| **Six fields — blanks and errors** | `18:2` | 390 × 1094 | B1 — validation states | this pass |
| **Answer — under one year** | `22:2` | 390 × 1155 | B2 + B3 — engine zero states | this pass |
| **Answer — desktop 1280** | `23:2` | 1280 × 888 | B2 + B3 + C — desktop layout | this pass |

Five of the nine workstreams in the discovery plan now have drawings: A (as a visible UI state),
B1, B2, B3 and C. D (the AI surfaces) and E (visual design proper) have none, by design.

## 2. What the drawings commit to

**The answer is a function of a date, not a number.** Every Answer frame leads with *"If your last
day were / 30 September 2026"* as an editable control above the figure, which is §3 of the discovery
record made concrete. The last day is the input, not a profile field three clicks away.

**The unverified basis is a component, not a caveat.** `flag/unverified-bg` + `flag/unverified-ink`
carry a fixed sentence next to every figure. This is §7's decision — with OD-1 resolved as *no legal
sourcing*, the citation model is built and rendered empty rather than omitted. A rule with no
citation is a state the UI has, not a gap it hides.

**Explanation is the interface, not a feature.** `3:2` expands one breakdown line into six rows of
arithmetic — service years, daily basic, first-five-years accrual, beyond-five accrual, the
multiplication, and the "basic salary only, never gross" note. It needs no model to render, which is
§4: deterministic first, a model only ever used to *word* it.

**Nothing is filled in with an example.** `17:2` shows the answer screen with no figures at all and
states why. Decision P2-5 forbids invented defaults, so the screen has to justify its own emptiness
rather than borrow the §11 seed dataset.

## 3. The design agrees with the engine

This is the part worth checking, because a design that disagrees with `lib/engine/uae.ts` produces
either a rewrite or a wrong figure. It does not disagree.

The expanded working in `3:2` states 2,678 days ÷ 365.25 = 7.33 years, daily basic AED 15,000 ÷ 30 =
AED 500, 21 days a year for the first five (105 days), 30 days a year beyond five (69.96 days),
174.96 days × AED 500 = **AED 87,479.47**. That reproduces `gratuity()` against `RULES` to the
fills — `DAYS_PER_YEAR: 365.25`, `DAYS_PER_MONTH: 30`, `GRATUITY_DAYS_FIRST_5Y: 21`,
`GRATUITY_DAYS_AFTER_5Y: 30`.

The deadlines match too: 30 Sep 2026 + 14 days = 14 Oct (`SETTLEMENT_DUE_DAYS`), + 30 days = 30 Oct
(`ILOE_CLAIM_DAYS`), + 90 days = 29 Dec (visa grace).

The compare frame added in this pass was computed the same way rather than illustrated:

| | 31 March 2027 | 30 June 2027 |
|---|---|---|
| Service days | 2,860 | 2,951 |
| Service years | 7.83 | 8.08 |
| Gratuity | AED 94,953.80 | AED 98,690.97 |
| Leave · 12 days | AED 6,000 | AED 6,000 |
| **Total** | **AED 100,953.80** | **AED 104,690.97** |

Difference AED 3,737.17, all of it gratuity accruing at 30 days a year past the five-year mark.

**Consequence for implementation:** B2 and B3 are close to pure presentation. `gratuity()`,
`leaveEncashment()`, `noticePayInLieu()`, `finalSettlement()`, `iloeBenefit()` and `deadlines()` all
exist and are conformance-tested. The build is new routes and components, not new arithmetic.

## 4. Tokens

Collection **`Fintec tokens`**, one mode, 23 variables. Colour values below are the current file
values; spacing and radius values live in the file and are not duplicated here to avoid drift.

| Token | Value | Used for |
|---|---|---|
| `surface/base` | `#fbfaf8` | Page background |
| `surface/raised` | `#ffffff` | Cards, inputs, buttons |
| `surface/sunken` | — | Muted panels, working blocks, disabled submit |
| `ink/primary` | `#16191d` | Body and figures |
| `ink/secondary` | `#545c66` | Supporting text |
| `ink/tertiary` | `#8a939e` | Labels, empty values, unavailable states |
| `line/hairline` | `#e6e3de` | Card and input borders |
| `money/ink` | `#0e6e5b` | The figure, primary action |
| `money/wash` | `#e7f1ee` | Hero panel, positive difference |
| `flag/unverified-ink` | `#8a6a1f` | Unverified-basis text |
| `flag/unverified-bg` | `#fbf3e2` | Unverified-basis panel |
| `critical/ink` | `#a32b2b` | Hard deadlines, blocking validation |
| `critical/wash` | `#f7e9e7` | Blocking validation panel |
| `space/2xs` … `space/2xl` | in file | Seven-step spacing scale |
| `radius/sm` `radius/md` `radius/lg` | in file | Corner radii |

**Type:** Inter, three weights — Regular, Medium, Semi Bold. Observed ramp: 12 / 12.5 / 13 / 14 / 15
/ 17 / 20 / 26 / 38, each with an explicit pixel line height. No text styles are defined; sizes are
set per node.

Two things an implementer should know. The colour tokens are bound to fills on every frame, so they
port cleanly to a Tailwind theme. The `space/*` and `radius/*` tokens exist but are **not bound** —
frames set raw numbers — so porting spacing means reading the intent, not the bindings.

## 5. States drawn in this pass

`18:2` draws five field states, because "six fields, then answer" only works if a blank field has a
defined consequence:

| State | Example | What it says |
|---|---|---|
| Required-blank | Employment start | No start date means no service length, so no gratuity — a threshold, not a smaller figure |
| Invalid | Last day before start | Two dates conflict; negative service is refused rather than computed |
| Interpreted | `32,000` | Read as AED 32,000 — commas parsed, not silently read as zero (see #50) |
| Optional-blank | Gross salary | Notice paid in lieu is omitted from the breakdown rather than shown as AED 0 |
| Ambiguous-blank | Unpaid leave | Blank is not zero; say zero if none |

The submit is drawn blocked, with a count of what is still needed.

`22:2` draws the two zero states the engine can return, which matter more than they look: a
first-year expat is exactly the person likely to be dismissed, and they see **two** zeroes. Gratuity
is zero because `serviceYears < GRATUITY_MIN_YEARS` — 0.58 years, 152 days short — and the frame
says it is a threshold rather than a smaller amount. ILOE is *Not eligible* because `iloeBenefit()`
requires twelve months of contributions against seven months of employment. One short employment,
two thresholds missed, and the ILOE deadline row reads *Does not apply* rather than showing a date
that cannot be used.

## 6. Desktop

`23:2` is the only non-mobile frame and it settles two things. The four sections from `6:2` become a
top bar rather than the current ten-item sidebar, so navigation stops being a wall and the answer
gets the width. The body splits into a main column carrying the date control, the figure and the
expanded working, and a 380px rail carrying the unverified-basis panel, the deadlines and the
compare action.

The rail placement is the decision worth noting: on mobile the unverified basis sits directly under
the figure, and on desktop it sits at the top of the rail, level with it. In both cases it is beside
the number rather than beneath the fold, which is what §7 of the discovery record requires.

## 7. What is still missing

Tracked as **[HAD-99](https://linear.app/haddad/issue/HAD-99/phase-2-design-fill-the-missing-frames-before-implementation-starts)**.

- **Money / Documents / You.** They exist only as descriptions on the navigation card.
- **Gratuity cap applied.** `capApplied` (24 months' basic) is a real engine state with no visual.
- **Dark mode.** One mode in the collection; every surface is light.

## 8. Sequencing note

Workstream E is last in the discovery plan, and this does not change that. Restyling ten screens
that workstream C will delete is still waste. What these frames are is different work: the
*unfinished states of screens C keeps*. Drawing them now is what stops the build inventing them in
code, one component at a time, with no record of the decision.
