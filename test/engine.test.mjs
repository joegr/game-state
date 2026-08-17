// game-state — pure engine tests (node --test, zero deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraw, applyResult, simAll, computeQueue, buildPublic, buildViews,
  roundsForTeams, roundStartsFor, playableMatches, currentPhaseLabel,
} from '../js/engine.js';

const teams = (n) => Array.from({ length: n }, (_, i) => `T${String(i).padStart(2, '0')}`);

test('buildDraw: 8 teams → 3 rounds, correct labels, no byes', () => {
  const s = buildDraw(teams(8), 'seed-8');
  assert.equal(s.rounds.length, 3);
  assert.deepEqual(s.rounds.map((r) => r.label), ['Quarter-finals', 'Semi-finals', 'The Final']);
  assert.equal(s.rounds[0].matches.length, 4);
  assert.equal(s.rounds[2].matches.length, 1);
  // Every team appears exactly once in round 0; no null slots.
  const slots = s.rounds[0].matches.flatMap((m) => [m.a, m.b]);
  assert.deepEqual([...slots].sort(), teams(8).sort());
  assert.ok(s.rounds[0].matches.every((m) => m.winner === null));
});

test('buildDraw is deterministic for a given seed', () => {
  assert.deepEqual(buildDraw(teams(8), 'x'), buildDraw(teams(8), 'x'));
  assert.notDeepEqual(
    buildDraw(teams(8), 'x').rounds[0].matches.map((m) => [m.a, m.b]),
    buildDraw(teams(8), 'y').rounds[0].matches.map((m) => [m.a, m.b]),
  );
});

test('buildDraw: non-power-of-2 (6 teams) distributes byes, no null-vs-null', () => {
  const s = buildDraw(teams(6), 'seed-6');
  assert.equal(s.rounds[0].slots, 8);
  // No match has both sides null.
  assert.ok(s.rounds[0].matches.every((m) => m.a || m.b));
  // Exactly 2 byes auto-resolved in round 0.
  const byes = s.rounds[0].matches.filter((m) => (m.a && !m.b) || (m.b && !m.a));
  assert.equal(byes.length, 2);
  assert.ok(byes.every((m) => m.winner === (m.a || m.b)));
  // All 6 teams present.
  const present = new Set(s.rounds[0].matches.flatMap((m) => [m.a, m.b]).filter(Boolean));
  assert.equal(present.size, 6);
});

test('applyResult: advances winner, feeds next round, rejects bad input', () => {
  const s = buildDraw(teams(8), 'adv');
  const m0 = s.rounds[0].matches[0];
  // Not a participant.
  assert.equal(applyResult(s, m0.id, 'NOPE').ok, false);
  // Valid.
  const r = applyResult(s, m0.id, m0.a);
  assert.equal(r.ok, true);
  assert.equal(r.complete, false);
  assert.equal(s.rounds[1].matches[0].a, m0.a); // fed forward to r1m1.a
  // Double-confirm rejected.
  assert.equal(applyResult(s, m0.id, m0.b).ok, false);
});

test('applyResult: deciding the final sets champion + complete', () => {
  const s = buildDraw(teams(4), 'fin');
  for (const m of s.rounds[0].matches) applyResult(s, m.id, m.a);
  const final = s.rounds[1].matches[0];
  const r = applyResult(s, final.id, final.a);
  assert.equal(r.complete, true);
  assert.equal(r.champion, final.a);
  assert.equal(s.status, 'complete');
});

test('simAll: plays every match to a champion', () => {
  const s = buildDraw(teams(16), 'sim');
  const r = simAll(s);
  assert.equal(r.complete, true);
  assert.ok(r.champion);
  assert.ok(s.rounds.every((rd) => rd.matches.every((m) => !(m.a && m.b) || m.winner)));
  assert.equal(currentPhaseLabel(s), 'complete');
});

// ---- score consensus --------------------------------------------------------

function drawn8() { return buildDraw(teams(8), 'q'); }
const rep = (fp, matchId, my, opp, ts = '2026-01-01T00:00:00Z') => ({ reporterFp: fp, matchId, myScore: my, oppScore: opp, ts });

test('computeQueue: mirrored scores → agreed with correct winner', () => {
  const s = drawn8();
  const m = playableMatches(s).entries().next().value; // [id,{a,b,label}]
  const [id, { a, b }] = m;
  const q = computeQueue(s, [rep(a, id, 3, 1), rep(b, id, 1, 3)]);
  assert.equal(q[id].status, 'agreed');
  assert.equal(q[id].winner, a);
  assert.equal(q[id].scoreA, 3);
});

test('computeQueue: conflicting scores → disputed; one report → awaiting; tie', () => {
  const s = drawn8();
  const ms = [...playableMatches(s).entries()];
  const [id0, s0] = ms[0], [id1, s1] = ms[1], [id2, s2] = ms[2];
  const q = computeQueue(s, [
    rep(s0.a, id0, 3, 1), rep(s0.b, id0, 3, 0), // disagree
    rep(s1.a, id1, 2, 0),                        // only one captain
    rep(s2.a, id2, 2, 2), rep(s2.b, id2, 2, 2),  // mirrored tie
  ]);
  assert.equal(q[id0].status, 'disputed');
  assert.equal(q[id1].status, 'awaiting');
  assert.equal(q[id1].reportedBy, s1.a);
  assert.equal(q[id2].status, 'tie');
});

test('computeQueue: latest report by timestamp wins; non-participant ignored', () => {
  const s = drawn8();
  const [id, { a, b }] = playableMatches(s).entries().next().value;
  const q = computeQueue(s, [
    rep(a, id, 5, 0, '2026-01-01T00:00:00Z'),
    rep(a, id, 3, 1, '2026-01-02T00:00:00Z'), // newer overrides
    rep(b, id, 1, 3),
    rep('XXXX', id, 9, 0), // not a participant → ignored
  ]);
  assert.equal(q[id].status, 'agreed');
  assert.equal(q[id].scoreA, 3);
});

test('computeQueue: reports for non-playable matches are ignored', () => {
  const s = drawn8();
  const q = computeQueue(s, [rep('T00', 'r2-m1', 1, 0)]); // final not playable yet
  assert.deepEqual(q, {});
});

// ---- published outputs ------------------------------------------------------

test('buildPublic: counts and status reflect state', () => {
  const s = buildDraw(teams(8), 'pub');
  let p = buildPublic(s, 'Cup', 8);
  assert.equal(p.matchesTotal, 7);
  assert.equal(p.matchesDecided, 0);
  assert.equal(p.status, 'active');
  applyResult(s, s.rounds[0].matches[0].id, s.rounds[0].matches[0].a);
  p = buildPublic(s, 'Cup', 8);
  assert.equal(p.matchesDecided, 1);
  assert.equal(p.champion, null);
});

test('buildViews: champion / eliminated / scheduled perspectives', () => {
  const s = buildDraw(teams(4), 'views');
  const m0 = s.rounds[0].matches[0], m1 = s.rounds[0].matches[1];
  simAll(s);
  const champ = s.champion;
  const views = buildViews(s, teams(4));
  assert.equal(views[champ].status, 'champion');
  const losers = teams(4).filter((t) => t !== champ);
  assert.ok(losers.some((t) => views[t].status === 'eliminated'));
});

test('roundsForTeams / roundStartsFor', () => {
  assert.equal(roundsForTeams(32), 5);
  assert.equal(roundsForTeams(8), 3);
  assert.equal(roundsForTeams(5), 3); // → 8-bracket
  const phases = [
    { kind: 'signup', start: 's' }, { kind: 'group', start: 'g' },
    { kind: 'knockout', start: 'k1' }, { kind: 'knockout', start: 'k2' },
    { kind: 'knockout', start: 'k3' }, { kind: 'complete', start: 'c' },
  ];
  // 3 rounds → last 3 non-signup/non-complete phases.
  assert.deepEqual(roundStartsFor(phases, 3), ['g', 'k1', 'k2', 'k3'].slice(1));
});
