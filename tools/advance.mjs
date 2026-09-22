#!/usr/bin/env node
// game-state — the organizer CLI.
//
// Teams and scores travel the same road: captains submit (intake) → the
// batch queues it privately → YOU accept it here → it is published only at a
// stage change that YOU confirm.
//
//   accept (private, reversible):  admit / unadmit / reject-signup
//                                  confirm / unconfirm / result / reject-score
//   stage change (public):         close / reopen / draw / advance / reset
//     Shows the exact plan and its fingerprint, waits for you to confirm, then
//     dispatches stage.yml, which re-plans and refuses unless it gets the same
//     fingerprint. Nothing else ever changes the stage or the public files.
//
// Every command asks the stage gate first (js/engine.js → gate). The stage is
// derived from the published record; if that record is inconsistent the
// stage is 'invalid' and only look commands and `reset` run.

import { createInterface } from 'node:readline/promises';
import {
  gate, validateResult, computeQueue, roundOpenMatches, advanceCheck, currentPhaseLabel,
  formatAdmittedMd, formatAcceptedMd, formatSignupsMd, formatScoresMd, formatAttemptsMd, pruneScores, MAX_PIN_ATTEMPTS,
} from '../js/engine.js';
import { formatEntry, entryName, describeName, attemptCount } from '../js/pipeline.js';
import { pinHash, randomPin } from '../js/identity.js';
import { loadConfig, loadPublic, loadQueue, rand } from './context.mjs';
import { p, gh, ghRead, tentativeCreate, tentativeWrite, tentativeRepoName, triggerWorkflow } from './lib.mjs';
import { runBatch } from './batch.mjs';
import { planFor, executePlan } from './stage.mjs';
import { readFileSync } from 'node:fs';

const [cmd, ...args] = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const VALUED = ['--seed', '--note', '--confirm'];
// pos[0] is the command itself, so pos[1] is its first argument.
const pos = [cmd, ...args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]))];
const offline = !!process.env.TENTATIVE_DIR;

class Refused extends Error {}
const refuse = (msg) => { throw new Refused(msg); };
const must = (action, record) => { const g = gate(action, record.stage); if (!g.ok) refuse(g.error); };

const { tournament } = loadConfig();
function load() {
  const pub = loadPublic(tournament);
  try { return { ...pub, queue: loadQueue(tournament) }; }
  catch (e) { return { ...pub, queue: null, queueError: e.message.split('\n')[0] }; }
}
const needQueue = (x) => { if (!x.queue) refuse(`Cannot read the tentative repo: ${x.queueError}`); return x.queue; };

function orgEntry(e) {
  const full = { ...e, at: new Date().toISOString() };
  tentativeCreate(tournament, entryName(full, rand()), formatEntry(full), `organizer: ${e.kind} ${e.team || e.match || ''}`.trim());
}
function requestBatch(reason) {
  if (offline) { runBatch({ quiet: false }); return; }
  try { triggerWorkflow(tournament, 'batch.yml'); console.log(`Batch requested (${reason}) — it lands within a minute or so.`); }
  catch (e) { console.log(`Queued, but a batch could not be started (${e.message.split('\n')[0]}). Run \`batch\`.`); }
}

// ---- look -------------------------------------------------------------------------------

function status() {
  const x = load();
  const { record, queue } = x;
  console.log(tournament.name);
  console.log(`  Stage:   ${record.stage.toUpperCase()}${record.stage === 'round' ? ` ${record.round} — ${currentPhaseLabel(record.state) === 'complete' ? '' : record.state.rounds[record.round - 1].label}` : ''}`);
  for (const e of record.errors) console.log(`  ✖ ${e}`);
  if (record.errors.length) console.log('  The record is inconsistent — everything is frozen until it is fixed (or `reset`).');
  console.log(`  Public:  roster ${record.roster.length}/${record.progress.capacity} · results ${record.results.length}${tournament.drawSeed ? ` · seed "${tournament.drawSeed}"` : ''}`);
  if (!queue) { console.log(`  Private: unreadable (${x.queueError})`); return; }
  const waiting = queue.signups.filter((s) => !queue.admitted.some((a) => a.fp === s.fp));
  const unpublishedTeams = queue.admitted.filter((a) => !record.roster.some((t) => t.fp === a.fp));
  console.log(`  Private: ${waiting.length} registration(s) waiting · ${queue.admitted.length} admitted (${unpublishedTeams.length} not yet published) · ${queue.accepted.filter((r) => !record.results.some((p_) => p_.matchId === r.matchId)).length} result(s) accepted, not yet published · ${queue.inboxNames.length} inbox file(s) unbatched`);
  const allowed = ['signup:intake', 'signup:admit', 'phase:close', 'phase:reopen', 'draw', 'score:intake', 'score:accept', 'round:advance'].filter((a) => gate(a, record.stage).ok);
  console.log(`  Allowed: ${allowed.join(', ') || (record.stage === 'complete' ? 'nothing — the tournament is complete (`reset` to run another)' : 'nothing — fix the record, or `reset`')}`);
  if (record.stage === 'round') {
    const c = advanceCheck(record, queue.accepted);
    console.log(c.ok ? `  Round ${record.round} is fully accepted → \`advance\` publishes it.` : `  To advance: ${c.error}`);
  }
}

function check() {
  const x = load();
  const problems = [...x.record.errors];
  if (x.queue) {
    const q = x.queue;
    const dup = q.signups.map((s) => s.fp).find((c, i, a) => a.indexOf(c) !== i);
    if (dup) problems.push(`signups.md lists ${dup} more than once.`);
    for (const a of q.admitted) if (!q.signups.some((s) => s.fp === a.fp)) problems.push(`${a.fp} is admitted but has no registration (no PIN) — it could never submit a score.`);
    for (const t of x.record.roster) if (!q.admitted.some((a) => a.fp === t.fp)) problems.push(`${t.fp} is on the public roster but not in admitted.md.`);
    for (const r of q.accepted) {
      const pub = x.record.results.find((p_) => p_.matchId === r.matchId);
      if (pub && (pub.winner !== r.winner)) problems.push(`${r.matchId}: accepted ${r.winner} but ${pub.winner} is published.`);
    }
  } else if (!has('--public')) problems.push(`tentative repo unreadable: ${x.queueError}`);
  if (!problems.length) { console.log(`OK — stage ${x.record.stage}${x.record.round ? ' ' + x.record.round : ''}, ${x.record.roster.length} team(s), ${x.record.results.length} result(s); the record replays cleanly.`); return; }
  for (const pr of problems) console.log(`✖ ${pr}`);
  process.exitCode = 1;
}

function queueCmd() {
  const x = load();
  const q = needQueue(x);
  const { record } = x;
  console.log(`Stage: ${record.stage}${record.round ? ' ' + record.round : ''}`);

  const waiting = q.signups.filter((s) => !q.admitted.some((a) => a.fp === s.fp));
  console.log(`\nTEAMS — ${waiting.length} waiting, ${q.admitted.length} admitted`);
  for (const s of waiting) console.log(`  ${s.fp}  waiting since ${s.submittedAt}   → admit ${s.fp} | reject-signup ${s.fp}`);
  for (const a of q.admitted) console.log(`  ${a.fp}  admitted${record.roster.some((t) => t.fp === a.fp) ? ', published' : ' (published at close/draw)'}   → unadmit ${a.fp}`);

  if (record.stage === 'round') {
    const open = [...roundOpenMatches(record)];
    const reports = pruneScores(q.scores, record);
    const cq = computeQueue(record.state, reports);
    console.log(`\nSCORES — round ${record.round}, ${open.length} match(es)`);
    const claim = (id, fp) => { const r = reports.find((y) => y.matchId === id && y.reporterFp === fp); return r ? `${r.myScore}-${r.oppScore}` : '—'; };
    for (const [id, s] of open) {
      const acc = q.accepted.find((r) => r.matchId === id);
      const v = cq[id];
      const head = `  ${id.padEnd(7)} ${s.a} says ${claim(id, s.a).padEnd(5)} ${s.b} says ${claim(id, s.b).padEnd(5)}`;
      if (acc) console.log(`${head} ACCEPTED ${acc.winner} ${acc.scoreWinner}-${acc.scoreLoser}   → unconfirm ${id}`);
      else if (!v) console.log(`${head} none in`);
      else if (v.status === 'agreed') console.log(`${head} AGREED   → confirm ${id}`);
      else if (v.status === 'awaiting') console.log(`${head} waiting for ${v.reportedBy === s.a ? s.b : s.a}`);
      else console.log(`${head} ${v.status.toUpperCase()} → result ${id} <winner> <sW> <sL> | reject-score ${id}`);
    }
    const c = advanceCheck(record, q.accepted);
    console.log(c.ok ? `\n→ Round ${record.round} fully accepted: \`advance\` to publish it.` : `\n${c.error}`);
  }

  const locked = [...new Set(q.signups.map((s) => s.fp))].filter((fp) => attemptCount(fp, q.attempts, q.inboxNames) >= MAX_PIN_ATTEMPTS);
  if (locked.length) console.log(`\nLOCKED (${MAX_PIN_ATTEMPTS}+ wrong PINs): ${locked.join(' ')}   → unlock CODE | repin CODE`);
  if (q.inboxNames.length) console.log(`\n${q.inboxNames.length} inbox file(s) not yet batched → batch`);
  if (q.rejected.length) console.log(`\nLatest rejections at batch → rejected\n${q.rejected.slice(-3).map((r) => `  ${r.entry}: ${r.reason}`).join('\n')}`);
}

function inbox() {
  const q = needQueue(load());
  if (!q.inboxNames.length) { console.log('Inbox empty — everything has been batched.'); return; }
  console.log(`${q.inboxNames.length} waiting for the next batch:`);
  for (const n of q.inboxNames) { const d = describeName(n); console.log(`  ${d ? `${d.kind.padEnd(18)} ${d.team || ''} ${d.match || ''}` : n}`); }
}

function rejected() {
  const q = needQueue(load());
  if (!q.rejected.length) { console.log('Nothing has been rejected at batch.'); return; }
  for (const r of q.rejected.slice(-(Number(pos[1]) || 20))) console.log(`  ${r.at}  ${r.entry}\n      ${r.reason}`);
}

// ---- accept: teams (private until a stage change publishes them) ------------------------------

function admit() {
  const x = load();
  must('signup:admit', x.record);
  const q = needQueue(x);
  let waiting = q.signups.filter((s) => !q.admitted.some((a) => a.fp === s.fp));
  const codes = pos.slice(1).map((c) => c.toUpperCase());
  if (codes.length) {
    const missing = codes.filter((c) => !waiting.some((s) => s.fp === c));
    if (missing.length) refuse(`Not waiting: ${missing.join(', ')}. (\`queue\` shows who is; brand-new registrations appear after the next batch.)`);
    waiting = waiting.filter((s) => codes.includes(s.fp));
  } else if (!has('--all')) refuse(`Name the teams, or --all. Waiting: ${waiting.map((s) => s.fp).join(' ') || '(nobody)'}`);
  if (!waiting.length) { console.log('Nobody is waiting.'); return; }
  const room = x.record.progress.capacity - q.admitted.length;
  if (room <= 0) refuse(`Admitted is at capacity (${x.record.progress.capacity}).`);
  const taking = waiting.slice(0, room);
  const next = [...q.admitted, ...taking.map((s) => ({ fp: s.fp, tokenHash: s.tokenHash, registeredAt: s.submittedAt }))];
  tentativeWrite(tournament, 'admitted.md', formatAdmittedMd(next), `admit: ${taking.map((s) => s.fp).join(' ')}`, q.admittedSha);
  console.log(`Admitted ${taking.map((s) => s.fp).join(' ')} (${next.length}/${x.record.progress.capacity}). Private until you \`close\` or \`draw\`.`);
  if (taking.length < waiting.length) console.log(`${waiting.length - taking.length} not admitted — capacity reached.`);
}

function unadmit() {
  const x = load();
  must('signup:admit', x.record);
  const q = needQueue(x);
  const fp = (pos[1] || '').toUpperCase();
  if (!q.admitted.some((a) => a.fp === fp)) refuse(`${fp || '(none given)'} is not admitted.`);
  tentativeWrite(tournament, 'admitted.md', formatAdmittedMd(q.admitted.filter((a) => a.fp !== fp)), `unadmit: ${fp}`, q.admittedSha);
  console.log(`${fp} is back in the waiting list.${x.record.roster.some((t) => t.fp === fp) ? ' It stays on the published roster until the next close/draw republishes it.' : ''}`);
}

function rejectSignup() {
  const x = load();
  must('signup:reject', x.record);
  const q = needQueue(x);
  const fp = (pos[1] || '').toUpperCase();
  if (!fp) refuse('Usage: reject-signup CODE [--note "reason"]');
  if (q.admitted.some((a) => a.fp === fp)) refuse(`${fp} is admitted — \`unadmit ${fp}\` first.`);
  if (!q.signups.some((s) => s.fp === fp) && !q.inboxNames.some((n) => describeName(n)?.team === fp)) refuse(`No registration for ${fp}.`);
  orgEntry({ kind: 'org-reject-signup', team: fp, note: opt('--note') });
  console.log(`Rejection of ${fp} queued.`);
  requestBatch(`reject ${fp}`);
}

// ---- accept: scores (private until `advance` publishes the round) ------------------------------

function writeAccepted(q, rows, message) {
  tentativeWrite(tournament, 'accepted.md', formatAcceptedMd(rows), message, q.acceptedSha);
}

function confirm() {
  const x = load();
  must('score:accept', x.record);
  const q = needQueue(x);
  const open = roundOpenMatches(x.record);
  const cq = computeQueue(x.record.state, pruneScores(q.scores, x.record));
  const agreed = Object.entries(cq).filter(([id, v]) => v.status === 'agreed' && open.has(id) && !q.accepted.some((r) => r.matchId === id));
  let ids;
  if (has('--all')) ids = agreed.map(([id]) => id);
  else {
    const id = pos[1];
    if (!id) refuse(`Usage: confirm <matchId> | confirm --all. Agreed and not yet accepted: ${agreed.map(([i]) => i).join(' ') || '(none)'}`);
    if (!open.has(id)) refuse(`${id} is not open in round ${x.record.round}.`);
    if (q.accepted.some((r) => r.matchId === id)) refuse(`${id} is already accepted (\`unconfirm ${id}\` to take it back).`);
    if (!cq[id]) refuse(`Nothing submitted for ${id}.`);
    if (cq[id].status !== 'agreed') refuse(`${id} is ${cq[id].status}, not agreed — decide it with \`result\`.`);
    ids = [id];
  }
  if (!ids.length) { console.log('No agreed results waiting.'); return; }
  const rows = [...q.accepted];
  for (const id of ids) {
    const v = cq[id];
    const r = { matchId: id, winner: v.winner, scoreWinner: Math.max(v.scoreA, v.scoreB), scoreLoser: Math.min(v.scoreA, v.scoreB), confirmedAt: new Date().toISOString() };
    const ok = validateResult(x.record.state, r);
    if (!ok.ok) refuse(`${id}: ${ok.error} Nothing was accepted.`);
    rows.push(r);
    console.log(`Accepted ${id} → ${r.winner} ${r.scoreWinner}-${r.scoreLoser}`);
  }
  writeAccepted(q, rows, `accept: ${ids.join(' ')}`);
  afterAccept(x.record, rows);
}

function result() {
  const [, id, w, sW, sL] = pos;
  if (!id || !w || sW == null || sL == null) refuse('Usage: result <matchId> <winnerCode> <scoreWinner> <scoreLoser>   (decide a match yourself: disputes, walkovers)');
  const x = load();
  must('score:accept', x.record);
  const q = needQueue(x);
  if (!roundOpenMatches(x.record).has(id)) refuse(`${id} is not open in round ${x.record.round}.`);
  if (q.accepted.some((r) => r.matchId === id)) refuse(`${id} is already accepted — \`unconfirm ${id}\` first.`);
  const r = { matchId: id, winner: w.toUpperCase(), scoreWinner: Number(sW), scoreLoser: Number(sL), confirmedAt: new Date().toISOString() };
  const v = validateResult(x.record.state, r);
  if (!v.ok) refuse(`${id}: ${v.error}`);
  const rows = [...q.accepted, r];
  writeAccepted(q, rows, `result: ${id} -> ${r.winner}`);
  console.log(`Accepted ${id} → ${r.winner} ${r.scoreWinner}-${r.scoreLoser} (decided by you).`);
  afterAccept(x.record, rows);
}

function unconfirm() {
  const x = load();
  must('score:accept', x.record);
  const q = needQueue(x);
  const id = pos[1];
  if (!q.accepted.some((r) => r.matchId === id)) refuse(`${id || '(none given)'} is not accepted.`);
  if (x.record.results.some((r) => r.matchId === id)) refuse(`${id} is already published — it can't be taken back.`);
  writeAccepted(q, q.accepted.filter((r) => r.matchId !== id), `unaccept: ${id}`);
  console.log(`${id} is back in the queue.`);
}

function afterAccept(record, accepted) {
  const c = advanceCheck(record, accepted);
  console.log(c.ok ? `Round ${record.round} is fully accepted. \`advance\` to publish it.` : `${c.missing?.length ?? 0} match(es) left in round ${record.round}.`);
}

function rejectScore() {
  const x = load();
  must('score:reject', x.record);
  const id = pos[1];
  const fp = pos[2]?.toUpperCase();
  if (!id) refuse('Usage: reject-score <matchId> [CODE]   (clears submissions so the captains resubmit)');
  if (!roundOpenMatches(x.record).has(id)) refuse(`${id} is not open in round ${x.record.round}.`);
  orgEntry({ kind: 'org-reject-score', match: id, team: fp, note: opt('--note') });
  console.log(`Clearing ${fp ? `${fp}'s` : 'both'} submission(s) for ${id} — queued.`);
  requestBatch(`reject-score ${id}`);
}

// ---- stage changes: plan → your confirmation → stage.yml -----------------------------------------

async function stageChange(action) {
  const opts = {
    leavePending: has('--leave-pending'),
    seed: action === 'draw' ? (opt('--seed') || `${tournament.name}:${Date.now()}`) : undefined,
  };
  const planned = await planFor(action, opts);
  if (!planned.ok) refuse(planned.error);

  console.log(`\nPLAN ${planned.fingerprint} — ${action}${offline ? ' (offline rehearsal)' : ''}`);
  for (const line of planned.plan.summary) console.log(`  ${line}`);
  console.log('');

  const given = opt('--confirm');
  if (given) {
    if (given !== planned.fingerprint) refuse(`--confirm ${given} does not match the plan (${planned.fingerprint}). Nothing was done.`);
  } else {
    if (!process.stdin.isTTY) refuse(`Not confirmed. Re-run with --confirm ${planned.fingerprint} once you have reviewed the plan above.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Type ${planned.fingerprint} to confirm, anything else to cancel: `)).trim();
    rl.close();
    if (answer !== planned.fingerprint) { console.log('Cancelled. Nothing was changed.'); return; }
  }

  if (offline) { executePlan(planned); console.log('Published locally.'); return; }
  const inputs = ['-f', `action=${action}`, '-f', `expect=${planned.fingerprint}`, '-f', `leave_pending=${opts.leavePending}`];
  if (opts.seed) inputs.push('-f', `seed=${opts.seed}`);
  gh(['workflow', 'run', 'stage.yml', '--repo', tournament.appRepo, ...inputs]);
  console.log(`Dispatched stage.yml in ${tournament.appRepo} with plan ${planned.fingerprint}.`);
  console.log(`It publishes only if the live record still produces this exact plan. Watch: gh run list --repo ${tournament.appRepo} --workflow stage.yml`);
  if (has('--wait')) {
    execWatch();
  }
}

function execWatch() {
  const id = gh(['run', 'list', '--repo', tournament.appRepo, '--workflow', 'stage.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId']).trim();
  if (id) console.log(gh(['run', 'watch', id, '--repo', tournament.appRepo, '--exit-status']));
}

// ---- lockout -----------------------------------------------------------------------------------------

function unlock() {
  const fp = (pos[1] || '').toUpperCase();
  if (!fp) refuse('Usage: unlock CODE');
  orgEntry({ kind: 'org-unlock', team: fp });
  console.log(`Unlock of ${fp} queued.`);
  requestBatch(`unlock ${fp}`);
}

async function repin() {
  const fp = (pos[1] || '').toUpperCase();
  if (!fp) refuse('Usage: repin CODE');
  const q = needQueue(load());
  if (!q.signups.some((s) => s.fp === fp)) refuse(`No registration for ${fp}.`);
  const pin = randomPin();
  orgEntry({ kind: 'org-repin', team: fp, pinHash: await pinHash(fp, pin) });
  console.log(`New PIN for ${fp}: ${pin}\nGive it to that captain privately. It takes effect at the next batch; the old PIN stops working then.`);
  requestBatch(`repin ${fp}`);
}

// ---- ops ------------------------------------------------------------------------------------------------

function batch() {
  if (offline) { runBatch(); return; }
  triggerWorkflow(tournament, 'batch.yml');
  console.log(`Batch requested. Watch: gh run list --repo ${tentativeRepoName(tournament)} --workflow batch.yml`);
}

function install() {
  const repo = tentativeRepoName(tournament);
  const put = (path, text, msg) => {
    const { sha } = ghRead(repo, path);
    gh(['api', `repos/${repo}/contents/${path}`, '-X', 'PUT', '-f', `message=${msg}`, '-f', `content=${Buffer.from(text).toString('base64')}`, ...(sha ? ['-f', `sha=${sha}`] : [])]);
    console.log(`  ${sha ? 'updated' : 'created'} ${path}`);
  };
  console.log(`Installing into ${repo}:`);
  for (const f of ['intake.yml', 'batch.yml']) {
    const text = readFileSync(p('tentative', '.github', 'workflows', f), 'utf8').replaceAll('__APP_REPO__', tournament.appRepo);
    try { put(`.github/workflows/${f}`, text, `install ${f}`); }
    catch (e) {
      if (/workflow/i.test(e.message)) refuse('gh needs the "workflow" scope to install workflows: `gh auth refresh -s workflow`, then install again.');
      throw e;
    }
  }
  const seeds = {
    'signups.md': formatSignupsMd([]), 'scores.md': formatScoresMd([]), 'attempts.md': formatAttemptsMd([]),
    'admitted.md': formatAdmittedMd([]), 'accepted.md': formatAcceptedMd([]),
  };
  for (const [path, text] of Object.entries(seeds)) if (!ghRead(repo, path).sha) put(path, text, `seed ${path}`);
  if (!ghRead(repo, 'README.md').sha) put('README.md', readFileSync(p('tentative', 'README.md'), 'utf8'), 'README');
  console.log('Done. Next, the tokens — README, "Set up the private repo".');
}

// ---- dispatch --------------------------------------------------------------------------------------------

const COMMANDS = {
  status, check, queue: queueCmd, inbox, rejected,
  admit, unadmit, 'reject-signup': rejectSignup,
  confirm, unconfirm, result, 'reject-score': rejectScore,
  close: () => stageChange('close'), reopen: () => stageChange('reopen'), draw: () => stageChange('draw'),
  advance: () => stageChange('advance'), reset: () => stageChange('reset'),
  unlock, repin, batch, install,
};

const USAGE = `node tools/advance.mjs <command>

 look          status · check · queue · inbox · rejected [N]
 accept teams  admit CODE… | admit --all · unadmit CODE · reject-signup CODE [--note "…"]
 accept scores confirm <matchId> | confirm --all · unconfirm <matchId>
               result <matchId> <W> <sW> <sL> · reject-score <matchId> [CODE]
 stage change  close · reopen · draw [--seed S] [--leave-pending] · advance · reset
               (each shows its plan and waits for you to confirm; add --confirm <fingerprint>
                to confirm non-interactively, --wait to watch the workflow)
 lockout       unlock CODE · repin CODE
 ops           batch · install`;

if (!COMMANDS[cmd]) { console.log(USAGE); process.exit(cmd ? 1 : 0); }
try { await COMMANDS[cmd](); }
catch (e) {
  if (e instanceof Refused || e.constructor?.name === 'Conflict') { console.error(`✖ ${e.message}`); process.exit(1); }
  throw e;
}
