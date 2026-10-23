# HemoWise

**AI-assisted transfusion decision support and blood bank management system**
Final-year mini-project · Department of Computer Science Engineering

> **Academic prototype.** Every patient, donor and inventory record in this system is
> synthetic. HemoWise does not diagnose, does not decide whether a transfusion should
> happen, and does not perform crossmatching. It is not a medical device and has not
> been clinically validated.

---

## What it is

Blood-bank software and transfusion decision support are normally two different
systems. A blood bank knows what is on the shelf but nothing about the patient under
review; a transfusion-prediction tool models the patient but nothing about the shelf.
The clinician bridges the two by picking up the phone.

HemoWise closes that gap. A structured patient review and the operational answer —
*could this actually be served, with which units, and at what cost to the rest of the
shelf?* — appear side by side on one screen, and both are explainable line by line.

Around that core it implements the full vein-to-vein chain: donor registration and
eligibility screening, donation recording, component preparation with
component-specific expiry, quarantine until screening passes, compatibility-checked
reservation, issue to a patient, and a tamper-evident audit ledger over the lot.

## Quick start

```bash
npm run install:all     # install server and web dependencies
npm run seed            # create the database and load synthetic demonstration data
npm run build           # build the front end
npm start               # serve API + UI on http://localhost:4000
```

Then open **http://localhost:4000**.

For development with hot reload, run the two halves separately:

```bash
npm run dev:server      # API on :4000
npm run dev:web         # Vite dev server on :5173 (proxies /api to :4000)
```

### Sign in

| Username   | Password       | Role       | Can do                                            |
|------------|----------------|------------|---------------------------------------------------|
| `dr.anand` | `clinician123` | Clinician  | Register patients, run assessments, raise requests |
| `bb.kumar` | `bloodbank123` | Blood bank | Donors, donations, stock, reserve and issue units |
| `admin`    | `admin123`     | Admin      | Everything, plus rule governance and audit verify |

`npm run seed` is repeatable — rerun it any time to reset to a clean demonstration state.

## Running the tests

With the server running (`npm start` or `npm run dev:server`):

```bash
npm --prefix server run test:api    # 61 API and domain-logic checks
npm --prefix server run test:routes # every endpoint the UI calls, per role
npm --prefix web run test:ui        # mounts the real bundle in a DOM and walks every route
```

The UI test signs in, visits all 16 routes, drives the assessment form, and fails on
any console error or React warning.

## The modules

The six modules from the project proposal, and where each one lives:

| # | Module | Implementation |
|---|--------|----------------|
| 1 | Patient and clinical data input | `web/src/pages/NewAssessment.jsx`, `server/src/routes/patients.js` |
| 2 | Clinical context and rule-based flags | `server/src/lib/rules.js` |
| 3 | Explainable assessment summary | `web/src/components/clinical.jsx` |
| 4 | Blood-bank inventory management | `server/src/routes/inventory.js`, `server/src/lib/expiry.js` |
| 5 | Assessment history and audit trail | `server/src/audit.js`, `server/src/routes/assessments.js` |
| 6 | Safety notices and governance | `web/src/pages/Safety.jsx`, `server/src/routes/rulesets.js` |

Full mapping, including every endpoint and screen, is in
[`docs/MODULE_MAPPING.md`](docs/MODULE_MAPPING.md).

## What is new here

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full argument. In short, four
things that none of the surveyed systems do:

1. **Fulfilment readiness** — the clinical review and a unit-level allocation plan on
   one screen, naming real unit codes rather than reporting a stock count.
2. **Rule governance with replay** — rules are versioned data; a past case can be
   re-evaluated against a proposed version and the difference shown before approval.
3. **Wastage-aware allocation** — first-expiring-first-out within compatibility rank,
   and an explicit prompt when a near-expiry compatible unit could be used instead of
   a fresh one.
4. **Hash-chained audit ledger** — the supply-chain integrity the base paper seeks from
   a blockchain, at a cost proportionate to one institution.

## Project layout

```
server/
  src/
    schema.sql          database schema
    db.js               connection, migration, transactions
    auth.js             scrypt password hashing, sessions, role gates
    audit.js            hash-chained append-only ledger
    services.js         shared queries and engine wiring
    seed.js             synthetic demonstration data (deterministic)
    lib/
      rules.js          versioned rule engine + the seeded rule sets
      readiness.js      THE COUPLING ENGINE - compatibility, FEFO, coverage, wastage
      compatibility.js  ABO/Rh tables for red cells and plasma
      expiry.js         component shelf life and expiry buckets
      eligibility.js    donor screening criteria
      forecast.js       Holt exponential smoothing + stock projection
      validate.js       request validation
    routes/             one file per resource
web/
  src/
    pages/              16 screens
    components/         ui.jsx, clinical.jsx (flags + readiness), charts.jsx
    lib/                api client, auth context, fetch hook
docs/                   architecture, module mapping, test cases
```

## Technology

Node.js 24 with Express 5 and SQLite (via the built-in `node:sqlite` module — no native
build step), React 19 with Vite. Dependencies are kept deliberately minimal: the server
has two (`express`, `cors`), and the charts, rule engine, forecasting and hash chain are
all first-party code so that every number on screen can be traced to a line you can read.
