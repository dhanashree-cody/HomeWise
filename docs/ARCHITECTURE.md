# HemoWise — architecture and contribution

## 1. The gap this project addresses

The literature surveyed for this project divides cleanly in two.

**Blood-bank management systems** — the 2020 R10-HTC base paper, CCBBMS (2018), the AWS
cloud blood bank (2024) — manage donors, stock, requests and traceability. They model
the shelf in detail and the patient not at all.

**Transfusion-prediction research** — Rafiei et al. (2024) on ICU transfusion
likelihood, Zang et al. (2024) on hip surgery, the Duranteau (2024) scoping review of
40 surgical models — models the patient in detail and the shelf not at all.

Neither half knows about the other. In practice the clinician is the integration layer:
they read a clinical screen, form a view, then separately ask the blood bank whether
anything suitable exists. The information needed to make a sensible decision is split
across two systems and a phone call.

**HemoWise's contribution is the join.** Not a better clinical model — the project makes
no claim to one — but a workflow in which the clinical review and the operational answer
are computed from the same submission and presented together, each explainable.

## 2. The four engines

### 2.1 Rule engine — `server/src/lib/rules.js`

Rules are **data, not code**. A rule set is a JSON document stored in the `rule_sets`
table and interpreted by a small declarative evaluator:

```js
{
  id: 'R-SHOCK-INDEX',
  severity: 'high',
  title: 'Shock index at or above 1.0',
  condition: 'heart_rate / systolic_bp >= 1.0',
  rationale: '...',
  when: { ratio: ['heart_rate', 'systolic_bp'], op: 'gte', value: 1.0 }
}
```

Storing rules as data buys three properties that a hard-coded `if/else` cannot:

- **Explainability.** Evaluation returns, for every triggered rule, the observed value,
  the operator and the threshold. The UI renders that row verbatim, so a reviewer checks
  the reasoning rather than trusting it.
- **Governance.** A rule set carries a version, an approver and an approval date. Every
  assessment stores the `rule_set_id` that produced it, permanently.
- **Replay.** A stored case can be re-evaluated against any other version.

**The missing-data guard.** The evaluator is three-valued: a rule returns true, false, or
*unknown* when an input it needs was not supplied. Unknown rules are reported as
**not evaluated**, never as "did not trigger", and a `R-DATA-INCOMPLETE` flag names the
fields involved. This directly implements the hazard control the project report calls
for — *missing data must not be interpreted as a negative clinical finding* — as code
rather than as a disclaimer.

**Language.** No branch of the engine produces the words "transfuse" or "do not
transfuse". The strongest output is `Priority clinician review`.

### 2.2 Readiness engine — `server/src/lib/readiness.js` *(the new feature)*

Given a recipient group, a component and a unit count, it answers: *if this were to go
ahead, could it be served, with which units, and at what cost to the rest of the shelf?*

```
recipient A+, 2 × PRBC
        │
        ├─ 1. COMPATIBILITY   A+ ← A+, A−, O+, O−   (preference order, scarcity marked)
        │
        ├─ 2. ALLOCATION      sort by (compatibility rank, then expiry, then id)
        │                     → U-000182  A+  expires 2026-11-02  (3d)  identical, FEFO
        │                     → U-000147  A+  expires 2026-11-09  (10d) identical, FEFO
        │
        ├─ 3. COVERAGE        compatible stock ÷ smoothed issue rate = 11.4 days
        │
        └─ 4. WASTAGE         units ≤7d from expiry; and if a compatible unit is ≤3d
                              from being discarded while the plan reaches for a fresher
                              one, say so explicitly
```

Three design decisions are worth defending at review:

**Why unit codes, not a stock count.** "4 units of A+ available" is not actionable — it
does not say whether they expire tomorrow, nor whether taking them strips the shelf of
its last O-negative. Naming units makes the consequence of the allocation visible.

**Why rank before expiry.** Pure FEFO would hand out O-negative first whenever it
happened to be oldest, draining the scarcest group to serve a patient who did not need
it. Sorting by compatibility rank first, then expiry within each rank, rotates stock
without spending scarce groups unnecessarily.

**Why the salvage suggestion is a prompt, not an action.** When a near-expiry compatible
unit sits outside the plan, the engine surfaces it rather than silently substituting it.
Substitution is a transfusion-service decision; the software's job is to make sure the
choice is visible before the unit is thrown away.

**Safety boundary.** Everything here is logistics. The panel states on every render that
availability is not an indication, and the engine never reserves or issues anything —
that requires the attested path in §3.

### 2.3 Forecasting — `server/src/lib/forecast.js`

The base paper forecasts demand with an LSTM. That is defensible at national scale with
years of history. For one blood bank with a few hundred issue records it would be
untrainable, unexplainable, and impossible for a reviewer to check.

HemoWise uses **Holt's linear exponential smoothing** instead: level plus trend, two
constants, no training infrastructure, and every number reproducible by hand from the
series. It reports its own mean absolute error, and when history is too short
(< 7 days) it says so rather than returning a confident-looking number.

Output feeds three places: days-of-cover in the readiness panel, the stock projection and
wastage estimate on the inventory page, and collection priority by group on the camps
page — which reframes the base paper's campaign optimisation from *where* to collect
(needs geographic data this project does not have) to *which groups* to call for.

### 2.4 Audit ledger — `server/src/audit.js`

Append-only, with each entry committing to the hash of its predecessor:

```
entry_n.hash = sha256(ts | actor | action | entity | detail | entry_{n-1}.hash)
```

Editing or deleting any historical row breaks every hash after it, and
`GET /api/audit/verify` recomputes the chain to prove it.

The base paper reaches for a blockchain to secure the blood supply chain. A distributed
ledger solves trust between mutually distrusting parties — the wrong problem for a single
hospital. The property that actually matters, *history cannot be silently rewritten*, is
kept here at the cost of one hash per write.

## 3. Safety controls that are code, not copy

The project report is firm that a disclaimer is not a safety control. Where a boundary
could be enforced, it is:

| Hazard | Control | Where |
|---|---|---|
| Missing value read as normal | Three-valued evaluation; unknown rules reported as unanswered | `lib/rules.js` |
| Incompatible unit reserved | Every unit re-checked against the ABO/Rh table inside the transaction | `routes/requests.js` |
| Units issued without crossmatch | Reservation rejected until all six pre-release checks are attested; attester recorded | `routes/requests.js` |
| Expired unit appears available | Expiry sweep runs before any view that reports availability | `services.js` |
| Untested blood reaching a patient | New units are `quarantined`; only a recorded screening pass releases them | `routes/donors.js` |
| Silent discard of a usable unit | Discard requires a reason and is logged | `routes/inventory.js` |
| Flag read as an order | No code path emits transfusion instructions | `lib/rules.js` |
| History quietly rewritten | Hash-chained ledger with a verify endpoint | `audit.js` |
| Rule change with unknown effect | Replay and impact analysis before activation | `routes/rulesets.js` |

## 4. Data model

```
donors ──< donations ──< units >── requests >── patients
             │                        │            │
           camps                 assessments ──> rule_sets
                                      │
                                  audit_log  (hash-chained over everything)
```

`units` is the centre of gravity: one row is one physical component, carrying its
donation, component type, group, collection and expiry dates, status, location, the
request that reserved it and the patient who received it. That single table is what makes
both directions of traceability possible.

**Status lifecycle:**

```
quarantined ──screening passed──> available ──reserve──> reserved ──issue──> issued
     │                                 │                      │
     └──screening failed──> discarded  ├──expiry sweep──> expired
                                       └──damage/recall──> discarded
```

## 5. Deliberate limitations

- Thresholds are demonstration values, not approved clinical policy.
- Compatibility is ABO/RhD group logic only — no antibody screen, no special requirements.
- Synthetic data cannot support any claim about accuracy or clinical utility.
- Sessions are bearer tokens in SQLite; a real deployment needs proper identity management.
- No FHIR/HL7 integration, so patient identity is local to this database.
- No machine-learning component. This is a considered decision: the project report
  requires that ML not be presented as validated, and a model trained on synthetic data
  would be theatre. Rules that can be read and checked are the honest choice at this stage.
