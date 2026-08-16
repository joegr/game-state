#!/usr/bin/env node
// game-state — the bracket state machine (organizer / CI side).
//
// This is what the GitHub Action runs. It owns the ENTIRE tournament as JSON in
// the repo and rewrites it on every mutation:
//
//   state/teams.json      anonymized entrants  { fp, captainPublicKey }
//   state/matches.json    the full bracket, every round & match (working state)
//   config/bracket.json   PUBLIC output: per-captain encrypted views only
//
// Subcommands:
//   draw [--seed S]              build the stochastic single-elim bracket
//   result <matchId> <winnerFp>  record a result, advance the winner
//   sim [--seed S]               auto-play the whole bracket (demo/testing)
//   render                       regenerate config/bracket.json from state
//   purge                        cascade-delete ALL stored data (signups/, state/)
//   status                       print a summary
//
// After the FINAL match is decided, `result`/`sim` auto-purge: every piece of
// stored data is cascade-deleted and config/bracket.json is reduced to an
// anonymized champion record with no remaining encrypted blobs. The tournament
// JSON is thus updated per match and leaves nothing behind once complete.

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { seal } from '../js/crypto.js';
import { p, seededRng, shuffle } from './lib.mjs';

const readJson = (f) => JSON.parse(readFileSync(p(...f), 'utf8'));
const writeJson = (f, o) => writeFileSync(p(...f), JSON.stringify(o, null, 2) + '\n');
const tournament = readJson(['config', 'tournament.json']);

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

switch (cmd) {
  case 'draw': await draw(); break;
  case 'result': await result(args[0], args[1]); break;
  case 'sim': await sim(); break;
  case 'render': await render(readState()); break;
  case 'purge': purge('manual purge'); break;
  case 'status': status(); break;
  default:
    console.log('Usage: node advance.mjs <draw|result <matchId> <winnerFp>|sim|render|purge|status> [--seed S]');
}

// ---- bracket construction --------------------------------------------------

function roundLabel(slots) {
  return { 2: 'The Final', 4: 'Semi-finals', 8: 'Quarter-finals' }[slots] || `Round of ${slots}`;
}

// Align bracket rounds to the tournament schedule from the end, so the last
// round lines up with the 'final' phase, etc. Returns a start ISO per round.
function roundTimes(nRounds) {
  const knockout = tournament.phases.filter((ph) => ph.kind !== 'signup' && ph.kind !== 'complete');
  const tail = knockout.slice(Math.max(0, knockout.length - nRounds));
  const times = tail.map((ph) => ph.start);
  while (times.length < nRounds) times.unshift(times[0] || null); // pad front if few phases
  return times;
}

async function draw() {
  if (!existsSync(p('state', 'teams.json'))) {
    console.error('No state/teams.json. Run decrypt-signups.mjs first.'); process.exit(1);
  }
  const { teams } = readJson(['state', 'teams.json']);
  if (teams.length < 2) { console.error('Need at least 2 teams to draw.'); process.exit(1); }

  const seed = flag('--seed', `${tournament.name}:${teams.length}:${Date.now()}`);
  const rng = seededRng(seed);
  const order = shuffle(teams.map((t) => t.fp), rng);

  // Pad to next power of two with byes (null).
  let size = 1; while (size < order.length) size *= 2;
  const slots = [...order, ...Array(size - order.length).fill(null)];

  const rounds = [];
  let current = [];
  for (let i = 0; i < slots.length; i += 2) current.push({ a: slots[i], b: slots[i + 1] });
  let roundSlots = size;
  const nRounds = Math.log2(size);
  const times = roundTimes(nRounds);

  for (let r = 0; r < nRounds; r++) {
    const matches = current.map((m, i) => ({
      id: `r${roundSlots}-m${i + 1}`, a: m.a ?? null, b: m.b ?? null, winner: null,
    }));
    // Auto-resolve byes in the first round.
    if (r === 0) for (const m of matches) {
      if (m.a && !m.b) m.winner = m.a;
      if (m.b && !m.a) m.winner = m.b;
    }
    rounds.push({ slots: roundSlots, label: roundLabel(roundSlots), start: times[r], matches });
    // Prepare the (empty) next round.
    const next = [];
    for (let i = 0; i < matches.length; i += 2) next.push({ a: null, b: null });
    current = next; roundSlots /= 2;
  }

  const stateObj = {
    seed, format: 'single-elimination', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), status: 'active', champion: null, rounds,
  };
  mkdirSync(p('state'), { recursive: true });
  writeJson(['state', 'matches.json'], stateObj);
  propagateByes(stateObj);
  writeJson(['state', 'matches.json'], stateObj);
  await render(stateObj);
  console.log(`Drew ${order.length}-team bracket (seed "${seed}"), ${nRounds} rounds.`);
  status();
}

// ---- results ---------------------------------------------------------------

function readState() {
  if (!existsSync(p('state', 'matches.json'))) { console.error('No bracket yet. Run: node advance.mjs draw'); process.exit(1); }
  return readJson(['state', 'matches.json']);
}

function findMatch(state, id) {
  for (let r = 0; r < state.rounds.length; r++) {
    const m = state.rounds[r].matches.find((x) => x.id === id);
    if (m) return { round: r, match: m };
  }
  return null;
}

// Feed a decided match's winner into the correct slot of the next round.
function feedForward(state, roundIdx, matchIdx) {
  const m = state.rounds[roundIdx].matches[matchIdx];
  const next = state.rounds[roundIdx + 1];
  if (!next || !m.winner) return;
  const nm = next.matches[Math.floor(matchIdx / 2)];
  if (matchIdx % 2 === 0) nm.a = m.winner; else nm.b = m.winner;
}

function propagateByes(state) {
  for (let r = 0; r < state.rounds.length; r++) {
    state.rounds[r].matches.forEach((m, i) => { if (m.winner) feedForward(state, r, i); });
  }
}

async function result(matchId, winnerFp) {
  if (!matchId || !winnerFp) { console.error('Usage: result <matchId> <winnerFp>'); process.exit(1); }
  const state = readState();
  const hit = findMatch(state, matchId);
  if (!hit) { console.error(`No match "${matchId}".`); process.exit(1); }
  const { round, match } = hit;
  if (match.a !== winnerFp && match.b !== winnerFp) {
    console.error(`"${winnerFp}" is not in match ${matchId} (${match.a} vs ${match.b}).`); process.exit(1);
  }
  match.winner = winnerFp;
  feedForward(state, round, state.rounds[round].matches.indexOf(match));
  await finish(state, `${matchId} → ${winnerFp}`);
}

async function sim() {
  if (!existsSync(p('state', 'matches.json'))) await draw();
  const state = readState();
  const rng = seededRng((state.seed || 'sim') + ':sim');
  for (let r = 0; r < state.rounds.length; r++) {
    state.rounds[r].matches.forEach((m, i) => {
      if (m.winner) return;
      if (!m.a && !m.b) return;
      m.winner = !m.b ? m.a : !m.a ? m.b : (rng() < 0.5 ? m.a : m.b);
      feedForward(state, r, i);
    });
  }
  await finish(state, 'simulated all rounds');
}

// Persist a mutation, detect champion, auto-purge on completion.
async function finish(state, msg) {
  state.updatedAt = new Date().toISOString();
  const final = state.rounds[state.rounds.length - 1].matches[0];
  if (final && final.winner) {
    state.status = 'complete';
    state.champion = final.winner;
  }
  writeJson(['state', 'matches.json'], state);
  await render(state);
  console.log(`Applied: ${msg}`);
  if (state.status === 'complete') {
    console.log(`🏆 Champion decided: ${state.champion}`);
    purge('tournament complete', state.champion);
  } else {
    status();
  }
}

// ---- public render: per-captain encrypted views ----------------------------

async function render(state) {
  const teams = existsSync(p('state', 'teams.json')) ? readJson(['state', 'teams.json']).teams : [];
  const pubByFp = new Map(teams.map((t) => [t.fp, t.captainPublicKey]));

  // Find, for each team, their earliest undecided match (their "next fixture").
  const nextFixture = new Map();
  const eliminated = new Set();
  for (let r = 0; r < state.rounds.length; r++) {
    for (const m of state.rounds[r].matches) {
      for (const side of ['a', 'b']) {
        const fp = m[side]; if (!fp) continue;
        if (m.winner && m.winner !== fp) eliminated.add(fp);
        if (!m.winner && !nextFixture.has(fp)) {
          nextFixture.set(fp, {
            phaseLabel: state.rounds[r].label,
            opponent: side === 'a' ? m.b : m.a,
            matchTime: state.rounds[r].start,
            matchId: m.id,
          });
        }
      }
    }
  }

  const views = {};
  for (const t of teams) {
    let view;
    if (state.champion === t.fp) {
      view = { status: 'champion', phaseLabel: 'Champion' };
    } else if (eliminated.has(t.fp) && !nextFixture.has(t.fp)) {
      view = { status: 'eliminated', phaseLabel: 'Eliminated' };
    } else if (nextFixture.has(t.fp)) {
      const f = nextFixture.get(t.fp);
      view = {
        status: f.opponent ? 'scheduled' : 'bye',
        phaseLabel: f.phaseLabel,
        opponent: f.opponent || null,
        matchTime: f.matchTime,
        matchId: f.matchId,
        instructions: f.opponent ? 'Play your match before the next stage begins.' : 'Opponent to be decided — sit tight.',
      };
    } else {
      view = { status: 'scheduled', phaseLabel: 'Awaiting draw' };
    }
    views[t.fp] = await seal(JSON.stringify(view), pubByFp.get(t.fp));
  }

  writeJson(['config', 'bracket.json'], {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activePhase: state.status === 'complete' ? 'complete' : currentPhaseId(state),
    seed: state.seed || null,
    teamCount: teams.length,
    note: 'Per-captain encrypted views. Each captain can decrypt only their own entry.',
    views,
  });
}

function currentPhaseId(state) {
  const undecided = state.rounds.find((r) => r.matches.some((m) => (m.a || m.b) && !m.winner));
  return undecided ? undecided.label : 'complete';
}

// ---- cascade purge ---------------------------------------------------------

function purge(reason, champion = null) {
  // Cascade-delete every piece of stored data.
  for (const dir of ['signups', 'state']) {
    if (existsSync(p(dir))) { rmSync(p(dir), { recursive: true, force: true }); }
  }
  // Reduce the public config to an anonymized, blob-free completed record.
  writeJson(['config', 'bracket.json'], {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    activePhase: 'complete',
    completed: true,
    champion: champion,
    teamCount: 0,
    note: `Tournament complete (${reason}). All stored data cascade-deleted; no per-captain data remains.`,
    views: {},
  });
  console.log(`🧹 Cascade purge (${reason}): removed signups/ and state/; config/bracket.json reset to champion record.`);
}

// ---- status ----------------------------------------------------------------

function status() {
  if (!existsSync(p('state', 'matches.json'))) {
    const signups = existsSync(p('signups')) ? readdirSync(p('signups')).filter((f) => !f.startsWith('.')).length : 0;
    console.log(`Phase: registration. Collected signup files: ${signups}. No draw yet.`);
    return;
  }
  const state = readState();
  console.log(`\nSeed: ${state.seed}`);
  for (const r of state.rounds) {
    const done = r.matches.filter((m) => m.winner).length;
    console.log(`  ${r.label.padEnd(16)} ${done}/${r.matches.length} decided`);
  }
  console.log(state.status === 'complete' ? `Champion: ${state.champion}` : 'In progress.');
  // List the next actionable matches.
  const live = state.rounds.find((r) => r.matches.some((m) => m.a && m.b && !m.winner));
  if (live) {
    console.log(`\nPending in ${live.label}:`);
    for (const m of live.matches.filter((x) => x.a && x.b && !x.winner)) {
      console.log(`  ${m.id}:  ${m.a}  vs  ${m.b}`);
    }
  }
}
