// game-state — stage gates, record invariants, and the intake → queue →
// accept → publish pipeline. These are the guarantees that scores and winner
// logic can't be broken, so every refusal is tested as hard as every success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconstruct, gate, GATES, validateSubmission, validateResult, roundOpenMatches, advanceCheck,
  upsertScore, pruneScores, formatRosterMd, formatResultsMd, buildDraw, applyResult, MAX_PIN_ATTEMPTS,
} from '../js/engine.js';
import {
  decideIntake, foldBatch, planTransition, parseEntry, describeName, attemptCount, formatEntry, entryName,
} from '../js/pipeline.js';
import { randomToken, generateCode, hashToken, pinHash } from '../js/identity.js';

const PHASES = [
  { id: 'signup', kind: 'signup', label: 'Registration', blurb: '' },
  { id: 'knockout', kind: 'knockout', label: 'Knockout', blurb: '' },
  { id: 'complete', kind: 'complete', label: 'Done', blurb: '' },
];
const T = (over = {}) => ({
  name: 'Cup', tagline: '', teamCount: 8, groupSize: 4, format: 'single-elimination',
  appRepo: 'o/app', rosterRepo: 'o/roster', tentativeRepo: 'o/t',
  activePhase: 'signup', drawSeed: null, round: null, phases: PHASES, ...over,
});
const codes = (n) => Array.from({ length: n }, (_, i) => `T${String(i).padStart(3, '0')}`);
const rosterMd = (cs) => formatRosterMd(cs.map((fp) => ({ fp, tokenHash: 'h', registeredAt: 't' })));
const rec = (t, cs = [], results = []) => reconstruct(t, rosterMd(cs), formatResultsMd(results));
const res = (matchId, winner, w = 2, l = 1) => ({ matchId, winner, scoreWinner: w, scoreLoser: l, confirmedAt: 't' });

// ---- stages -------------------------------------------------------------------------

test('stage is derived: registration → closed → round k → complete', () => {
  assert.equal(rec(T()).stage, 'registration');
  assert.equal(rec(T({ activePhase: 'knockout' })).stage, 'closed');
  const r1 = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), codes(4));
  assert.equal(r1.stage, 'round');
  assert.equal(r1.round, 1);

  const s = buildDraw(codes(4), 's');
  const round1 = s.rounds[0].matches.map((m) => res(m.id, m.a));
  for (const m of s.rounds[0].matches) applyResult(s, m.id, m.a);
  const final = s.rounds[1].matches[0];
  const all = [...round1, res(final.id, final.a)];
  assert.equal(rec(T({ activePhase: 'complete', drawSeed: 's', round: 'done' }), codes(4), all).stage, 'complete');
});

test('the gate table: each action is allowed in exactly the stages listed, and never when invalid', () => {
  for (const [action, stages] of Object.entries(GATES)) {
    for (const st of ['registration', 'closed', 'round', 'complete', 'invalid']) {
      assert.equal(gate(action, st).ok, stages.includes(st), `${action} in ${st}`);
    }
  }
  assert.match(gate('draw', 'invalid').error, /inconsistent/);
  assert.equal(gate('made-up', 'round').ok, false);
});

// ---- invariants: a broken record freezes everything --------------------------------------

test('invalid: results without a draw, a seed without a round, a round that does not exist', () => {
  assert.match(rec(T(), codes(4), [res('r4-m1', 'T000')]).errors.join(), /no draw seed/);
  assert.match(rec(T({ activePhase: 'knockout', drawSeed: 's' }), codes(4)).errors.join(), /no Round/);
  assert.match(rec(T({ activePhase: 'knockout', drawSeed: 's', round: 7 }), codes(4)).errors.join(), /does not exist/);
  assert.match(rec(T({ activePhase: 'signup', drawSeed: 's', round: 1 }), codes(4)).errors.join(), /still a signup phase/);
  assert.match(rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), codes(1)).errors.join(), /fewer than 2/);
});

test('invalid: a result for a team that did not play, a duplicate, a non-decisive score, a future round', () => {
  const t = T({ activePhase: 'knockout', drawSeed: 's', round: 1 });
  const s = buildDraw(codes(4), 's');
  const [m1] = s.rounds[0].matches;
  const outsider = codes(4).find((c) => c !== m1.a && c !== m1.b);
  assert.match(rec(t, codes(4), [res(m1.id, outsider)]).errors.join(), /did not play/);
  assert.match(rec(t, codes(4), [res(m1.id, m1.a), res(m1.id, m1.b)]).errors.join(), /already decided/);
  assert.match(rec(t, codes(4), [res(m1.id, m1.a, 1, 1)]).errors.join(), /must be higher/);
  assert.match(rec(t, codes(4), [res(m1.id, m1.a, 1, 3)]).errors.join(), /must be higher/);
  assert.match(rec(t, codes(4), [res('r2-m1', m1.a)]).errors.join(), /round 2/);
  assert.equal(rec(t, codes(4), [res(m1.id, outsider)]).stage, 'invalid');
});

test('invalid: round k is current but an earlier round is not fully decided', () => {
  const s = buildDraw(codes(4), 's');
  const [m1] = s.rounds[0].matches;
  const r = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 2 }), codes(4), [res(m1.id, m1.a)]);
  assert.match(r.errors.join(), /round 1 still has undecided/);
});

test('invalid: duplicate or malformed codes, over capacity', () => {
  assert.match(rec(T(), ['T000', 'T000']).errors.join(), /more than once/);
  assert.match(rec(T(), ['t00']).errors.join(), /malformed/);
  assert.match(rec(T({ teamCount: 2 }), codes(3)).errors.join(), /capacity/);
});

// ---- the round bound -----------------------------------------------------------------------

test('only the current round is open — later rounds stay shut even once their teams are known', () => {
  const s = buildDraw(codes(4), 's');
  const round1 = s.rounds[0].matches.map((m) => res(m.id, m.a));
  // Round 1 published but Round still 1 (the instant inside an advance): round 2 is NOT open.
  const r = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), codes(4), round1);
  assert.equal(r.stage, 'round');
  assert.equal(roundOpenMatches(r).size, 0);
  const r2 = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 2 }), codes(4), round1);
  assert.deepEqual([...roundOpenMatches(r2).keys()], ['r2-m1']);
});

test('validateSubmission: current round, own match, decisive whole-number score, not already accepted', () => {
  const r = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), codes(4));
  const [[id, { a, b }]] = [...roundOpenMatches(r)];
  const other = codes(4).find((c) => c !== a && c !== b);
  assert.equal(validateSubmission(r, a, { matchId: id, myScore: 2, oppScore: 1 }).opponent, b);
  assert.match(validateSubmission(r, other, { matchId: id, myScore: 2, oppScore: 1 }).error, /not in match/);
  assert.match(validateSubmission(r, a, { matchId: 'r2-m1', myScore: 2, oppScore: 1 }).error, /not open in round 1/);
  assert.match(validateSubmission(r, a, { matchId: id, myScore: 1, oppScore: 1 }).error, /tie/);
  assert.match(validateSubmission(r, a, { matchId: id, myScore: 1.5, oppScore: 1 }).error, /whole numbers/);
  assert.match(validateSubmission(r, a, { matchId: id, myScore: 2, oppScore: 1 }, [res(id, a)]).error, /already accepted/);
  assert.match(validateSubmission(rec(T()), a, { matchId: id, myScore: 2, oppScore: 1 }).error, /draw/);
});

test('upsertScore replaces; pruneScores keeps only the current round’s open matches', () => {
  const r = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), codes(4));
  const [[m1, s1], [m2]] = [...roundOpenMatches(r)];
  let q = upsertScore([], { matchId: m1, reporterFp: s1.a, myScore: 1, oppScore: 0, ts: '1' });
  q = upsertScore(q, { matchId: m1, reporterFp: s1.a, myScore: 3, oppScore: 0, ts: '2' });
  q = upsertScore(q, { matchId: 'r2-m1', reporterFp: s1.a, myScore: 3, oppScore: 0, ts: '3' });
  assert.equal(q.filter((x) => x.matchId === m1).length, 1);
  assert.deepEqual(pruneScores(q, r).map((x) => x.matchId), [m1]);
  assert.deepEqual(pruneScores(q, rec(T())), []);
  assert.ok(m2);
});

test('advanceCheck: refuses until every match in the round is accepted, then lists exactly those', () => {
  const r = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), codes(4));
  const open = [...roundOpenMatches(r)];
  assert.match(advanceCheck(r, [res(open[0][0], open[0][1].a)]).error, /1 match\(es\).*no accepted result/);
  const ok = advanceCheck(r, open.map(([id, s]) => res(id, s.a)));
  assert.equal(ok.ok, true);
  assert.equal(ok.rows.length, 2);
  assert.equal(ok.next, 2);
  assert.match(advanceCheck(r, [res(open[0][0], 'ZZZZ'), res(open[1][0], open[1][1].a)]).error, /not valid/);
  assert.equal(advanceCheck(rec(T()), []).ok, false);
});

// ---- intake --------------------------------------------------------------------------------

const baseCtx = (record, over = {}) => ({
  record, signups: [], scores: [], attempts: [], admitted: [], accepted: [], inboxNames: [],
  now: '2026-09-22T10:00:00.000Z', rand: 'abc123', receipt: 'receipt01', ...over,
});

test('intake signup: gated to registration; writes one new inbox file; never the raw PIN', async () => {
  const token = randomToken();
  const d = await decideIntake('signup', { token, pin: '0420' }, baseCtx(rec(T())));
  assert.equal(d.accepted, true);
  assert.equal(d.code, await generateCode(token));
  assert.equal(d.entries.length, 1);
  assert.match(d.entries[0].name, /^inbox\/20260922T100000000Z-abc123-signup-[A-Z0-9]{4}\.md$/);
  assert.ok(!d.entries[0].text.includes('0420'));
  assert.equal(parseEntry(d.entries[0].text).pinHash, await pinHash(d.code, '0420'));

  const closed = await decideIntake('signup', { token: randomToken(), pin: '0420' }, baseCtx(rec(T({ activePhase: 'knockout' }))));
  assert.equal(closed.accepted, false);
  assert.match(closed.message, /registration is not open/);
});

test('intake signup: duplicates caught across the queue, the admitted list, and the unbatched inbox', async () => {
  const token = randomToken();
  const fp = await generateCode(token);
  const r = rec(T());
  for (const over of [
    { signups: [{ fp, tokenHash: 'h', pinHash: 'p', submittedAt: 't' }] },
    { admitted: [{ fp, tokenHash: 'h', registeredAt: 't' }] },
    { inboxNames: [`inbox/20260922T090000000Z-xyz-signup-${fp}.md`] },
  ]) {
    const d = await decideIntake('signup', { token, pin: '1111' }, baseCtx(r, over));
    assert.equal(d.accepted, false, JSON.stringify(Object.keys(over)));
  }
});

async function registered(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const token = randomToken();
    const fp = await generateCode(token);
    const pin = String(1000 + i);
    out.push({ fp, pin, signup: { fp, tokenHash: await hashToken(token), pinHash: await pinHash(fp, pin), submittedAt: 't' } });
  }
  return out;
}

test('intake score: PIN, lockout, roster, round, match — each refused on its own terms', async () => {
  const teams = await registered(4);
  const cs = teams.map((x) => x.fp);
  const r = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), cs);
  const [[id, s]] = [...roundOpenMatches(r)];
  const A = teams.find((x) => x.fp === s.a);
  const ctx = (over) => baseCtx(r, { signups: teams.map((x) => x.signup), ...over });
  const sub = (over = {}) => ({ code: A.fp, pin: A.pin, matchId: id, myScore: 2, oppScore: 1, ...over });

  const ok = await decideIntake('score', sub(), ctx());
  assert.equal(ok.accepted, true);
  assert.match(ok.entries[0].name, new RegExp(`-score-${A.fp}-${id}\\.md$`));
  assert.match(ok.message, /Waiting for/);

  const wrong = await decideIntake('score', sub({ pin: '9999' }), ctx());
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.entries.length, 1, 'a wrong PIN records an attempt');
  assert.match(wrong.message, new RegExp(`${MAX_PIN_ATTEMPTS - 1} attempts left`));

  const lockedNames = Array.from({ length: MAX_PIN_ATTEMPTS }, (_, i) => `inbox/20260922T0900000${String(i).padStart(2, '0')}Z-x${i}-attempt-${A.fp}.md`);
  const locked = await decideIntake('score', sub(), ctx({ inboxNames: lockedNames }));
  assert.match(locked.message, /locked/);
  assert.equal(locked.entries.length, 0, 'a locked team writes nothing');

  const cleared = await decideIntake('score', sub(), ctx({ inboxNames: [...lockedNames, `inbox/20260922T095959999Z-zz-org-unlock-${A.fp}.md`] }));
  assert.equal(cleared.accepted, true, 'an unlock queued after the attempts clears the lockout');

  const oneBad = await decideIntake('score', sub(), ctx({ attempts: [{ fp: A.fp, at: 't' }] }));
  assert.equal(oneBad.entries[0].name.includes('attempt-clear'), true, 'a correct PIN clears earlier mistakes');

  assert.match((await decideIntake('score', sub({ matchId: 'r2-m1' }), ctx())).message, /not open in round 1/);
  assert.match((await decideIntake('score', sub({ myScore: 1, oppScore: 1 }), ctx())).message, /tie/);
  assert.match((await decideIntake('score', sub(), ctx({ accepted: [res(id, A.fp)] }))).message, /already accepted/);
  assert.match((await decideIntake('score', sub(), baseCtx(rec(T()), { signups: teams.map((x) => x.signup) }))).message, /only taken for the round/);
});

test('attemptCount: queue plus pending inbox, in order, with clears', () => {
  const n = (k, fp, t) => `inbox/20260922T1000000${t}Z-r${t}-${k}-${fp}.md`;
  assert.equal(attemptCount('AB12', [{ fp: 'AB12' }, { fp: 'CD34' }], []), 1);
  assert.equal(attemptCount('AB12', [], [n('attempt', 'AB12', '01'), n('attempt', 'AB12', '02')]), 2);
  assert.equal(attemptCount('AB12', [{ fp: 'AB12' }], [n('attempt', 'AB12', '01'), n('attempt-clear', 'AB12', '02'), n('attempt', 'AB12', '03')]), 1);
});

// ---- batch --------------------------------------------------------------------------------

const ent = (e, rand) => ({ name: entryName(e, rand), text: formatEntry(e) });

test('batch: folds in filename order; re-checks gates NOW and logs what it drops', async () => {
  const teams = await registered(4);
  const cs = teams.map((x) => x.fp);
  const r = rec(T({ activePhase: 'knockout', drawSeed: 's', round: 1 }), cs);
  const [[id, s]] = [...roundOpenMatches(r)];
  const out = foldBatch([
    ent({ kind: 'score', team: s.a, match: id, score: '3-1', at: '2026-09-22T10:00:02.000Z' }, 'b'),
    ent({ kind: 'score', team: s.a, match: id, score: '2-1', at: '2026-09-22T10:00:01.000Z' }, 'a'),
    ent({ kind: 'score', team: s.b, match: 'r2-m1', score: '2-0', at: '2026-09-22T10:00:03.000Z' }, 'c'),
    ent({ kind: 'signup', team: 'NEW1', tokenHash: 'h', pinHash: 'p', at: '2026-09-22T10:00:04.000Z' }, 'd'),
    ent({ kind: 'attempt', team: s.b, at: '2026-09-22T10:00:05.000Z' }, 'e'),
  ], { record: r, signups: teams.map((x) => x.signup), scores: [], attempts: [], admitted: [], accepted: [], now: 'NOW' });

  assert.deepEqual(out.scores.map((x) => `${x.reporterFp}:${x.myScore}-${x.oppScore}`), [`${s.a}:3-1`], 'later file wins');
  assert.equal(out.attempts.length, 1);
  assert.equal(out.rejected.length, 2);
  assert.match(out.rejected.map((x) => x.reason).join(' / '), /not open in round 1/);
  assert.match(out.rejected.map((x) => x.reason).join(' / '), /registration closed/);
  assert.ok(!out.signups.some((x) => x.fp === 'NEW1'));
});

test('batch: organizer entries — reject a signup, clear a match, unlock, re-PIN, reset', async () => {
  const teams = await registered(4);
  const r = rec(T());
  const base = { record: r, signups: teams.map((x) => x.signup), scores: [], attempts: [{ fp: teams[0].fp, at: 't' }], admitted: [{ fp: teams[1].fp, tokenHash: 'h' }], accepted: [], now: 'NOW' };
  const at = (i) => `2026-09-22T10:00:0${i}.000Z`;
  const out = foldBatch([
    ent({ kind: 'org-reject-signup', team: teams[2].fp, at: at(1) }, 'a'),
    ent({ kind: 'org-reject-signup', team: teams[1].fp, at: at(2) }, 'b'),
    ent({ kind: 'org-repin', team: teams[0].fp, pinHash: 'NEWHASH', at: at(3) }, 'c'),
  ], base);
  assert.ok(!out.signups.some((x) => x.fp === teams[2].fp));
  assert.ok(out.signups.some((x) => x.fp === teams[1].fp), 'an admitted team cannot be rejected');
  assert.match(out.rejected[0].reason, /unadmit/);
  assert.equal(out.signups.find((x) => x.fp === teams[0].fp).pinHash, 'NEWHASH');
  assert.equal(out.attempts.length, 0, 're-PIN also unlocks');

  const reset = foldBatch([ent({ kind: 'org-reset', at: at(4) }, 'd')], base);
  assert.deepEqual([reset.signups, reset.scores, reset.attempts], [[], [], []]);
});

test('inbox entry names are sortable and self-describing', () => {
  const name = entryName({ kind: 'org-reject-score', team: 'AB12', match: 'r8-m3', at: '2026-09-22T10:00:00.123Z' }, 'q9');
  assert.deepEqual(describeName(name), { ts: '20260922T100000123Z', kind: 'org-reject-score', team: 'AB12', match: 'r8-m3' });
  assert.equal(describeName(entryName({ kind: 'org-reset', at: '2026-09-22T10:00:00.000Z' }, 'z')).team, null);
});

// ---- publish: planned, confirmed, fingerprinted ---------------------------------------------------

const planCtx = (record, t, over = {}) => ({ tournament: t, record, admitted: [], accepted: [], signups: [], inboxNames: [], ...over });
const adm = (cs) => cs.map((fp) => ({ fp, tokenHash: 'h', registeredAt: 't' }));

test('plan close: publishes exactly the admitted list, then flips the phase', async () => {
  const t = T();
  const p = await planTransition('close', planCtx(rec(t), t, { admitted: adm(['BBBB', 'AAAA']) }));
  assert.equal(p.ok, true);
  assert.deepEqual(p.plan.roster.map((x) => x.fp), ['AAAA', 'BBBB']);
  assert.equal(p.plan.config.activePhase, 'knockout');
  assert.equal(p.plan.results, undefined, 'close never touches results');
  assert.match(p.fingerprint, /^[A-Za-z0-9_-]{12}$/);
  assert.equal((await planTransition('close', planCtx(rec(T({ activePhase: 'knockout' })), T({ activePhase: 'knockout' })))).ok, false);
});

test('plan draw: gated to closed; refuses with waiting registrations unless told; fingerprint is deterministic', async () => {
  const t = T({ activePhase: 'knockout' });
  const r = rec(t);
  const ctx = planCtx(r, t, { admitted: adm(codes(4)), signups: [{ fp: 'WAIT', tokenHash: 'h', pinHash: 'p' }] });
  assert.match((await planTransition('draw', ctx, { seed: 'x' })).error, /still waiting.*WAIT/);
  const a = await planTransition('draw', ctx, { seed: 'x', leavePending: true });
  const b = await planTransition('draw', ctx, { seed: 'x', leavePending: true });
  assert.equal(a.fingerprint, b.fingerprint, 'same inputs, same fingerprint');
  assert.notEqual(a.fingerprint, (await planTransition('draw', ctx, { seed: 'y', leavePending: true })).fingerprint, 'a different seed is a different plan');
  assert.equal(a.plan.config.round, 1);
  assert.equal(a.plan.config.drawSeed, 'x');
  assert.equal((await planTransition('draw', planCtx(rec(T()), T(), { admitted: adm(codes(4)) }), { seed: 'x' })).ok, false, 'no draw while registration is open');
  assert.match((await planTransition('draw', planCtx(r, t, { admitted: adm(codes(1)) }), { seed: 'x' })).error, /at least 2/);
});

test('plan advance: refuses a partial round; publishes the whole round, then the next round, then done', async () => {
  const t1 = T({ activePhase: 'knockout', drawSeed: 's', round: 1 });
  const r1 = rec(t1, codes(4));
  const open = [...roundOpenMatches(r1)];
  assert.match((await planTransition('advance', planCtx(r1, t1, { accepted: [res(open[0][0], open[0][1].a)] }))).error, /no accepted result/);

  const accepted = open.map(([id, s]) => res(id, s.a));
  const p1 = await planTransition('advance', planCtx(r1, t1, { accepted }));
  assert.equal(p1.ok, true);
  assert.equal(p1.plan.results.length, 2);
  assert.equal(p1.plan.config.round, 2);

  // Apply the plan by hand, then advance the final.
  const t2 = p1.plan.config;
  const r2 = rec(t2, codes(4), p1.plan.results);
  assert.equal(r2.stage, 'round');
  const [[fid, fs]] = [...roundOpenMatches(r2)];
  const p2 = await planTransition('advance', planCtx(r2, t2, { accepted: [...accepted, res(fid, fs.b, 5, 0)] }));
  assert.equal(p2.plan.config.round, 'done');
  assert.equal(p2.plan.config.activePhase, 'complete');
  assert.equal(rec(p2.plan.config, codes(4), p2.plan.results).stage, 'complete');
  assert.match(p2.plan.summary.join('\n'), new RegExp(fs.b));
});

test('a plan and its fingerprint change the moment the inputs do', async () => {
  const t = T({ activePhase: 'knockout', drawSeed: 's', round: 1 });
  const r = rec(t, codes(4));
  const open = [...roundOpenMatches(r)];
  const a = await planTransition('advance', planCtx(r, t, { accepted: open.map(([id, s]) => res(id, s.a)) }));
  const b = await planTransition('advance', planCtx(r, t, { accepted: open.map(([id, s], i) => res(id, i ? s.b : s.a)) }));
  assert.notEqual(a.fingerprint, b.fingerprint, 'a different accepted winner is a different plan');
});

test('nothing but reset runs against an invalid record', async () => {
  const t = T({ activePhase: 'knockout', drawSeed: 's', round: 1 });
  const bad = rec(t, codes(4), [res('r4-m1', 'ZZZZ')]);
  assert.equal(bad.stage, 'invalid');
  for (const action of ['close', 'reopen', 'draw', 'advance']) {
    assert.equal((await planTransition(action, planCtx(bad, t), { seed: 'x' })).ok, false, action);
  }
  const reset = await planTransition('reset', planCtx(bad, t));
  assert.equal(reset.ok, true);
  assert.deepEqual([reset.plan.config.drawSeed, reset.plan.config.round, reset.plan.config.activePhase], [null, null, 'signup']);
});

test('validateResult: the winner must have played and must have the higher score', () => {
  const s = buildDraw(codes(4), 's');
  const [m] = s.rounds[0].matches;
  assert.equal(validateResult(s, res(m.id, m.a, 3, 0)).ok, true);
  assert.equal(validateResult(s, res(m.id, m.a, 0, 3)).ok, false);
  assert.equal(validateResult(s, res(m.id, m.a, 2, 2)).ok, false);
  assert.equal(validateResult(null, res(m.id, m.a)).ok, false);
});
