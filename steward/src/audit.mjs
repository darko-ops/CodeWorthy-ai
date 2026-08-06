// Append-only, hash-chained audit log (SOC 2 seed).
//
// Every event extends a per-repository chain: hash = sha256(prev_hash +
// canonical(event)). The database role can only INSERT/SELECT (db/schema.sql),
// so the chain plus the grants make the log tamper-evident AND
// tamper-resistant. `plain_english` is written at event time — the log a
// founder reads and the evidence an auditor inspects are the same rows.
import { createHash } from "node:crypto";

export const GENESIS = "genesis";

// Canonical serialization: stable key order, so hashes are reproducible.
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

export function chainHash(prevHash, event) {
  const body = canonical({
    installation_id: event.installationId,
    repo: event.repo,
    actor: event.actor,
    event_type: event.eventType,
    payload: event.payload,
    plain_english: event.plainEnglish,
  });
  return createHash("sha256").update(prevHash + body).digest("hex");
}

// Advisory-lock key for a repo's chain so concurrent appends serialize.
function lockKey(repo) {
  return createHash("sha256").update(repo).digest().readInt32BE(0);
}

export async function appendEvent(pool, event) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey(event.repo)]);
    const last = await client.query(
      "SELECT hash FROM audit_events WHERE repo = $1 ORDER BY id DESC LIMIT 1",
      [event.repo]
    );
    const prevHash = last.rows[0]?.hash ?? GENESIS;
    const hash = chainHash(prevHash, event);
    const inserted = await client.query(
      `INSERT INTO audit_events
         (installation_id, repo, actor, event_type, payload, plain_english, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, occurred_at`,
      [
        event.installationId,
        event.repo,
        event.actor,
        event.eventType,
        JSON.stringify(event.payload),
        event.plainEnglish,
        prevHash,
        hash,
      ]
    );
    await client.query("COMMIT");
    return { id: inserted.rows[0].id, hash, prevHash };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Walk a repo's chain and recompute every hash. Returns { ok, brokenAtId }.
export async function verifyChain(pool, repo) {
  const res = await pool.query(
    `SELECT id, installation_id, repo, actor, event_type, payload, plain_english, prev_hash, hash
     FROM audit_events WHERE repo = $1 ORDER BY id ASC`,
    [repo]
  );
  let expectedPrev = GENESIS;
  for (const row of res.rows) {
    const recomputed = chainHash(row.prev_hash, {
      installationId: Number(row.installation_id),
      repo: row.repo,
      actor: row.actor,
      eventType: row.event_type,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      plainEnglish: row.plain_english,
    });
    if (row.prev_hash !== expectedPrev || recomputed !== row.hash) {
      return { ok: false, brokenAtId: Number(row.id) };
    }
    expectedPrev = row.hash;
  }
  return { ok: true, count: res.rows.length, head: expectedPrev };
}

// The plain-language change log: newest first, ready to render.
export async function changeLog(pool, repo, limit = 100) {
  const res = await pool.query(
    `SELECT occurred_at, actor, event_type, plain_english
     FROM audit_events WHERE repo = $1 ORDER BY id DESC LIMIT $2`,
    [repo, limit]
  );
  return res.rows;
}
