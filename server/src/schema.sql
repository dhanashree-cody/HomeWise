-- HemoWise schema. All data is SYNTHETIC / academic demonstration data.
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- identity
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('clinician','bloodbank','admin')),
  pw_salt       TEXT NOT NULL,
  pw_hash       TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------- patients
CREATE TABLE IF NOT EXISTS patients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mrn           TEXT NOT NULL UNIQUE,         -- synthetic medical record number
  full_name     TEXT NOT NULL,
  age           INTEGER NOT NULL,
  sex           TEXT NOT NULL CHECK (sex IN ('M','F','O')),
  blood_group   TEXT CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  ward          TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  created_by    INTEGER REFERENCES users(id)
);

-- ---------------------------------------------------------------- donors
CREATE TABLE IF NOT EXISTS donors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_code      TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  age             INTEGER NOT NULL,
  sex             TEXT NOT NULL CHECK (sex IN ('M','F','O')),
  blood_group     TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  weight_kg       REAL,
  phone           TEXT,
  last_donated_on TEXT,
  deferred_until  TEXT,
  deferral_reason TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS camps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  location      TEXT NOT NULL,
  scheduled_on  TEXT NOT NULL,
  target_units  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','cancelled')),
  organiser     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS donations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  donor_id      INTEGER NOT NULL REFERENCES donors(id),
  camp_id       INTEGER REFERENCES camps(id),
  donated_on    TEXT NOT NULL,
  hb_g_dl       REAL,
  volume_ml     INTEGER NOT NULL DEFAULT 450,
  screening     TEXT NOT NULL DEFAULT 'pending' CHECK (screening IN ('pending','passed','failed')),
  recorded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------- inventory
-- One row = one physical blood component unit (vein-to-vein traceability).
CREATE TABLE IF NOT EXISTS units (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_code     TEXT NOT NULL UNIQUE,
  donation_id   INTEGER REFERENCES donations(id),
  component     TEXT NOT NULL CHECK (component IN ('PRBC','WB','PLT','FFP','CRYO')),
  blood_group   TEXT NOT NULL CHECK (blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  volume_ml     INTEGER,
  collected_on  TEXT NOT NULL,
  expires_on    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('quarantined','available','reserved','issued','discarded','expired')),
  storage_loc   TEXT,
  reserved_for  INTEGER REFERENCES requests(id),
  issued_to     INTEGER REFERENCES patients(id),
  issued_on     TEXT,
  discard_reason TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_units_lookup ON units(component, blood_group, status, expires_on);

-- ---------------------------------------------------------------- rule sets
-- Versioned, governed rule sets. Rules are stored as transparent JSON so the
-- exact logic that produced a historical flag can always be re-read and replayed.
CREATE TABLE IF NOT EXISTS rule_sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  version       TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT,
  rules_json    TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 0,
  approved_by   TEXT,
  approved_on   TEXT,
  created_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------- assessments
CREATE TABLE IF NOT EXISTS assessments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients(id),
  rule_set_id    INTEGER NOT NULL REFERENCES rule_sets(id),
  clinical_context TEXT NOT NULL,
  hb_g_dl        REAL,
  heart_rate     INTEGER,
  systolic_bp    INTEGER,
  blood_group    TEXT,
  component      TEXT NOT NULL DEFAULT 'PRBC',
  units_requested INTEGER NOT NULL DEFAULT 1,
  active_bleeding INTEGER NOT NULL DEFAULT 0,
  prior_reaction  INTEGER NOT NULL DEFAULT 0,
  inputs_json     TEXT NOT NULL,   -- exact inputs as submitted
  flags_json      TEXT NOT NULL,   -- evaluated flags with evidence
  readiness_json  TEXT NOT NULL,   -- inventory coupling result
  review_status   TEXT NOT NULL,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assess_patient ON assessments(patient_id, created_at);

-- ---------------------------------------------------------------- requests
CREATE TABLE IF NOT EXISTS requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_code   TEXT NOT NULL UNIQUE,
  patient_id     INTEGER NOT NULL REFERENCES patients(id),
  assessment_id  INTEGER REFERENCES assessments(id),
  component      TEXT NOT NULL,
  blood_group    TEXT NOT NULL,
  units_requested INTEGER NOT NULL,
  urgency        TEXT NOT NULL CHECK (urgency IN ('routine','urgent','emergency')),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','reserved','issued','rejected','cancelled')),
  crossmatch_json TEXT,            -- compatibility checklist completed by blood bank
  note           TEXT,
  raised_by      INTEGER REFERENCES users(id),
  actioned_by    INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------- audit
-- Append-only, hash-chained ledger. Each row commits to the previous row's
-- hash, so any silent edit or deletion of history becomes detectable.
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  actor_id      INTEGER,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     TEXT,
  detail_json   TEXT,
  prev_hash     TEXT NOT NULL,
  hash          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(id DESC);
