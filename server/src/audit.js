import { createHash } from 'node:crypto';
import { all, get, run, nowIso } from './db.js';

const GENESIS = '0'.repeat(64);

function digest({ ts, actor_id, action, entity, entity_id, detail_json, prev_hash }) {
  return createHash('sha256')
    .update([ts, actor_id ?? '', action, entity, entity_id ?? '', detail_json ?? '', prev_hash].join('|'))
    .digest('hex');
}

/**
 * Append one tamper-evident entry to the ledger.
 *
 * The base paper reaches for a blockchain to protect the blood supply chain.
 * A full chain is disproportionate for a single-institution prototype, so we
 * keep the property that actually matters -- history cannot be silently
 * rewritten -- by chaining each row's hash to its predecessor.
 */
export function audit(actor, action, entity, entityId, detail, at) {
  const prev = get('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const row = {
    // `at` is only supplied by the seed script, which replays synthetic history
    // and needs each entry stamped with the date the event is meant to have
    // happened. Live calls always use the current time.
    ts: at || nowIso(),
    actor_id: actor?.id ?? null,
    actor_name: actor?.full_name ?? actor?.username ?? 'system',
    action,
    entity,
    entity_id: entityId == null ? null : String(entityId),
    detail_json: detail === undefined ? null : JSON.stringify(detail),
    prev_hash: prev?.hash ?? GENESIS,
  };
  row.hash = digest(row);
  run(
    `INSERT INTO audit_log (ts, actor_id, actor_name, action, entity, entity_id, detail_json, prev_hash, hash)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    row.ts, row.actor_id, row.actor_name, row.action, row.entity,
    row.entity_id, row.detail_json, row.prev_hash, row.hash,
  );
  return row;
}

/** Recompute the whole chain and report the first row that does not match. */
export function verifyChain() {
  const rows = all('SELECT * FROM audit_log ORDER BY id ASC');
  let expectedPrev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== expectedPrev) {
      return { ok: false, brokenAt: r.id, reason: 'prev_hash does not match preceding entry', checked: rows.length };
    }
    if (digest(r) !== r.hash) {
      return { ok: false, brokenAt: r.id, reason: 'entry contents do not match stored hash', checked: rows.length };
    }
    expectedPrev = r.hash;
  }
  return { ok: true, checked: rows.length, head: expectedPrev === GENESIS ? null : expectedPrev };
}
