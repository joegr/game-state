// game-state — the organizer's private actions, decided in one place.
//
// Accepting teams and scores is private and reversible: it writes the
// organizer-owned files (admitted.md, accepted.md) or drops an organizer entry
// into inbox/ for the batch to apply (rejections, unlocks, new PINs). This
// module only DECIDES. It takes the live record and queue and returns what to
// write, or why not. The organizer bar (js/organizer.js) and the CLI
// (tools/advance.mjs) both carry out exactly these decisions, so the two can
// never disagree about what is allowed.
//
// ctx: { record, queue } — record from reconstruct(); queue with signups,
// scores, attempts, admitted, accepted, inboxNames, admittedSha, acceptedSha.
//
// Returns { ok: false, error } or
//   { ok: true, message, write?: { path, content, message, sha }, entry?, batch? }
// `write` is a compare-and-swap against the sha the queue was read at.
// `entry` is an organizer inbox entry (the caller adds `at` and names it),
// and `batch` asks for a batch run so it lands promptly.

import {
  gate, validateResult, computeQueue, roundOpenMatches, advanceCheck, pruneScores,
  formatAdmittedMd, formatAcceptedMd,
} from './engine.js';
import { describeName } from './pipeline.js';

const no = (error) => ({ ok: false, error });
const gated = (action, record) => { const g = gate(action, record.stage); return g.ok ? null : no(g.error); };
const up = (s) => String(s || '').trim().toUpperCase();

export const waitingSignups = (q) => q.signups.filter((s) => !q.admitted.some((a) => a.fp === s.fp));

// ---- teams ------------------------------------------------------------------------

// codes: an array of team codes, or 'all'.
export function decideAdmit({ record, queue: q }, codes) {
  const g = gated('signup:admit', record); if (g) return g;
  let waiting = waitingSignups(q);
  if (codes !== 'all') {
    const want = (codes || []).map(up).filter(Boolean);
    if (!want.length) return no('Name the teams to admit.');
    const missing = want.filter((c) => !waiting.some((s) => s.fp === c));
    if (missing.length) return no(`Not waiting: ${missing.join(', ')}. New registrations appear after the next batch.`);
    waiting = waiting.filter((s) => want.includes(s.fp));
  }
  if (!waiting.length) return no('Nobody is waiting.');
  const room = record.progress.capacity - q.admitted.length;
  if (room <= 0) return no(`Admitted is at capacity (${record.progress.capacity}).`);
  const taking = waiting.slice(0, room);
  const next = [...q.admitted, ...taking.map((s) => ({ fp: s.fp, tokenHash: s.tokenHash, registeredAt: s.submittedAt }))];
  const codesTaken = taking.map((s) => s.fp).join(' ');
  return {
    ok: true,
    message: `Admitted ${codesTaken} (${next.length}/${record.progress.capacity}). Private until registration closes or the draw.`
      + (taking.length < waiting.length ? ` ${waiting.length - taking.length} not admitted — capacity reached.` : ''),
    write: { path: 'admitted.md', content: formatAdmittedMd(next), message: `admit: ${codesTaken}`, sha: q.admittedSha },
  };
}

export function decideUnadmit({ record, queue: q }, code) {
  const g = gated('signup:admit', record); if (g) return g;
  const fp = up(code);
  if (!q.admitted.some((a) => a.fp === fp)) return no(`${fp || '(none given)'} is not admitted.`);
  return {
    ok: true,
    message: `${fp} is back in the waiting list.${record.roster.some((t) => t.fp === fp) ? ' It stays on the published roster until the next close or draw republishes it.' : ''}`,
    write: { path: 'admitted.md', content: formatAdmittedMd(q.admitted.filter((a) => a.fp !== fp)), message: `unadmit: ${fp}`, sha: q.admittedSha },
  };
}

export function decideRejectSignup({ record, queue: q }, code, note) {
  const g = gated('signup:reject', record); if (g) return g;
  const fp = up(code);
  if (!fp) return no('Name the team to reject.');
  if (q.admitted.some((a) => a.fp === fp)) return no(`${fp} is admitted — un-admit it first.`);
  if (!q.signups.some((s) => s.fp === fp) && !q.inboxNames.some((n) => describeName(n)?.team === fp)) return no(`No registration for ${fp}.`);
  return { ok: true, message: `Rejection of ${fp} queued; it lands at the next batch.`, entry: { kind: 'org-reject-signup', team: fp, note: note || undefined }, batch: true };
}

// ---- scores -----------------------------------------------------------------------

function scoreCtx(record, q) {
  const open = roundOpenMatches(record);
  const cq = computeQueue(record.state, pruneScores(q.scores, record));
  return { open, cq };
}

function afterAccept(record, rows) {
  const c = advanceCheck(record, rows);
  return c.ok ? ` Round ${record.round} is fully accepted — ready to advance.` : ` ${c.missing?.length ?? 0} match(es) left in round ${record.round}.`;
}

// ids: an array of match ids, or 'all' (every agreed, unaccepted match).
export function decideConfirm({ record, queue: q }, ids, now = new Date().toISOString()) {
  const g = gated('score:accept', record); if (g) return g;
  const { open, cq } = scoreCtx(record, q);
  const agreed = Object.entries(cq).filter(([id, v]) => v.status === 'agreed' && open.has(id) && !q.accepted.some((r) => r.matchId === id)).map(([id]) => id);
  let take;
  if (ids === 'all') take = agreed;
  else {
    const id = (ids || [])[0];
    if (!id) return no(`Name a match. Agreed and not yet accepted: ${agreed.join(' ') || '(none)'}`);
    if (!open.has(id)) return no(`${id} is not open in round ${record.round}.`);
    if (q.accepted.some((r) => r.matchId === id)) return no(`${id} is already accepted.`);
    if (!cq[id]) return no(`Nothing submitted for ${id}.`);
    if (cq[id].status !== 'agreed') return no(`${id} is ${cq[id].status}, not agreed — decide it yourself instead.`);
    take = [id];
  }
  if (!take.length) return no('No agreed results waiting.');
  const rows = [...q.accepted];
  const lines = [];
  for (const id of take) {
    const v = cq[id];
    const r = { matchId: id, winner: v.winner, scoreWinner: Math.max(v.scoreA, v.scoreB), scoreLoser: Math.min(v.scoreA, v.scoreB), confirmedAt: now };
    const ok = validateResult(record.state, r);
    if (!ok.ok) return no(`${id}: ${ok.error} Nothing was accepted.`);
    rows.push(r);
    lines.push(`${id} → ${r.winner} ${r.scoreWinner}-${r.scoreLoser}`);
  }
  return {
    ok: true,
    message: `Accepted ${lines.join(', ')}.${afterAccept(record, rows)}`,
    write: { path: 'accepted.md', content: formatAcceptedMd(rows), message: `accept: ${take.join(' ')}`, sha: q.acceptedSha },
  };
}

// Decide a match yourself: a dispute, a tie claim, or a walkover.
export function decideResult({ record, queue: q }, id, winner, scoreWinner, scoreLoser, now = new Date().toISOString()) {
  const g = gated('score:accept', record); if (g) return g;
  if (!id || !winner || scoreWinner === '' || scoreWinner == null || scoreLoser === '' || scoreLoser == null) return no('Give the match, the winner and both scores.');
  if (!roundOpenMatches(record).has(id)) return no(`${id} is not open in round ${record.round}.`);
  if (q.accepted.some((r) => r.matchId === id)) return no(`${id} is already accepted — take it back first.`);
  const r = { matchId: id, winner: up(winner), scoreWinner: Number(scoreWinner), scoreLoser: Number(scoreLoser), confirmedAt: now };
  const v = validateResult(record.state, r);
  if (!v.ok) return no(`${id}: ${v.error}`);
  const rows = [...q.accepted, r];
  return {
    ok: true,
    message: `Accepted ${id} → ${r.winner} ${r.scoreWinner}-${r.scoreLoser} (decided by you).${afterAccept(record, rows)}`,
    write: { path: 'accepted.md', content: formatAcceptedMd(rows), message: `result: ${id} -> ${r.winner}`, sha: q.acceptedSha },
  };
}

export function decideUnconfirm({ record, queue: q }, id) {
  const g = gated('score:accept', record); if (g) return g;
  if (!q.accepted.some((r) => r.matchId === id)) return no(`${id || '(none given)'} is not accepted.`);
  if (record.results.some((r) => r.matchId === id)) return no(`${id} is already published — it can't be taken back.`);
  return {
    ok: true,
    message: `${id} is back in the queue.`,
    write: { path: 'accepted.md', content: formatAcceptedMd(q.accepted.filter((r) => r.matchId !== id)), message: `unaccept: ${id}`, sha: q.acceptedSha },
  };
}

// Clear submissions so the captains resubmit: both, or one team's (code).
export function decideRejectScore({ record }, id, code, note) {
  const g = gated('score:reject', record); if (g) return g;
  if (!id) return no('Name the match.');
  if (!roundOpenMatches(record).has(id)) return no(`${id} is not open in round ${record.round}.`);
  const fp = code ? up(code) : undefined;
  return { ok: true, message: `Clearing ${fp ? `${fp}'s` : 'both'} submission(s) for ${id}; it lands at the next batch.`, entry: { kind: 'org-reject-score', match: id, team: fp, note: note || undefined }, batch: true };
}

// ---- PINs ---------------------------------------------------------------------------

export function decideUnlock(_ctx, code) {
  const fp = up(code);
  if (!fp) return no('Name the team to unlock.');
  return { ok: true, message: `Unlock of ${fp} queued; it lands at the next batch.`, entry: { kind: 'org-unlock', team: fp }, batch: true };
}

// The caller generates the PIN (randomPin) and its hash (pinHash), shows the
// PIN to the organizer, and never stores or sends it anywhere else.
export function decideRepin({ queue: q }, code, newPinHash) {
  const fp = up(code);
  if (!fp) return no('Name the team.');
  if (!q.signups.some((s) => s.fp === fp)) return no(`No registration for ${fp}.`);
  return { ok: true, message: `New PIN for ${fp} queued; the old PIN stops working at the next batch.`, entry: { kind: 'org-repin', team: fp, pinHash: newPinHash }, batch: true };
}
