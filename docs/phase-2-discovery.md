# Phase 2 — Discovery Record
### Design, user experience, dashboard and reporting

**Status:** Draft from the discovery interview · **Date:** 3 Aug 2026 · **Stage gate:** Discovery → *your approval* → epic + issues

> Phase 1 shipped the engine, the data model, auth, ingestion and the security posture. It is
> also, by your own assessment, not usable by a stranger. This records what the discovery
> interview established, what it made obsolete, and the risks it surfaced. Both open decisions
> were resolved on 3 Aug — see §7, which also records what one of them costs.
>
> Decisions below are treated as **binding unless corrected**, in the same way as
> `stage-1-requirements.md`.

---

## 1. The problem, stated precisely

"Too complicated and very traditional" is the symptom. Four causes, because each needs a
different fix:

**There is no first run.** A new user lands on a dashboard of the §11 reference dataset — real
numbers belonging to nobody. The app says so, honestly, in a pill marked *Seed data*. Honesty is
not orientation. The first screen is somebody else's finances and ten navigation items.

**It asks for everything before it gives anything.** Profile, bank accounts, debts, school fees,
cheques, income streams — the entire model — before one figure is truly the user's. There is no
path where thirty seconds of typing produces a true answer.

**It is built for a reader, not a decider.** Ten sections, dense tables, and a great deal of
carefully-written caveat text. Every caveat is correct and worth defending individually. The
cumulative effect is a screen that asks to be studied, and a person holding a termination letter
cannot study anything.

**Reporting is a report.** `/report/` renders the calculation. The user's question is not "show me
the calculation".

---

## 2. Decisions taken in the interview

| # | Topic | Decision | Consequence |
|---|---|---|---|
| P2-1 | **Audience** | A product for UAE expats — strangers, not the author | Needs a first run, a value moment inside a minute, and language assuming no knowledge of UAE labour law |
| P2-2 | **Entry point** | All three: *terminated* / *expecting it* / *general planning* | The home screen must ask before it shows |
| P2-3 | **Core answer** | **How much am I owed?** | Gratuity, notice, unused leave, final settlement become the spine; everything else is supporting detail |
| P2-4 | **Precision bar** | The figure must be **good enough to take to HR** | Working shown, legal basis cited per line, every assumption editable. See §5 — this is the expensive one |
| P2-5 | **First run** | **Six fields, then answer.** No invented defaults | Several screens start empty and must say why they are empty |
| P2-6 | **Report audience** | The user, and nobody else | No PDF export, no document design, no hostile-reader formatting |
| P2-7 | **AI surface** | Ask-anything · Explain-this-number · Read-my-documents | *Draft what I have to write* was not selected; recorded as deferred, not rejected |

---

## 3. The reframe that makes P2-2 and P2-3 compatible

They contradict as stated. The general-planning user is owed nothing yet; nothing has happened to
the user who merely expects termination. "How much am I owed" is meaningless to two of the three
doorways.

The resolution is that the core answer is **not a number — it is a function of a date**:

> *If your last day were **[date]**, you would be owed **AED X**.*

- **Terminated** — the date is fixed. Show the number.
- **Expecting it** — the date is an input the user moves. The screen becomes *March versus June*.
- **Planning** — the date is today. *If you walked out now.*

One engine, one screen, three doorways. The engine for this already exists; what does not exist is
a screen that treats the last day as **the** input rather than as a profile field three clicks
away.

This also solves the ten-item sidebar without touching navigation, because it finally gives the
home screen a job.

---

## 4. What P2-6 makes cheaper, and what it makes harder

P2-4 and P2-6 look contradictory — a figure strong enough to argue with an employer, but a report
only the user reads. They are compatible, and the resolution *reduces* scope.

**Nothing leaves the app.** The user carries the argument, from their phone, in the meeting. So the
work moves out of reporting and into explanation, and the bar on explanation rises sharply: a user
who cannot restate why the number is what it is has nothing to argue with.

Two consequences:

1. `/report/`-as-a-document is cancelled before it is built. No export, no print stylesheet, no
   evidence-grade formatting.
2. **"Explain this number" stops being an AI feature and becomes the primary interface.** What the
   user takes to HR is not *AED 84,000*; it is *AED 84,000, and here is why, line by line*.

The explanation is built as part of the answer, not after it. **Deterministically first** — the
engine already knows every input to every figure, so the line-by-line working needs no model at
all. A model is used to *word* it, never to compute it.

---

## 5. The risk P2-4 introduces, and the workstream it forces

"How much am I owed" is the highest-consequence output this app has produced. A runway estimate
that is a month out is uncomfortable. An entitlement figure that is wrong, which a user then takes
into an HR meeting or a labour dispute, is a different category of harm.

That is not a reason to avoid it. It is the thing nobody else does well and it is the right choice.
It does mean the figure cannot ship as a number in a large font.

**The legal citations must not be written from memory.** UAE employment law was substantially
rewritten in 2022, any model's training has a cutoff, and a wrong article number quoted in an HR
meeting does not merely fail — it destroys the user's credibility at the moment they most need it.
That is this project's signature failure mode, *a plausible wrong answer rather than a visible
one*, transposed into law, where it is worse.

So Phase 2 carries a workstream nobody enjoys:

- source the gratuity, notice and leave rules from the current legal text
- store each rule with the provision it comes from and **the date it was verified**
- surface that verification date in the app, so a user can see how fresh the basis is
- re-verify on a schedule, and fail loudly when a rule has no citation

It is unglamorous, it blocks the headline feature, and it is what makes "take it to HR" true rather
than claimed.

---

## 6. Plan

| | Workstream | Depends on |
|---|---|---|
| **A** | **Citation model** — every rule carries its provision and verified-on date, both empty, and the app renders the basis as unverified. See §7 | — |
| **B1** | Doorway question + six-field onboarding | — |
| **B2** | The date-driven entitlement answer | A |
| **B3** | Explain-this-number, deterministic | B2 |
| **C** | Collapse the information architecture; request the rest of the model progressively | B |
| **D1** | AI wording layer over B3 | B3, API key |
| **D2** | Ask-anything, grounded in the user's own figures, always linking to the screen that proves it | C, API key |
| **D3** | Read-my-documents | D2, consent design |
| **E** | Visual design | C |

### Where the plan stands, 3 Aug

| | Workstream | State |
|---|---|---|
| **A** | Citation model | **Merged.** Every constant in `RULES` carries a provision and a verified-on date, all null, enforced by `rule()` taking them as required arguments. The app renders the emptiness |
| **B1** | Doorway + six fields | **Merged.** `/start` and `/start/figures` |
| **B2** | Date-driven answer | **Merged.** `/entitlement`, delegating every amount to the engine |
| **B3** | Explain this number | **Merged.** `/report` became the explanation; the PDF export is deleted, per P2-6 |
| **C** | Ten sections to four | **Half merged.** The four sections exist; none of the ten is retired, so the app has more routes than before and the structure underneath is unchanged (HAD-124) |
| **D1–D3** | The AI surfaces | Not started. D1 and D2 need an API key; D3 needs a consent design |
| **E** | Visual design | Not started, and correctly so — it waits on C being finished rather than begun |

Two claims this document made about the app are now false in a good way: the
legal footer no longer asserts *"UAE rules current as of July 2026"*, and the
engine header no longer says *"as verified July 2026"*. Nobody had verified
either, which is what OD-1 recorded.

**E is last, deliberately.** Restyling ten screens that will not survive workstream C is waste.
This is the part that will feel wrong to defer and is the part most worth deferring.

A design file now exists for A, B1, B2, B3 and C — the screens C keeps, not the ten it deletes, so
this does not reorder the plan. What has been drawn, what it commits to, and what is still missing
is recorded in [`phase-2-design.md`](phase-2-design.md) and tracked as HAD-99.

**D3 is last for a different reason.** The app's current privacy position is unusually strong: a
CSV is parsed on the user's own server and never sent anywhere. Sending a labour contract and an
offer letter to a model reverses that, for strangers, in a jurisdiction where employment documents
are sensitive. It is still worth doing — the data-entry win is large — but it needs an explicit
consent design and a decision about what is stored versus discarded.

---

## 7. Open decisions — both resolved 3 Aug

**OD-2 · Where Phase 2 lives → build alongside.** New routes go up beside the existing ones, and each old screen is retired as it is replaced. The information architecture changes underneath these screens, so editing in place would leave the app half-migrated for the length of the phase.

**OD-1 · Legal sourcing → none.** No access to the current legal text and no contact who can confirm it. This is a decision, not an omission, and it changes P2-4.

### What that costs, and the shape that keeps it cheap

P2-4 chose a figure **good enough to take to HR**. Without sourced citations it is not, and building it anyway while claiming otherwise is precisely the failure this project is organised against — a confident answer nobody checked.

So **P2-4 downgrades to "orient me, roughly"**, and the app says so rather than implying more.

The structure, however, is built as though the citations existed:

- every rule carries the provision it comes from and **the date it was verified** — both null for now
- the app renders the basis as **unverified**, visibly, next to the figure
- a rule with no citation is a state the UI has, not a gap it hides
- the entitlement is presented as *this app's calculation*, with a plain instruction to confirm against the employer

The cost of skipping OD-1 is then **a UI state rather than an architecture**. On the day the law text is available, the same structure fills in and the presentation changes — no rewrite, and no figure that silently became more authoritative than its evidence.

Workstream A is therefore not cancelled. It becomes: *build the citation model, populate nothing, and surface the emptiness.*

## 8. Correction to a Stage 1 decision

`stage-1-requirements.md` records **D1: parsing will run through Claude Cowork**, and treats that as
binding. It is now superseded and should be read alongside this note.

CSV statements are parsed **deterministically, on the server, and are never sent anywhere** — see
`lib/ingestion/`. That is a stronger privacy position than D1 described, and it is also more
correct: a model that reads `03/08/2026` as March once and August the next time produces two
ledgers that are each individually plausible.

D1 remains accurate for **PDF** statements, which are not parsed at all today and are refused by
name with an instruction to export CSV instead.

---

## 9. Carried over from Phase 1

Phase 1 is **code-complete and closed**. Every roadmap feature is built, tested and merged. What
follows is not unfinished engineering — it is work that was blocked on access or on a decision, and
it moves here rather than holding Phase 1 open.

The register exists because a **built-but-switched-off feature is the kind that gets forgotten and
then rebuilt.** Two of Phase 1's highest-stakes features are in exactly that state.

| # | Carried over | State | Why it is not code |
|---|---|---|---|
| C-1 | **Passkey sign-in** | Merged, returns 503 | Needs `PASSKEY_RP_ID` and `PASSKEY_ORIGINS` as Edge Function secrets. Two strings, no key to obtain |
| C-2 | **Cheque and school-fee reminders** | Merged, computes nightly, sends nothing | Needs `RESEND_API_KEY` plus `reminder_job_url` / `reminder_job_token` in Vault |
| C-3 | **SEC-1 cross-tenant isolation** | Gate passes by skipping | Needs `SUPABASE_DB_URL` as a repository secret. See the note below — this one is different in kind |
| C-4 | **Manual test pass** (HAD-68) | Not started | Needs *Confirm email = OFF*. Largely superseded anyway: Phase 2 replaces the screens it would test |
| C-5 | **`atRisk` rule** (HAD-83) | Undecided | A product decision. Phase 2 redesigns the dashboard, so the concept may not survive in its current form |
| C-6 | **Scheduled parse sweep** (HAD-9) | Recommended for closure | Its only remaining job is retrying a failed parse, which a retry button does without introducing the one key this project holds nowhere |
| C-7 | **Committed Supabase defaults** (HAD-75) | Undecided | Becomes mandatory in Phase 2: a product for strangers must not ship credentials that point every fork at one project |

### C-3 is not like the others

C-1, C-2 and C-4 are features waiting for a user. C-3 is **a check that reports green while proving
nothing.**

Cross-tenant isolation is the property this entire project is organised around — every table has RLS
enabled *and* forced, and Phase 1's strongest claim is that no code path anywhere can bypass a
policy. The gate that proves that currently completes in about seven seconds because it cannot
reach a database, and a skipped check is indistinguishable from a passing one in the UI.

Phase 2 makes the app multi-tenant for real strangers, which is precisely when that guarantee stops
being theoretical. Carrying C-3 forward is reasonable; leaving it unset once Phase 2 has users is
not.

### C-5 ships an inconsistency, not just an open question

The §11 seed contains two payments whose `atRisk` flags follow different rules. Deferring the
*decision* is fine. What travels with it is that the app currently renders an at-risk figure derived
from a rule nobody has chosen — so whatever Phase 2 does to the dashboard, this needs settling
before that figure is put in front of a stranger.
