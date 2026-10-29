# Test cases and observed results

All results below were **observed** by running the system, not asserted from design.
Reproduce them with:

```bash
npm run seed        # deterministic - the same database every time
npm start
npm run scenarios   # prints the Appendix 1 table below
npm test            # 136 automated checks
```

The seed uses a fixed pseudo-random sequence, so unit codes and figures are identical on
every machine.

---

## 1. Scenario catalogue (project report, Appendix 1)

Run by `server/scenarios.mjs`.

### Scenario A — all fields complete, no rule triggered

| | |
|---|---|
| Input | Hb 11.4 g/dL, HR 78, SBP 124, group B+, no bleeding, no prior reaction, 1 unit |
| Flags | `R-HB-ADEQUATE` (information severity only) |
| Review status | **No demonstration rule triggered** |
| Readiness | full — 1/1 covered, 32 compatible units in stock |

The adequate-haemoglobin note is recorded as *information*, which deliberately does not
change the review status. Under a restrictive strategy it is a prompt to ask whether a
transfusion is needed at all.

### Scenario B — haemoglobin below the configured threshold

| | |
|---|---|
| Input | Hb 6.5 g/dL, HR 84, SBP 118, group B+ |
| Flags | `R-HB-CRITICAL`, `R-AGE-ELDERLY` |
| Review status | **Priority clinician review** |
| Evidence shown | `Haemoglobin 6.5 < 7` |

### Scenario C — active bleeding selected

| | |
|---|---|
| Input | Hb 9.2 g/dL, HR 96, SBP 108, active bleeding **yes** |
| Flags | `R-BLEED-ACTIVE` |
| Review status | **Priority clinician review** |

Note that haemoglobin alone would not have raised anything at 9.2. The bleeding flag
escalates the case on its own, which is the intended behaviour: a single haemoglobin
measurement lags behind a bleeding patient.

### Scenario D — previous transfusion reaction reported

| | |
|---|---|
| Input | Hb 9.0 g/dL, HR 80, SBP 120, prior reaction **yes** |
| Flags | `R-REACTION-HISTORY` (advisory) |
| Review status | **Advisory notes for clinician** |

### Scenario E — required fields missing *(the data-quality guard)*

| | |
|---|---|
| Input | Hb **blank**, HR 88, SBP **blank** |
| Flags | `R-DATA-INCOMPLETE` only |
| Not evaluated | `R-HB-CRITICAL`, `R-HB-LOW`, `R-SBP-LOW`, `R-SHOCK-INDEX`, `R-AGE-ELDERLY`, `R-HB-ADEQUATE` |
| Review status | **Incomplete — review data entry** |

**This is the most important row in the table.** Six rules were skipped because the data
they depend on is absent, and each is named. No haemoglobin flag fires, and — critically —
no "all clear" is implied either. A blank is an unanswered question, not a normal value.

### Scenario F — stock short of the request

| | |
|---|---|
| Input | Hb 6.8, HR 110, SBP 92, group **O−**, 8 units requested |
| Flags | `R-HB-CRITICAL`, `R-SHOCK-INDEX`, `R-HR-HIGH`, `R-AGE-ELDERLY` |
| Review status | **Priority clinician review** |
| Readiness | **partial** — 4/8 covered, 4 compatible in stock |
| Allocation | `U-000184` 20d, `U-000185` 33d, `U-000180` 34d, `U-000182` 37d |
| Advisory | `SHORTFALL` — "Only 4 of 8 units can be covered from current stock." |

O-negative recipients can receive O-negative only, so they are the most constrained case
in any blood bank. The shortfall is surfaced during the clinical review rather than after
the request reaches the blood bank.

### Scenario G — request exceeds identical-group stock

| | |
|---|---|
| Input | Hb 7.2, HR 94, SBP 110, group **AB−**, 6 units requested |
| Readiness | full — 6/6 covered from 17 compatible |
| Allocation | `U-000097` AB− 27d, `U-000118` AB− 32d, `U-000119` AB− 33d, then `U-000017` A− 0d, `U-000025` A− 3d, `U-000039` A− 8d |
| Advisories | `SCARCE_GROUP`, `EXPIRING_SOON` |

This one row demonstrates the whole allocation policy:

- **Identical group first** — all three AB− units are taken before any substitute.
- **FEFO within each rank** — 27 → 32 → 33, then 0 → 3 → 8. The ordering restarts at the
  rank boundary, which is exactly the intended behaviour.
- **Scarcity is flagged** — drawing A-negative as a substitute raises `SCARCE_GROUP`,
  prompting the blood bank to confirm no closer match can be sourced.

---

## 2. Automated test suites

| Suite | Checks | Command |
|---|---|---|
| API and domain logic | 61 | `npm --prefix server run test:api` |
| UI endpoint reachability (per role) | 38 | `npm --prefix server run test:routes` |
| UI render walk in a real DOM | 37 | `npm --prefix web run test:ui` |
| **Total** | **136** | `npm test` |

### What the API suite covers

**Authentication and roles.** Bad password rejected; unauthenticated requests rejected;
a clinician cannot add stock; blood-bank staff cannot create patients; a clinician cannot
activate a rule set or reserve units.

**Rule engine.** Low haemoglobin, active bleeding, hypotension and shock index all flag on
the expected inputs; every flag carries evidence; missing data raises the data-quality
flag and suppresses the haemoglobin rules.

**Readiness.** Compatibility is correct (A+ accepts exactly four donor groups); allocation
is verified FEFO-ordered within compatibility rank.

**Rule governance.** Replay against the draft version produces a difference; the stored
assessment is unchanged afterwards; comparison reports both the rule diff and the number
of stored cases affected.

**Request lifecycle.** Reservation is blocked with no checklist and with a partial
checklist; succeeds with the full checklist; a reserved request cannot be reserved twice;
issue completes; the unit traces back to its donor and forward to the patient.

**Compatibility guard.** An A+ unit offered for an O− recipient is refused with HTTP 409.

**Donor chain.** A donor with Hb 11.0 fails screening and at 14.2 passes; a donation is
blocked while ineligible; new units start `quarantined`; PRBC expiry is exactly 42 days
after collection; recording a screening pass releases the units to the shelf.

**Inventory and forecasting.** No expired unit is ever listed as available; the forecast
reports its own mean absolute error; discarding requires a reason.

**Audit.** Entries are hash-chained and the chain verifies intact over 277 seeded entries.

### What the UI suite covers

The built bundle is mounted in a jsdom DOM against the live API. The test signs in through
the real form, visits all 16 routes and 4 detail routes, and **fails on any console error
or React warning**.

It then drives the assessment form directly: selecting a patient produces a live preview;
entering Hb 6.1 / HR 124 / SBP 86 raises the haemoglobin and shock-index flags and
escalates the status to *Priority clinician review*; the readiness panel updates alongside
and names specific unit codes; and clearing the haemoglobin field moves the case to
*unevaluated* rather than firing or clearing a flag.

One assertion also checks that no screen renders the phrases "do not transfuse" or
"recommend transfusion".

---

## 3. Manual demonstration script

For the review. Roughly eight minutes.

**1 — Framing (30s).** Sign in as `dr.anand`. Point at the amber safety bar: synthetic
data, no diagnosis, no transfusion decision, no crossmatching. Everything that follows
sits inside that boundary.

**2 — Dashboard (1 min).** Stock by group, the 30-day issue trend with the dashed
projection, expiry alerts, open requests. One screen, both halves of the problem.

**3 — The coupled assessment (3 min) — the centrepiece.**
Go to *New assessment*. Pick the O-negative patient. Enter Hb 6.8, HR 110, SBP 92.

As you type, the left side fills with flags. Expand `R-SHOCK-INDEX` and show the evidence
row: observed 1.2, operator ≥, threshold 1.0. The reviewer can check the reasoning rather
than trust it.

Now point right, to the readiness panel. *This is the contribution.* Request 8 units: the
panel reports 4 of 8 covered, names the four actual O-negative units with days to expiry,
and raises `SHORTFALL`. In the surveyed systems this would be a phone call after the
clinical review. Here it is on the same screen, at the same moment.

Read the blue notice aloud: availability is logistics, not an indication.

**4 — The missing-data guard (1 min).** Clear the haemoglobin field. The case becomes
*Incomplete — review data entry* and names the six rules that could not be evaluated. No
"all clear" is implied. This is the hazard the report identifies, handled in code.

**5 — Rule governance (1.5 min).** Open an assessment, scroll to *Replay against another
rule version*, choose the 1.1.0 draft. The flags differ and the status changes. Then
*Rule sets → Compare*: 4 of 8 stored cases would flag differently. A governance group can
see the consequence of a threshold change before approving it.

**6 — Blood bank (1.5 min).** Sign in as `bb.kumar`. Open a pending request. Try to
reserve with the checklist unticked — refused, with the outstanding items listed. Tick all
six, reserve, issue. Then *Trace a unit* with one of the issued codes: donor → camp →
donation → component → request → patient.

**7 — Audit (30s).** *Audit ledger → Verify chain.* 277 entries recomputed, chain intact.
Explain the base paper's blockchain and why a hash chain is the proportionate control for
a single institution.

**Close.** The contribution is the join between clinical review and operational
availability, with every step explainable and the clinical decision left where it belongs.
