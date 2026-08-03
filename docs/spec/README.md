# Specification

**Audience: whoever — or whatever — implements this system next.**

This directory exists because the application may be reimplemented from scratch, possibly by a different model or a different team. It is written to be sufficient for that, and it is deliberately not a wiki.

---

## Read in this order

| | | |
| --- | --- | --- |
| 1 | [`00-invariants.md`](./00-invariants.md) | **Start here.** The things that must stay true, and the failure each one prevents. Everything else describes what the app does; this describes what it must never do. |
| 2 | `01-system-overview.md` | What the app is, who it is for, and the three situations a user arrives in. |
| 3 | `02-domain-rules.md` | The UAE calculation rules — gratuity, notice, leave, ILOE, deadlines. |
| 4 | `03-data-model.md` | Tables, the RLS posture, and the constraints that carry meaning. |
| 5 | `04-architecture.md` | Next.js, Supabase and Edge Functions — and why each boundary is where it is. |
| 6 | `05-security-model.md` | What protects the data, and what must never be added. |
| 7 | `06-screens.md` | What each screen shows, and which of it is computed. |
| 8 | `07-conformance.md` | Reference inputs and their expected outputs. |

Decisions with no natural home in a source file live in [`../decisions/`](../decisions/). Decisions *about a specific module* live in that module's header comment, deliberately — see below.

---

## How to use this to reimplement the application

**Prose is the weakest artefact here. Do not treat it as the specification.**

Three things in this repository are executable, cannot drift silently, and together define the system far more precisely than any document:

### 1. The test suite is the behavioural specification

534 unit tests and 173 end-to-end tests. They are written to state *why* as well as *what* — most assertions carry a comment naming the defect they exist to prevent, and several encode bugs that were found in production behaviour rather than invented.

A reimplementation that passes this suite behaves correctly. One that does not, does not — regardless of what any document here says.

Of particular note:

- `lib/engine/*.test.ts` — the UAE calculation rules, against the §11 acceptance profile
- `lib/ingestion/*.test.ts` — statement parsing, including the refusals
- `e2e/passkeys.spec.ts` — the WebAuthn ceremony against a real virtual authenticator, with seven negative controls
- `scripts/vendor-engine.test.ts` — proves the Edge Functions' copied code matches its source

### 2. The migrations are the data model

`supabase/migrations/` — 26 files, applied in order. They carry the tables, the row-level security policies, the check constraints, and the indexes whose shape is load-bearing rather than incidental (the reminder send-once index is per *occurrence*, not per payment; the dedupe index includes `direction`).

Read the SQL, not a diagram of it.

### 3. The reference dataset is the conformance fixture

The §11 acceptance profile, in `lib/data/seed.ts`, with its expected outputs asserted throughout the engine tests. A reimplementation can be checked against it directly rather than reviewed by eye.

---

## Why the reasoning lives in the source, not here

Most of this codebase's "why" is in module header comments, and that is deliberate rather than lazy documentation.

A reason kept next to the code it justifies is read by the person changing that code, and it moves when the code moves. The same reason in a separate document is read by nobody and drifts within weeks. This project has already had to correct a requirements document whose binding decision had been superseded, and a tracker issue with an acceptance criterion ticked that was never met — both of which happened because they lived away from the code.

So this directory holds what genuinely has no file to live in: system-wide invariants, cross-cutting rules, and the shape of the whole. For anything narrower, **read the module header**. They are long on purpose.

---

## Status of what is described here

This documents the system **as built at the close of Phase 1**, which is complete and merged.

Two things it describes are built but **switched off** pending configuration, and a reimplementation should treat them as specified rather than as absent:

- **Passkey sign-in** — needs `PASSKEY_RP_ID` and `PASSKEY_ORIGINS`
- **Cheque and school-fee reminders** — needs `RESEND_API_KEY` and two Vault secrets

Phase 2 changes the information architecture substantially — see [`../phase-2-discovery.md`](../phase-2-discovery.md) for the plan and [`../phase-2-design.md`](../phase-2-design.md) for what is drawn and built. Where that document and this one disagree about the *future*, that one wins. Where they disagree about what exists *today*, this one does.

**Part of it is now built**, and this specification has been updated to match: workstreams A, B1, B2 and B3 are merged, and C is half merged — the four sections exist while the ten they absorb are still there behind them. Two consequences worth carrying into any reimplementation:

- **No rule in this engine has a sourced provision.** `lib/engine/citations.ts` records that per constant, all null, and the app says so beside every figure. Do not restore the *"current as of July 2026"* language that used to appear in the legal footer and the engine header — nobody checked, then or since.
- **The report is not a document.** P2-6 cancelled the export; `/report` explains rather than prints.
