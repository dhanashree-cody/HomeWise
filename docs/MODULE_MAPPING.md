# Module mapping

Traces each module from the project proposal to the code, the API and the screen that
implements it. Useful for the review demonstration and for the implementation chapter of
the report.

## Module 1 — Patient and clinical data input

| | |
|---|---|
| **Proposal** | Captures demo patient ID, age, clinical context, haemoglobin, heart rate, systolic BP, blood group, active-bleeding status and transfusion-reaction history. Synthetic data only. |
| **Screen** | `web/src/pages/NewAssessment.jsx`, `web/src/pages/Patients.jsx` |
| **API** | `POST /api/patients`, `GET /api/patients`, `POST /api/assessments/preview` |
| **Server** | `server/src/routes/patients.js`, `server/src/lib/validate.js` |
| **Beyond the proposal** | Patients are a persisted register with a generated synthetic MRN, not a single form. Validation collects every field error at once. A blank numeric field is preserved as *unknown* rather than coerced to zero. |

## Module 2 — Clinical context and rule-based flags

| | |
|---|---|
| **Proposal** | Checks entered values against simple, visible demonstration rules. Not a validated clinical algorithm. |
| **Engine** | `server/src/lib/rules.js` |
| **API** | `POST /api/assessments/preview`, `GET /api/rulesets/:id` |
| **Rules** | 10 in v1.0.0: critical/low haemoglobin, cardiac-context threshold, active bleeding, hypotension, shock index, tachycardia, reaction history, elderly advisory, restrictive-strategy note, plus the data-quality guard |
| **Beyond the proposal** | Rules are versioned JSON rather than hard-coded conditions. Evaluation is three-valued, so missing inputs produce *not evaluated* instead of *did not trigger*. The shock index is a composite of two entered observations rather than either read alone. |

## Module 3 — Explainable assessment summary

| | |
|---|---|
| **Proposal** | Shows entered details, triggered flags and a next-step message. Does not calculate a validated score. |
| **Screen** | `web/src/components/clinical.jsx` (`Flag`, `FlagList`, `ReviewStatusBanner`), `web/src/pages/AssessmentDetail.jsx` |
| **Beyond the proposal** | Each flag expands to the exact evidence — observed value, operator, threshold — plus the rationale, rule id and rule-set version. Review status is one of five review-prompt phrases; no code path emits a transfusion instruction. |

## Module 4 — Blood-bank inventory management

| | |
|---|---|
| **Proposal** | Displays simulated blood-group stock and allows demo units to be added. |
| **Screen** | `web/src/pages/Inventory.jsx` |
| **API** | `GET /api/inventory/summary`, `/units`, `/readiness`, `/forecast`; `POST /api/inventory/units`, `/units/:id/discard`, `/units/:id/release` |
| **Server** | `server/src/routes/inventory.js`, `lib/expiry.js`, `lib/compatibility.js` |
| **Beyond the proposal** | Unit-level rather than a per-group counter. Each unit carries component type, donation link, collection and expiry dates, status, storage location. Expiry is derived from component shelf life (PRBC 42d, whole blood 35d, platelets 5d, plasma/cryo 365d) and never typed by hand. Expired units are swept out of availability before any view reports stock. Discard requires a reason. |

## Module 5 — Assessment history and audit trail

| | |
|---|---|
| **Proposal** | Records assessments created during the session. Persistent storage and secure audit logging listed as future work. |
| **Screen** | `web/src/pages/Assessments.jsx`, `AssessmentDetail.jsx`, `AuditLog.jsx` |
| **API** | `GET /api/assessments`, `/assessments/:id`, `/audit`, `/audit/verify` |
| **Server** | `server/src/audit.js` |
| **Beyond the proposal** | History is persisted in SQLite, not session state — this was listed as future work and is implemented. The audit log is append-only and hash-chained, with a verification endpoint that recomputes the whole chain. Every entry records actor, timestamp, action, entity and detail. |

## Module 6 — Safety notices and governance

| | |
|---|---|
| **Proposal** | Displays prototype limitations and the need for clinician oversight. |
| **Screen** | `web/src/pages/Safety.jsx`; `SafetyBar` on every authenticated screen |
| **API** | `GET /api/rulesets`, `/rulesets/:a/compare/:b`; `POST /api/rulesets/:id/activate` |
| **Beyond the proposal** | Governance is implemented, not just described: rule sets carry version, approver and approval date; activation is admin-only and logged; two versions can be compared both textually and by replaying every stored case through both. |

---

## Added beyond the six modules

These were in the project title or the cited literature but not in the module list.

### Donor management and the vein-to-vein chain

`web/src/pages/Donors.jsx`, `DonorDetail.jsx`, `Trace.jsx` · `server/src/routes/donors.js`, `lib/eligibility.js`

Donor register, eligibility screening against five published criteria (age, weight,
haemoglobin, inter-donation interval, active deferrals), deferral recording, donation
recording that creates the physical units, quarantine until screening passes, and
`GET /api/requests/trace/:unitCode` which walks donor → camp → donation → unit → request
→ patient in both directions.

Eligibility can be overridden, but only with a reason, and the override is written to the
audit ledger.

### Request lifecycle with pre-release attestation

`web/src/pages/Requests.jsx`, `RequestDetail.jsx` · `server/src/routes/requests.js`

`pending → reserved → issued`, with `rejected` as an exit. Reservation is refused until
all six pre-release checks are attested, and every unit is re-verified for availability,
component, expiry and ABO/RhD compatibility inside the transaction — the readiness
engine's suggestion is never trusted as authorisation.

### Fulfilment readiness — the project's contribution

`server/src/lib/readiness.js` · `web/src/components/clinical.jsx`

See [`ARCHITECTURE.md`](ARCHITECTURE.md) §2.2.

### Demand forecasting and collection priority

`server/src/lib/forecast.js` · `web/src/pages/Camps.jsx`

Holt exponential smoothing over recent issues, stock projection with stockout date and
wastage estimate, and collection priority ranked by days of cover per group.

### Roles and access control

`server/src/auth.js`

Three roles — clinician, blood bank, admin — enforced server-side. A clinician cannot add
stock or issue units; blood-bank staff cannot create patients or assessments; only admin
can activate a rule set. The project report listed the role model as not implemented.

---

## API surface

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | Sign in |
| POST | `/api/auth/logout` | any | End session |
| GET | `/api/auth/me` | any | Current user |
| GET | `/api/dashboard` | any | KPIs, stock, trend, open work |
| GET | `/api/patients` | any | List / search |
| POST | `/api/patients` | clinician | Register |
| GET | `/api/patients/:id` | any | Record with history |
| PATCH | `/api/patients/:id` | clinician | Update |
| POST | `/api/assessments/preview` | any | Evaluate without saving |
| POST | `/api/assessments` | clinician | Save assessment |
| GET | `/api/assessments` | any | History |
| GET | `/api/assessments/:id` | any | Detail |
| GET | `/api/assessments/:id/replay/:ruleSetId` | any | Replay against another version |
| GET | `/api/assessments/meta/contexts` | any | Form options |
| GET | `/api/inventory/summary` | any | Stock by group and component |
| GET | `/api/inventory/units` | any | Unit register (filterable) |
| GET | `/api/inventory/readiness` | any | Standalone readiness check |
| GET | `/api/inventory/forecast` | any | Demand fit and stock projection |
| POST | `/api/inventory/units` | bloodbank | Add stock |
| POST | `/api/inventory/units/:id/discard` | bloodbank | Discard with reason |
| POST | `/api/inventory/units/:id/release` | bloodbank | Return to shelf |
| GET | `/api/donors` | any | Register with eligibility |
| POST | `/api/donors` | bloodbank | Register donor |
| GET | `/api/donors/:id` | any | Donor record |
| POST | `/api/donors/:id/screen` | bloodbank | Eligibility with measured Hb |
| POST | `/api/donors/:id/defer` | bloodbank | Record deferral |
| POST | `/api/donors/:id/donate` | bloodbank | Record donation, create units |
| POST | `/api/donors/donations/:id/screening` | bloodbank | Release or discard quarantine |
| GET | `/api/donors/donations/pending` | any | Awaiting screening |
| GET | `/api/camps` | any | Camps |
| POST | `/api/camps` | bloodbank | Schedule |
| PATCH | `/api/camps/:id/status` | bloodbank | Change status |
| GET | `/api/camps/collection-priority` | any | Groups ranked by days of cover |
| GET | `/api/requests` | any | Request queue |
| POST | `/api/requests` | clinician | Raise request |
| GET | `/api/requests/:id` | any | Detail with live readiness |
| POST | `/api/requests/:id/reserve` | bloodbank | Attest and reserve |
| POST | `/api/requests/:id/issue` | bloodbank | Issue to patient |
| POST | `/api/requests/:id/reject` | bloodbank | Reject with reason |
| GET | `/api/requests/checklist` | any | Pre-release checklist |
| GET | `/api/requests/trace/:unitCode` | any | Vein-to-vein trace |
| GET | `/api/rulesets` | any | Versions |
| GET | `/api/rulesets/:id` | any | Rules in a version |
| GET | `/api/rulesets/:a/compare/:b` | any | Diff plus impact replay |
| POST | `/api/rulesets/:id/activate` | admin | Activate a version |
| GET | `/api/audit` | any | Ledger |
| GET | `/api/audit/verify` | bloodbank/admin | Recompute the hash chain |
