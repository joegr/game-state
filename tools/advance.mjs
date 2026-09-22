#!/usr/bin/env node
// game-state — the organizer CLI. No JSON, no local database: everything
// durable is markdown, and the ONLY way any of it changes is this tool
// calling `gh`. It owns nothing on disk except `config/tournament.md` (this
// repo, the organizer-owned spine: name, format, activePhase, drawSeed) and
// two files in the roster repo:
//
//   roster.md    confirmed teams — code + token hash (never the raw token)
//   results.md   confirmed match results, append-only
//
// The whole bracket is reconstructed on demand from
// buildDraw(roster, tournament.drawSeed) replayed with every row in
// results.md — nothing about it is stored beyond the seed. The browser
// (js/config.js → loadTournamentState) does the exact same reconstruction,
// so there is exactly one algorithm and two callers.
//
// Score reports are the one thing that stays local and unpublished
// (scores/) — they're working state on the way to a confirmed result, not
// part of the record.
//
// The draw is the moment the field freezes: buildDraw's output depends on the
// roster array it is given, so once `drawSeed` is set, changing either the
// seed or the roster silently invalidates every matchId already recorded in
// results.md. `draw` and `ingest` both guard against that below.
//
// Subcommands: ingest · draw · tally · result · stage · purge · status

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { hashToken, generateCode, decodeBlob, encodeBlob } from '../js/identity.js';
import {
  buildDraw, applyResult, computeQueue, playableMatches, classifyPayload,
  parseConfigMd, formatConfigMd, parseRosterMd, formatRosterMd,
  parseResultsMd, formatResultsMd, signupProgress,
} from '../js/engine.js';
import { p, fetchRosterMd, fetchResultsMd, ghPutFile } from './lib.mjs';

// TOURNAMENT_FILE mirrors ROSTER_FILE/RESULTS_FILE in lib.mjs: point all three
// at scratch files to exercise the CLI offline, against nothing real.
const configPath = process.env.TOURNAMENT_FILE || p('config', 'tournament.md');
const tournament = parseConfigMd(readFileSync(configPath, 'utf8'));

async function fetchRoster() {
  return parseRosterMd(await fetchRosterMd(tournament)).sort((a, b) => a.fp.localeCompare(b.fp));
}

// The one reconstruction, mirroring js/config.js → loadTournamentState.
async function reconstruct() {
  const roster = await fetchRoster();
  if (!tournament.drawSeed) return { roster, state: null };
  const state = buildDraw(roster.map((t) => t.fp), tournament.drawSeed);
  for (const r of parseResultsMd(await fetchResultsMd(tournament))) applyResult(state, r.matchId, r.winner);
  return { roster, state };
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes(name);

switch (cmd) {
  case 'ingest': await ingest(args[0]); break;
  case 'draw': await draw(); break;
  case 'tally': await tally(); break;
  case 'result': await result(args[0], args[1], args[2], args[3]); break;
  case 'stage': await stage(args[0]); break;
  case 'purge': purge(); break;
  case 'status': await status(); break;
  default:
    console.log('Usage: node advance.mjs <ingest <file>|draw|tally|result <matchId> <winnerFp> <scoreWinner> <scoreLoser>|stage <phaseId>|purge|status> [--seed S] [--force]');
}

// Reads a text file of pasted blobs (signups + score reports, auto-detected).
// Signups: verified against the live roster, new ones published to roster.md
// via gh in ONE call. Score reports: verified against the live roster,
// written to local scores/ for `tally` — never published directly; only a
// CONFIRMED result (via `result`) becomes part of the record.
//
// Once the draw has run the roster is frozen: appending a team would change
// buildDraw's input array and rebuild a different bracket under the results
// already published. Late signups are counted and reported, never published.
async function ingest(file) {
  if (!file) { console.error('Usage: ingest <file>'); process.exit(1); }
  const text = readFileSync(file, 'utf8');
  const drawn = !!tournament.drawSeed;
  const roster = await fetchRoster();
  const existingFps = new Set(roster.map((t) => t.fp));
  const byFp = new Map(roster.map((t) => [t.fp, t.tokenHash]));

  const newTeams = [];
  let dup = 0, scores = 0, bad = 0;
  mkdirSync(p('scores'), { recursive: true });

  for (const tok of text.match(/[A-Za-z0-9_-]{60,}/g) || []) {
    let payload;
    try { payload = decodeBlob(tok); } catch { bad++; continue; }
    const c = classifyPayload(payload);
    if (!c) { bad++; continue; }
    if (c.type === 'signup') {
      const fp = await generateCode(c.token);
      if (existingFps.has(fp) || newTeams.some((t) => t.fp === fp)) { dup++; continue; }
      newTeams.push({ fp, tokenHash: await hashToken(c.token), registeredAt: new Date().toISOString() });
    } else {
      const expected = byFp.get(c.fp);
      if (!expected || await hashToken(c.token) !== expected) { bad++; continue; }
      writeFileSync(p('scores', `${c.matchId}-${c.fp}.txt`), encodeBlob(c) + '\n');
      scores++;
    }
  }

  if (newTeams.length && drawn) {
    console.error(`Refusing to add ${newTeams.length} team(s): the draw has already run (seed "${tournament.drawSeed}").`);
    console.error('The bracket is rebuilt from roster.md every time it is read, so adding a team now would');
    console.error('produce a different bracket and orphan every result already in results.md.');
    console.error(`Late team(s): ${newTeams.map((t) => t.fp).join(', ')}`);
  } else if (newTeams.length) {
    ghPutFile(tournament.rosterRepo, 'roster.md', formatRosterMd([...roster, ...newTeams]), `ingest: +${newTeams.length} team(s)`);
  }

  const published = drawn ? 0 : newTeams.length;
  const late = drawn ? newTeams.length : 0;
  console.log(`Ingested: +${published} team(s) published to roster.md, ${scores} score report(s) saved locally for tally${late ? `, ${late} rejected as late (post-draw)` : ''}${dup ? `, ${dup} duplicate` : ''}${bad ? `, ${bad} unreadable/unauthenticated` : ''}.`);
  if (late) process.exitCode = 1;
}

// Publishes only the seed — the bracket itself needs nothing else stored.
// Drawing twice is the other half of the freeze: a new seed reshuffles the
// same roster into a different bracket, so every published matchId stops
// meaning what it meant. Refused unless --force, and --force with results
// already on record says exactly what it is about to orphan.
async function draw() {
  const roster = await fetchRoster();
  if (roster.length < 2) { console.error('Need at least 2 teams in the roster to draw.'); process.exit(1); }

  if (tournament.drawSeed) {
    const existing = parseResultsMd(await fetchResultsMd(tournament));
    console.error(`The draw has already run (seed "${tournament.drawSeed}").`);
    console.error('Re-drawing reshuffles the same roster into a different bracket, which invalidates');
    console.error('every result already in results.md.');
    if (!has('--force')) { console.error('Pass --force if you are certain. Nothing has been changed.'); process.exit(1); }
    if (existing.length) {
      console.error(`--force will orphan ${existing.length} confirmed result(s): ${existing.map((r) => r.matchId).join(', ')}`);
      console.error('Clear results.md in the roster repo first if that is really what you want.');
      process.exit(1);
    }
    console.error('--force accepted: no results published yet, so nothing is orphaned.');
  }

  const seed = flag('--seed', `${tournament.name}:${roster.length}:${Date.now()}`);
  const state = buildDraw(roster.map((t) => t.fp), seed); // local preview only, not stored

  // Push first, then mirror locally: the published file is the record, and a
  // local copy claiming a seed that never made it to GitHub is worse than no
  // local copy at all (the next `draw` would refuse for a draw that never
  // happened).
  const updated = { ...tournament, drawSeed: seed };
  ghPutFile(tournament.appRepo, 'config/tournament.md', formatConfigMd(updated), `draw: seed ${seed}`);
  writeFileSync(configPath, formatConfigMd(updated));
  console.log(`Drew ${roster.length}-team bracket (seed "${seed}"), ${state.rounds.length} rounds. Pushed to ${tournament.appRepo} via gh.`);
}

// Two-captain consensus over locally-collected reports (scores/) against the
// live, reconstructed bracket. Never published — only `result` publishes.
async function tally() {
  const { state } = await reconstruct();
  if (!state) { console.error('No draw yet. Run: node advance.mjs draw'); process.exit(1); }

  const dir = p('scores');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
  const reports = [];
  let accepted = 0, rejected = 0;
  const byFp = new Map((await fetchRoster()).map((t) => [t.fp, t.tokenHash]));
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
  const agreed = Object.entries(queue).filter(([, v]) => v.status === 'agreed');
  console.log(`Tallied ${accepted} report(s), ${rejected} rejected. ${agreed.length} agreed & ready:`);
  for (const [id, v] of agreed) {
    const [hi, lo] = [Math.max(v.scoreA, v.scoreB), Math.min(v.scoreA, v.scoreB)];
    console.log(`  node tools/advance.mjs result ${id} ${v.winner} ${hi} ${lo}`);
  }
}

// The only way a match result becomes a fact: validated against the live,
// reconstructed bracket, then posted to results.md via gh.
async function result(matchId, winnerFp, scoreWinner, scoreLoser) {
  if (!matchId || !winnerFp || scoreWinner == null || scoreLoser == null) {
    console.error('Usage: result <matchId> <winnerFp> <scoreWinner> <scoreLoser>'); process.exit(1);
  }
  const { state } = await reconstruct();
  if (!state) { console.error('No draw yet. Run: node advance.mjs draw'); process.exit(1); }
  const r = applyResult(state, matchId, winnerFp);
  if (!r.ok) { console.log(r.error); process.exit(r.error.includes('already decided') ? 0 : 1); }

  const results = parseResultsMd(await fetchResultsMd(tournament));
  results.push({ matchId, winner: winnerFp, scoreWinner, scoreLoser, confirmedAt: new Date().toISOString() });
  ghPutFile(tournament.rosterRepo, 'results.md', formatResultsMd(results), `result: ${matchId} -> ${winnerFp}`);
  console.log(`Posted ${matchId} -> ${winnerFp} (${scoreWinner}-${scoreLoser}) to ${tournament.rosterRepo}/results.md via gh.`);

  if (r.complete) { console.log(`🏆 Champion decided: ${r.champion}`); purge(); }
  else await status();
}

// The only way activePhase changes: publishes straight to the app repo via
// gh, so progressing a stage requires an authenticated `gh` with push access
// to that repo — there is no key to check anymore, so this IS the gate.
async function stage(phaseId) {
  if (!phaseId) { console.error('Usage: stage <phaseId>'); process.exit(1); }
  if (!tournament.phases.some((ph) => ph.id === phaseId)) {
    console.error(`Unknown phase "${phaseId}". Valid: ${tournament.phases.map((ph) => ph.id).join(', ')}`);
    process.exit(1);
  }
  const updated = { ...tournament, activePhase: phaseId };
  ghPutFile(tournament.appRepo, 'config/tournament.md', formatConfigMd(updated), `stage: -> ${phaseId}`); // push first — see draw()
  writeFileSync(configPath, formatConfigMd(updated));
  console.log(`Advanced to phase "${phaseId}" and pushed to ${tournament.appRepo} via gh. Pages will redeploy.`);
}

// Clears local, unpublished working files (pending score reports). There is
// nothing else local to reset — the record lives entirely in the two repos.
function purge() {
  if (existsSync(p('scores'))) rmSync(p('scores'), { recursive: true, force: true });
  console.log('🧹 Cleared local scores/ (unpublished reports).');
}

async function status() {
  const { roster, state } = await reconstruct();
  if (!state) {
    const prog = signupProgress(roster.map((t) => t.fp), tournament.teamCount, tournament.groupSize);
    console.log(`Phase: ${tournament.activePhase}. Confirmed roster: ${prog.registered}/${prog.capacity}${prog.full ? ' (full)' : ''}. No draw yet.`);
    for (const g of prog.groups) console.log(`  Group ${g.index + 1}: ${g.filled}/${g.slots}${g.full ? ' FULL' : ''}`);
    return;
  }
  console.log(`\nSeed: ${state.seed}`);
  for (const r of state.rounds) console.log(`  ${r.label.padEnd(16)} ${r.matches.filter((m) => m.winner).length}/${r.matches.length} decided`);
  console.log(state.status === 'complete' ? `Champion: ${state.champion}` : 'In progress.');
  const sides = playableMatches(state);
  if (sides.size) {
    console.log('\nPending:');
    for (const [id, s] of sides) console.log(`  ${id}:  ${s.a}  vs  ${s.b}`);
  }
}
