#!/usr/bin/env node
// game-state — the bracket state machine (organizer / CI side).
//
// Thin fs/crypto wrapper around the shared pure engine in ../js/engine.js (the
// same module the browser admin console uses). It owns the tournament JSON:
//
//   state/teams.json      anonymized entrants  { fp, captainPublicKey }
//   state/matches.json    the full bracket, every round & match (working state)
//   config/public.json    anonymized public bracket
//   config/bracket.json   per-captain ENCRYPTED views
//   config/queue.json     two-captain score consensus queue
//
// Subcommands: draw · result · sim · render · tally · purge · status
// After the FINAL match, result/sim auto-purge all stored data.

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { seal, unseal, boxSenderPub, publicRaw } from '../js/crypto.js';
import {
  buildDraw, applyResult, simAll, computeQueue, buildPublic, buildViews,
  currentPhaseLabel, roundStartsFor, roundsForTeams,
} from '../js/engine.js';
import { p, organizerPrivateKey } from './lib.mjs';

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
  case 'tally': await tally(); break;
  case 'purge': purge('manual purge'); break;
  case 'status': status(); break;
  default:
    console.log('Usage: node advance.mjs <draw|result <matchId> <winnerFp>|tally|sim|render|purge|status> [--seed S]');
}

function readState() {
  if (!existsSync(p('state', 'matches.json'))) { console.error('No bracket yet. Run: node advance.mjs draw'); process.exit(1); }
  return readJson(['state', 'matches.json']);
}

async function draw() {
  if (!existsSync(p('state', 'teams.json'))) { console.error('No state/teams.json. Run decrypt-signups.mjs first.'); process.exit(1); }
  const { teams } = readJson(['state', 'teams.json']);
  if (teams.length < 2) { console.error('Need at least 2 teams to draw.'); process.exit(1); }

  const seed = flag('--seed', `${tournament.name}:${teams.length}:${Date.now()}`);
  const starts = roundStartsFor(tournament.phases, roundsForTeams(teams.length));
  const state = buildDraw(teams.map((t) => t.fp), seed, starts);

  mkdirSync(p('state'), { recursive: true });
  writeJson(['state', 'matches.json'], state);
  await render(state);
  console.log(`Drew ${teams.length}-team bracket (seed "${seed}"), ${state.rounds.length} rounds.`);
  status();
}

async function result(matchId, winnerFp) {
  if (!matchId || !winnerFp) { console.error('Usage: result <matchId> <winnerFp>'); process.exit(1); }
  const state = readState();
  const r = applyResult(state, matchId, winnerFp);
  if (!r.ok) { console.log(r.error); process.exit(r.error.includes('already decided') ? 0 : 1); }
  await finish(state, `${matchId} → ${winnerFp}`, r);
}

async function sim() {
  if (!existsSync(p('state', 'matches.json'))) await draw();
  const state = readState();
  const r = simAll(state);
  await finish(state, 'simulated all rounds', r);
}

async function finish(state, msg, result) {
  writeJson(['state', 'matches.json'], state);
  await render(state);
  console.log(`Applied: ${msg}`);
  if (result.complete) {
    console.log(`🏆 Champion decided: ${result.champion}`);
    purge('tournament complete', result.champion);
  } else {
    status();
  }
}

// Regenerate the public bracket + per-captain encrypted views from state.
async function render(state) {
  const teams = existsSync(p('state', 'teams.json')) ? readJson(['state', 'teams.json']).teams : [];
  writeJson(['config', 'public.json'], buildPublic(state, tournament.name, teams.length));

  const pubByFp = new Map(teams.map((t) => [t.fp, t.captainPublicKey]));
  const plaintext = buildViews(state, teams.map((t) => t.fp));
  const views = {};
  for (const t of teams) views[t.fp] = await seal(JSON.stringify(plaintext[t.fp]), pubByFp.get(t.fp));

  writeJson(['config', 'bracket.json'], {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    activePhase: state.status === 'complete' ? 'complete' : currentPhaseLabel(state),
    seed: state.seed || null, teamCount: teams.length,
    note: 'Per-captain encrypted views. Each captain can decrypt only their own entry.',
    views,
  });
}

// Two-captain consensus: decrypt + authenticate score reports, then let the
// engine compute the queue.
async function tally() {
  const state = readState();
  if (!existsSync(p('state', 'teams.json'))) { console.error('No teams.'); process.exit(1); }
  const priv = organizerPrivateKey();
  const { teams } = readJson(['state', 'teams.json']);

  const rawToFp = new Map();
  for (const t of teams) rawToFp.set(await publicRaw(t.captainPublicKey), t.fp);

  const dir = p('scores');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
  const reports = [];
  let accepted = 0, rejected = 0;
  for (const f of files) {
    const mm = readFileSync(p('scores', f), 'utf8').match(/([A-Za-z0-9_-]{100,})/);
    if (!mm) { rejected++; continue; }
    const reporterFp = rawToFp.get(boxSenderPub(mm[1])); // identity from the embedded key
    if (!reporterFp) { rejected++; continue; }
    let rep;
    try { rep = JSON.parse(await unseal(mm[1], priv)); } catch { rejected++; continue; }
    reports.push({ reporterFp, matchId: rep.matchId, myScore: rep.myScore, oppScore: rep.oppScore, ts: rep.ts });
    accepted++;
  }

  const queue = computeQueue(state, reports);
  writeJson(['config', 'queue.json'], {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    note: 'Match result queue. A match is "agreed" only when both captains report mirrored scores; the admin confirms it to advance.',
    matches: queue,
  });
  const agreed = Object.values(queue).filter((q) => q.status === 'agreed').length;
  console.log(`Tallied ${accepted} report(s), ${rejected} rejected. Queue: ${Object.keys(queue).length} match(es), ${agreed} agreed & ready.`);
}

function purge(reason, champion = null) {
  for (const dir of ['signups', 'scores', 'state']) {
    if (existsSync(p(dir))) rmSync(p(dir), { recursive: true, force: true });
  }
  writeJson(['config', 'queue.json'], { schemaVersion: 1, generatedAt: new Date().toISOString(), note: 'Tournament complete — queue cleared.', matches: {} });
  writeJson(['config', 'bracket.json'], {
    schemaVersion: 1, generatedAt: new Date().toISOString(), activePhase: 'complete',
    completed: true, champion, teamCount: 0,
    note: `Tournament complete (${reason}). All stored data cascade-deleted; no per-captain data remains.`,
    views: {},
  });
  console.log(`🧹 Cascade purge (${reason}): removed signups/ scores/ state/; bracket.json reset to champion record.`);
}

function status() {
  if (!existsSync(p('state', 'matches.json'))) {
    const signups = existsSync(p('signups')) ? readdirSync(p('signups')).filter((f) => !f.startsWith('.')).length : 0;
    console.log(`Phase: registration. Collected signup files: ${signups}. No draw yet.`);
    return;
  }
  const state = readState();
  console.log(`\nSeed: ${state.seed}`);
  for (const r of state.rounds) console.log(`  ${r.label.padEnd(16)} ${r.matches.filter((m) => m.winner).length}/${r.matches.length} decided`);
  console.log(state.status === 'complete' ? `Champion: ${state.champion}` : 'In progress.');
  const live = state.rounds.find((r) => r.matches.some((m) => m.a && m.b && !m.winner));
  if (live) {
    console.log(`\nPending in ${live.label}:`);
    for (const m of live.matches.filter((x) => x.a && x.b && !x.winner)) console.log(`  ${m.id}:  ${m.a}  vs  ${m.b}`);
  }
}
