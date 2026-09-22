// game-state — pure engine tests (node --test, zero deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraw, applyResult, computeQueue, buildPublic, buildViews,
  playableMatches, currentPhaseLabel, buildGroups, signupProgress, buildSignupProgress,
  formatRosterMd, parseRosterMd, formatResultsMd, parseResultsMd,
  formatConfigMd, parseConfigMd,
  formatSignupsMd, parseSignupsMd, formatScoresMd, parseScoresMd, formatAttemptsMd, parseAttemptsMd,
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
  // createdAt/updatedAt are wall-clock stamps, not derived from the seed — two
  // real calls can land in different milliseconds, so exclude them here and
  // compare everything the seed actually determines.
  const strip = ({ createdAt, updatedAt, ...rest }) => rest;
  assert.deepEqual(strip(buildDraw(teams(8), 'x')), strip(buildDraw(teams(8), 'x')));
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
  // Play it out the way the organizer would: side A wins every match.
  for (const round of s.rounds) for (const m of round.matches) applyResult(s, m.id, m.a);
  const champ = s.champion;
  assert.ok(champ);
  const views = buildViews(s, teams(4));
  assert.equal(views[champ].status, 'champion');
  const losers = teams(4).filter((t) => t !== champ);
  assert.ok(losers.some((t) => views[t].status === 'eliminated'));
});

// ---- signup capacity ---------------------------------------------------------

test('buildGroups: fills sequentially, groupSize at a time', () => {
  const groups = buildGroups(teams(6), 8, 4);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].teams, teams(6).slice(0, 4));
  assert.equal(groups[0].full, true);
  assert.deepEqual(groups[1].teams, teams(6).slice(4, 6));
  assert.equal(groups[1].slots, 4);
  assert.equal(groups[1].full, false);
});

test('buildGroups: an uneven capacity gives the tail group fewer slots', () => {
  const groups = buildGroups(teams(2), 10, 4);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.slots), [4, 4, 2]);
  assert.equal(groups[2].full, false);
});

test('signupProgress: registered/capacity/full track the roster against capacity', () => {
  let p = signupProgress(teams(6), 8, 4);
  assert.equal(p.registered, 6);
  assert.equal(p.capacity, 8);
  assert.equal(p.full, false);
  p = signupProgress(teams(8), 8, 4);
  assert.equal(p.full, true);
  assert.ok(p.groups.every((g) => g.full));
});

test('buildSignupProgress: publishable pre-draw shape', () => {
  const obj = buildSignupProgress(teams(4), 'Cup', 8, 4);
  assert.equal(obj.status, 'registration');
  assert.equal(obj.registered, 4);
  assert.equal(obj.full, false);
  assert.deepEqual(obj.rounds, []);
  assert.match(obj.note, /4\/8/);
});

// ---- roster markdown ---------------------------------------------------------

test('formatRosterMd / parseRosterMd round-trip the roster', () => {
  const roster = [
    { fp: 'AB12', tokenHash: 'hash1', registeredAt: '2026-01-01T00:00:00Z' },
    { fp: 'CD34', tokenHash: 'hash2', registeredAt: '2026-01-02T00:00:00Z' },
  ];
  const md = formatRosterMd(roster);
  assert.match(md, /# Roster/);
  assert.match(md, /AB12/);
  assert.deepEqual(parseRosterMd(md), roster);
});

test('formatRosterMd: an empty roster still parses back to an empty list', () => {
  assert.deepEqual(parseRosterMd(formatRosterMd([])), []);
});

// The determinism guarantee. buildDraw's shuffle consumes the roster array in
// the order it is handed, so two renderings of the same field in different row
// orders would otherwise reconstruct two different brackets from one seed.
// Sorting by `fp` inside formatRosterMd is what makes the published file
// canonical — this is the regression test for that.
test('formatRosterMd: sorts by code, so one seed can only mean one bracket', () => {
  const t = (fp, n) => ({ fp, tokenHash: `hash${n}`, registeredAt: `2026-01-0${n}T00:00:00Z` });
  const registrationOrder = [t('ZZ99', 1), t('AB12', 2), t('MM55', 3)];
  const someOtherOrder = [t('MM55', 3), t('ZZ99', 1), t('AB12', 2)];

  const a = formatRosterMd(registrationOrder);
  assert.equal(a, formatRosterMd(someOtherOrder));
  assert.deepEqual(parseRosterMd(a).map((r) => r.fp), ['AB12', 'MM55', 'ZZ99']);

  const strip = ({ createdAt, updatedAt, ...rest }) => rest;
  const bracket = (md) => strip(buildDraw(parseRosterMd(md).map((r) => r.fp), 'fixed-seed'));
  assert.deepEqual(bracket(a), bracket(formatRosterMd(someOtherOrder)));
});

// ---- tournament.md (the organizer-owned spine) --------------------------------

const CONFIG = {
  name: 'The Autumn Gauntlet',
  tagline: 'simple state-based tournaments',
  teamCount: 32,
  groupSize: 4,
  format: 'single-elimination',
  appRepo: 'joegr/game-state',
  rosterRepo: 'joegr/game-state-roster',
  tentativeRepo: 'joegr/game-state-tentative-scores',
  activePhase: 'signup',
  drawSeed: null,
  round: null,
  phases: [
    { id: 'signup', kind: 'signup', label: 'Registration', blurb: 'Captains register their team.' },
    { id: 'final', kind: 'round', label: 'The Final', blurb: '' },
  ],
};

test('formatConfigMd / parseConfigMd round-trip the tournament spine', () => {
  const md = formatConfigMd(CONFIG);
  assert.match(md, /^# The Autumn Gauntlet/);
  assert.match(md, /- Draw seed: \(none\)/); // null renders as (none), not "null"
  assert.deepEqual(parseConfigMd(md), CONFIG);
});

test('parseConfigMd: a set draw seed survives the round-trip; (none) means null', () => {
  const drawn = { ...CONFIG, drawSeed: 'The Autumn Gauntlet:32:1700000000000' };
  assert.equal(parseConfigMd(formatConfigMd(drawn)).drawSeed, drawn.drawSeed);
  assert.equal(parseConfigMd(formatConfigMd(CONFIG)).drawSeed, null);
});

test('parseConfigMd: tolerates hand edits — odd spacing and label casing', () => {
  const md = formatConfigMd(CONFIG)
    .replace('- Active phase: signup', '-   ACTIVE PHASE:   final   ')
    .replace('- Team count: 32', '- team count:16');
  const t = parseConfigMd(md);
  assert.equal(t.activePhase, 'final');
  assert.equal(t.teamCount, 16);
});

test('parseConfigMd: an empty blurb cell round-trips as an empty string', () => {
  const t = parseConfigMd(formatConfigMd(CONFIG));
  assert.equal(t.phases[1].blurb, '');
  assert.equal(t.phases.length, 2);
});

test('parseConfigMd: Round reads as null, a number, or "done"', () => {
  assert.match(formatConfigMd(CONFIG), /- Round: \(none\)/);
  assert.equal(parseConfigMd(formatConfigMd({ ...CONFIG, round: 3 })).round, 3);
  assert.equal(parseConfigMd(formatConfigMd({ ...CONFIG, round: 'done' })).round, 'done');
});

// ---- the tentative repo (private) --------------------------------------------

test('signups.md round-trips, PIN hash included', () => {
  const rows = [{ fp: 'AB12', tokenHash: 'th1', pinHash: 'ph1', submittedAt: '2026-01-01T00:00:00Z' }];
  assert.deepEqual(parseSignupsMd(formatSignupsMd(rows)), rows);
  assert.deepEqual(parseSignupsMd(formatSignupsMd([])), []);
  assert.deepEqual(parseSignupsMd(''), []);
});

test('scores.md round-trips into exactly the shape computeQueue consumes', () => {
  const rows = [
    { matchId: 'r4-m1', reporterFp: 'AB12', myScore: 3, oppScore: 1, ts: '2026-01-01T00:00:00Z' },
    { matchId: 'r4-m1', reporterFp: 'CD34', myScore: 1, oppScore: 3, ts: '2026-01-01T00:01:00Z' },
  ];
  assert.deepEqual(parseScoresMd(formatScoresMd(rows)), rows);
});

test('attempts.md round-trips', () => {
  const rows = [{ fp: 'AB12', at: '2026-01-01T00:00:00Z' }];
  assert.deepEqual(parseAttemptsMd(formatAttemptsMd(rows)), rows);
});

