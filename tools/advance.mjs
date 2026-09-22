#!/usr/bin/env node
// game-state — the bracket state machine (organizer / CI side).
//
// Thin fs wrapper around the shared pure engine in ../js/engine.js (the same
// module the browser admin console uses). No keys anywhere: a team's identity
// is a token hash, checked by comparison, not verified by signature. It owns:
//
//   state/matches.json     the full bracket, every round & match (working state)
//   config/public.json     anonymized public bracket / signup progress
//   config/bracket.json    per-team PLAINTEXT views (the bracket is already public)
//   config/queue.json      two-captain score consensus queue
//
// The confirmed roster itself is NOT stored here — it lives in a separate
// public repo (config/tournament.json → rosterRepo) and is fetched fresh on
// every command that needs it. See tools/lib.mjs → fetchRosterMd.
//
// Subcommands: draw · result · sim · render · tally · progress · purge · status
// After the FINAL match, result/sim auto-purge all stored data.

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { hashToken, decodeBlob } from '../js/identity.js';
import {
  buildDraw, applyResult, simAll, computeQueue, buildPublic, buildViews,
  currentPhaseLabel, signupProgress, buildSignupProgress,
  parseRosterMd, formatResultsMd, parseResultsMd,
} from '../js/engine.js';
import { p, fetchRosterMd, fetchResultsMd, ghPutFile } from './lib.mjs';

const readJson = (f) => JSON.parse(readFileSync(p(...f), 'utf8'));
const writeJson = (f, o) => writeFileSync(p(...f), JSON.stringify(o, null, 2) + '\n');
const tournament = readJson(['config', 'tournament.json']);

async function roster() {
  return parseRosterMd(await fetchRosterMd(tournament));
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

switch (cmd) {
  case 'draw': await draw(); break;
  case 'result': await result(args[0], args[1]); break;
  case 'sim': await sim(); break;
  case 'render': await render(readState()); break;
  case 'tally': await tally(); break;
  case 'progress': await progress(); break;
  case 'stage': stage(args[0]); break;
  case 'purge': purge('manual purge'); break;
  case 'status': await status(); break;
  default:
    console.log('Usage: node advance.mjs <draw|result <matchId> <winnerFp>|tally|sim|render|progress|stage <phaseId>|purge|status> [--seed S]');
}

function readState() {
  if (!existsSync(p('state', 'matches.json'))) { console.error('No bracket yet. Run: node advance.mjs draw'); process.exit(1); }
  return readJson(['state', 'matches.json']);
}

async function draw() {
  const teams = await roster();
  if (teams.length < 2) { console.error('Need at least 2 teams in the roster to draw.'); process.exit(1); }

  const seed = flag('--seed', `${tournament.name}:${teams.length}:${Date.now()}`);
  const state = buildDraw(teams.map((t) => t.fp), seed);

  mkdirSync(p('state'), { recursive: true });
  writeJson(['state', 'matches.json'], state);
  render(state);
  console.log(`Drew ${teams.length}-team bracket (seed "${seed}"), ${state.rounds.length} rounds.`);
  await status();
}

async function result(matchId, winnerFp) {
  if (!matchId || !winnerFp) { console.error('Usage: result <matchId> <winnerFp>'); process.exit(1); }
  const state = readState();
  const r = applyResult(state, matchId, winnerFp);
  if (!r.ok) { console.log(r.error); process.exit(r.error.includes('already decided') ? 0 : 1); }
  await postResult(matchId, winnerFp);
  await finish(state, `${matchId} → ${winnerFp}`, r);
}

// Once a match is confirmed here, it's posted to the public results ledger
// (results.md, in the roster repo) via gh — this is what makes a result an
// actual public fact rather than just local working state. The score comes
// from the agreed queue entry, if config/queue.json still has it.
async function postResult(matchId, winnerFp) {
  let scoreWinner = '', scoreLoser = '';
  try {
    const q = readJson(['config', 'queue.json']).matches[matchId];
    if (q?.status === 'agreed') [scoreWinner, scoreLoser] = [Math.max(q.scoreA, q.scoreB), Math.min(q.scoreA, q.scoreB)];
  } catch { /* no queue yet — post without a score */ }
  const results = parseResultsMd(await fetchResultsMd(tournament));
  results.push({ matchId, winner: winnerFp, scoreWinner, scoreLoser, confirmedAt: new Date().toISOString() });
  ghPutFile(tournament.rosterRepo, 'results.md', formatResultsMd(results), `result: ${matchId} -> ${winnerFp}`);
  console.log(`Posted to ${tournament.rosterRepo}/results.md via gh.`);
}

// The ONLY way to advance activePhase: publishes straight to the app repo via
// gh, so progressing a stage requires an authenticated `gh` with push access
// to that repo — there is no key to check anymore, so this IS the gate.
function stage(phaseId) {
  if (!phaseId) { console.error('Usage: stage <phaseId>'); process.exit(1); }
  if (!tournament.phases.some((ph) => ph.id === phaseId)) {
    console.error(`Unknown phase "${phaseId}". Valid: ${tournament.phases.map((ph) => ph.id).join(', ')}`);
    process.exit(1);
  }
  const updated = { ...tournament, activePhase: phaseId };
  writeJson(['config', 'tournament.json'], updated);
  ghPutFile(tournament.appRepo, 'config/tournament.json', JSON.stringify(updated, null, 2) + '\n', `stage: -> ${phaseId}`);
  console.log(`Advanced to phase "${phaseId}" and pushed to ${tournament.appRepo} via gh. Pages will redeploy.`);
}

async function sim() {
  if (!existsSync(p('state', 'matches.json'))) await draw();
  const state = readState();
  const r = simAll(state);
  await finish(state, 'simulated all rounds', r);
}

async function finish(state, msg, result) {
  writeJson(['state', 'matches.json'], state);
  render(state);
  console.log(`Applied: ${msg}`);
  if (result.complete) {
    console.log(`🏆 Champion decided: ${result.champion}`);
    purge('tournament complete', result.champion);
  } else {
    await status();
  }
}

// Regenerate the public bracket + per-team plaintext views from state. The
// team list comes straight from round 0 — every drawn team appears there, so
// there's no need to re-fetch the roster just to render.
function render(state) {
  const teamFps = state.rounds[0].matches.flatMap((m) => [m.a, m.b]).filter(Boolean);
  writeJson(['config', 'public.json'], buildPublic(state, tournament.name, teamFps.length));

  const views = buildViews(state, teamFps);
  writeJson(['config', 'bracket.json'], {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    activePhase: state.status === 'complete' ? 'complete' : currentPhaseLabel(state),
    seed: state.seed || null, teamCount: teamFps.length,
    note: 'Per-team views. The bracket is already public, so these are plaintext — only score reports need a token.',
    views,
  });
}

// Two-captain consensus: check each report's token against the roster, then
// let the engine compute the queue. A report whose token doesn't hash to the
// claimed team's roster entry is silently dropped, same as unreadable input.
async function tally() {
  const state = readState();
  const byFp = new Map((await roster()).map((t) => [t.fp, t.tokenHash]));

  const dir = p('scores');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
  const reports = [];
  let accepted = 0, rejected = 0;
  for (const f of files) {
    const mm = readFileSync(p('scores', f), 'utf8').match(/([A-Za-z0-9_-]{60,})/);
    if (!mm) { rejected++; continue; }
    let rep;
    try { rep = decodeBlob(mm[1]); } catch { rejected++; continue; }
    const expected = byFp.get(rep.fp);
    if (!expected || await hashToken(rep.token) !== expected) { rejected++; continue; }
    reports.push({ reporterFp: rep.fp, matchId: rep.matchId, myScore: rep.myScore, oppScore: rep.oppScore, ts: rep.ts });
    accepted++;
  }

  const queue = computeQueue(state, reports);
  writeJson(['config', 'queue.json'], {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    note: 'Match result queue. A match is "agreed" only when both captains report mirrored scores; the organizer confirms it to advance.',
    matches: queue,
  });
  const agreed = Object.values(queue).filter((q) => q.status === 'agreed').length;
  console.log(`Tallied ${accepted} report(s), ${rejected} rejected. Queue: ${Object.keys(queue).length} match(es), ${agreed} agreed & ready.`);
}

// Pre-draw counterpart to `render()`: publishes the confirmed roster's signup
// capacity to config/public.json so the live site can decide whether
// registration is still open. Nothing does this automatically — it's a
// deliberate organizer action, same as every other state change here.
async function progress() {
  const teams = await roster();
  const obj = buildSignupProgress(teams.map((t) => t.fp), tournament.name, tournament.teamCount, tournament.groupSize);
  writeJson(['config', 'public.json'], obj);
  console.log(`Published signup progress: ${obj.registered}/${obj.capacity} confirmed${obj.full ? ' (full)' : ''}.`);
  for (const g of obj.groups) console.log(`  Group ${g.index + 1}: ${g.filled}/${g.slots}${g.full ? ' FULL' : ''}`);
}

function purge(reason, champion = null) {
  for (const dir of ['scores', 'state']) {
    if (existsSync(p(dir))) rmSync(p(dir), { recursive: true, force: true });
  }
  writeJson(['config', 'queue.json'], { schemaVersion: 1, generatedAt: new Date().toISOString(), note: 'Tournament complete — queue cleared.', matches: {} });
  writeJson(['config', 'bracket.json'], {
    schemaVersion: 1, generatedAt: new Date().toISOString(), activePhase: 'complete',
    completed: true, champion, teamCount: 0,
    note: `Tournament complete (${reason}). All stored data cascade-deleted.`,
    views: {},
  });
  console.log(`🧹 Cascade purge (${reason}): removed scores/ state/; bracket.json reset to champion record.`);
}

async function status() {
  if (!existsSync(p('state', 'matches.json'))) {
    const prog = signupProgress((await roster()).map((t) => t.fp), tournament.teamCount, tournament.groupSize);
    console.log(`Phase: registration. Confirmed roster: ${prog.registered}/${prog.capacity}${prog.full ? ' (full)' : ''}. No draw yet.`);
    for (const g of prog.groups) console.log(`  Group ${g.index + 1}: ${g.filled}/${g.slots}${g.full ? ' FULL' : ''}`);
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
