// game-state — the intake → queue → accept → publish pipeline, as pure logic.
//
// Teams and scores travel the same road:
//
//   1. INTAKE    one GitHub Actions run per captain submission (intake.yml, in
//                the private tentative repo). Stage gate, PIN and lockout, open
//                match. An accepted submission becomes its OWN new file in
//                inbox/. New files never collide, so simultaneous submissions
//                cannot overwrite each other.
//   2. BATCH     one run at a time (batch.yml). Folds the inbox, in filename
//                order, into the private queue (signups.md, scores.md,
//                attempts.md), re-checking every gate NOW. Anything no longer
//                valid is dropped and logged to rejected.md.
//   3. ACCEPT    the organizer decides, with the CLI: `admit` / `confirm` write
//                the private acceptance files (admitted.md, accepted.md).
//                Nothing public changes.
//   4. PUBLISH   only at a stage change, only when the organizer asks for it,
//                and only after they have confirmed the exact plan below. The
//                stage workflow (stage.yml, app repo) re-plans, checks the plan
//                is identical to the one confirmed (its fingerprint), and
//                writes the public files, config last.
//
// Automated steps (1, 2) only ever move raw submissions into the private
// queue. Every decision (3) and every public or config change (4) is the
// organizer's, confirmed first.
//
// No I/O in here: the workflows and the CLI read and write files; these
// functions decide.

import {
  gate, validateSubmission, validateResult, upsertScore, pruneScores, advanceCheck, applyResult,
  buildDraw, MAX_PIN_ATTEMPTS, mdTable, tableRows, formatConfigMd, formatRosterMd, formatResultsMd,
} from './engine.js';
import { generateCode, hashToken, pinHash, isPin, isCode } from './identity.js';

// ---- inbox entries ------------------------------------------------------------

const FIELDS = [
  ['Kind', 'kind'], ['Team', 'team'], ['Match', 'match'], ['Score', 'score'],
  ['Token hash', 'tokenHash'], ['PIN hash', 'pinHash'], ['Note', 'note'],
  ['At', 'at'], ['Receipt', 'receipt'],
];

export function formatEntry(e) {
  const lines = FIELDS.filter(([, k]) => e[k] != null && e[k] !== '').map(([label, k]) => `- ${label}: ${e[k]}`);
  return `# Inbox entry\n\n${lines.join('\n')}\n`;
}

export function parseEntry(md) {
  const byLabel = new Map(FIELDS.map(([label, key]) => [label.toLowerCase(), key]));
  const out = {};
  for (const line of String(md || '').split('\n')) {
    const m = line.match(/^-\s*([^:]+):\s*(.*)$/);
    const key = m && byLabel.get(m[1].trim().toLowerCase());
    if (key) out[key] = m[2].trim();
  }
  return out;
}

// Sortable, unique, and self-describing, so a directory listing alone tells
// intake whether a code or a lockout is already pending.
export function entryName(e, rand) {
  const ts = e.at.replace(/[-:.]/g, '');
  return `inbox/${ts}-${rand}-${e.kind}-${e.team || 'x'}${e.match ? '-' + e.match : ''}.md`;
}

export function describeName(name) {
  const m = String(name).match(/^(?:inbox\/)?(\d{8}T\d{9}Z)-([a-z0-9]+)-([a-z-]+?)-([A-Z0-9]{4}|x)(?:-(r\d+-m\d+))?\.md$/);
  return m ? { ts: m[1], kind: m[3], team: m[4] === 'x' ? null : m[4], match: m[5] || null } : null;
}

// Wrong-PIN count: attempts.md, then the pending inbox in order. A pending
// attempt adds one; a pending clear (right PIN, unlock, re-PIN, reset) zeroes it.
export function attemptCount(fp, attempts, inboxNames) {
  let n = attempts.filter((a) => a.fp === fp).length;
  for (const name of [...inboxNames].sort()) {
    const d = describeName(name);
    if (d?.kind === 'org-reset') { n = 0; continue; }
    if (!d || d.team !== fp) continue;
    if (d.kind === 'attempt') n++;
    else if (['attempt-clear', 'org-unlock', 'org-repin'].includes(d.kind)) n = 0;
  }
  return n;
}

// ---- 1. intake ------------------------------------------------------------------

// ctx: { record, signups, scores, attempts, admitted, accepted, inboxNames, now, rand, receipt }
export async function decideIntake(kind, fields, ctx) {
  if (kind === 'signup') return intakeSignup(fields, ctx);
  if (kind === 'score') return intakeScore(fields, ctx);
  return reject(`Unknown submission kind "${kind}".`);
}

async function intakeSignup({ token, pin } = {}, ctx) {
  const g = gate('signup:intake', ctx.record.stage);
  if (!g.ok) return reject(g.error);
  if (typeof token !== 'string' || token.length < 20) return reject('Missing registration token.');
  if (!isPin(pin)) return reject('Your PIN must be exactly 4 digits.');
  const capacity = ctx.record.progress.capacity;
  if (ctx.admitted.length >= capacity) return reject('Registration is full.');

  const fp = await generateCode(token);
  const pendingNames = ctx.inboxNames.map(describeName).filter((d) => d?.kind === 'signup');
  if (ctx.signups.some((s) => s.fp === fp) || ctx.admitted.some((t) => t.fp === fp) || pendingNames.some((d) => d.team === fp)) {
    return reject('That team code is already registered. Generate a new team code and try again.');
  }
  const waiting = ctx.signups.filter((s) => !ctx.admitted.some((t) => t.fp === s.fp)).length + pendingNames.length;
  if (waiting >= capacity * 2) return reject('Too many registrations are waiting for the organizer. Try again later.');

  const e = { kind: 'signup', team: fp, tokenHash: await hashToken(token), pinHash: await pinHash(fp, pin), at: ctx.now, receipt: ctx.receipt };
  return { accepted: true, code: fp, message: `Registered ${fp}. The organizer reviews registrations and publishes the roster when registration closes.`, entries: [entry(e, ctx)] };
}

async function intakeScore({ code, pin, matchId, myScore, oppScore } = {}, ctx) {
  const g = gate('score:intake', ctx.record.stage);
  if (!g.ok) return reject(g.error);

  const fp = String(code || '').trim().toUpperCase();
  if (!isCode(fp) || !isPin(pin)) return reject('Enter your 4-character team code and 4-digit PIN.');
  const team = ctx.signups.find((s) => s.fp === fp);
  if (!team) return reject('No team is registered with that code.');

  const fails = attemptCount(fp, ctx.attempts, ctx.inboxNames);
  if (fails >= MAX_PIN_ATTEMPTS) return reject('This team is locked after too many wrong PINs. Ask the organizer to unlock it.');
  if (await pinHash(fp, String(pin)) !== team.pinHash) {
    const left = MAX_PIN_ATTEMPTS - fails - 1;
    return {
      accepted: false,
      message: left > 0 ? `Wrong PIN. ${left} attempt${left === 1 ? '' : 's'} left before this team is locked.` : 'Wrong PIN. This team is now locked — ask the organizer to unlock it.',
      entries: [entry({ kind: 'attempt', team: fp, at: ctx.now, receipt: ctx.receipt }, ctx)],
    };
  }

  if (!ctx.record.roster.some((t) => t.fp === fp)) return reject('Your team is not on the published roster.');
  const v = validateSubmission(ctx.record, fp, { matchId, myScore, oppScore }, ctx.accepted);
  if (!v.ok) return reject(v.error);

  const my = Number(myScore), opp = Number(oppScore);
  const entries = [entry({ kind: 'score', team: fp, match: matchId, score: `${my}-${opp}`, at: ctx.now, receipt: ctx.receipt }, ctx)];
  if (fails > 0) entries.unshift(entry({ kind: 'attempt-clear', team: fp, at: ctx.now, receipt: ctx.receipt }, { ...ctx, rand: ctx.rand + 'c' }));

  const opponentIn = ctx.scores.some((r) => r.matchId === matchId && r.reporterFp === v.opponent)
    || ctx.inboxNames.some((n) => { const d = describeName(n); return d?.kind === 'score' && d.team === v.opponent && d.match === matchId; });
  return {
    accepted: true,
    message: `Queued ${my}–${opp} for ${matchId}. ${opponentIn ? `${v.opponent} has submitted too — waiting for the organizer.` : `Waiting for ${v.opponent} to submit.`}`,
    entries,
  };
}

const reject = (message) => ({ accepted: false, message, entries: [] });
const entry = (e, ctx) => ({ name: entryName(e, ctx.rand), text: formatEntry(e) });

// ---- 2. batch -----------------------------------------------------------------------

// ctx: { record, signups, scores, attempts, admitted, accepted, now }
export function foldBatch(entries, ctx) {
  let signups = [...ctx.signups];
  let scores = [...ctx.scores];
  let attempts = [...ctx.attempts];
  const rejected = [];
  const applied = { signup: 0, score: 0, attempt: 0, organizer: 0 };
  const { record } = ctx;
  const admitted = ctx.admitted || [];
  const drop = (name, reason) => rejected.push({ at: ctx.now, entry: name.replace(/^inbox\//, ''), reason });

  for (const { name, text } of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const e = parseEntry(text);
    switch (e.kind) {
      case 'signup': {
        if (!gate('signup:intake', record.stage).ok) { drop(name, `registration closed before this was batched (stage ${record.stage})`); break; }
        if (signups.some((s) => s.fp === e.team) || admitted.some((t) => t.fp === e.team)) { drop(name, `${e.team} is already registered`); break; }
        const waiting = signups.filter((s) => !admitted.some((t) => t.fp === s.fp)).length;
        if (waiting >= record.progress.capacity * 2) { drop(name, 'too many registrations waiting'); break; }
        signups.push({ fp: e.team, tokenHash: e.tokenHash, pinHash: e.pinHash, submittedAt: e.at });
        applied.signup++;
        break;
      }
      case 'score': {
        if (!gate('score:intake', record.stage).ok) { drop(name, `scores closed before this was batched (stage ${record.stage})`); break; }
        if (!record.roster.some((t) => t.fp === e.team)) { drop(name, `${e.team} is not on the roster`); break; }
        const [myScore, oppScore] = String(e.score).split('-').map(Number);
        const v = validateSubmission(record, e.team, { matchId: e.match, myScore, oppScore }, ctx.accepted || []);
        if (!v.ok) { drop(name, v.error); break; }
        scores = upsertScore(scores, { matchId: e.match, reporterFp: e.team, myScore, oppScore, ts: e.at });
        applied.score++;
        break;
      }
      case 'attempt':
        attempts.push({ fp: e.team, at: e.at });
        applied.attempt++;
        break;
      case 'attempt-clear':
        attempts = attempts.filter((a) => a.fp !== e.team);
        break;
      case 'org-unlock':
        attempts = attempts.filter((a) => a.fp !== e.team);
        applied.organizer++;
        break;
      case 'org-repin': {
        const s = signups.find((x) => x.fp === e.team);
        if (!s) { drop(name, `no registration for ${e.team} to re-PIN`); break; }
        s.pinHash = e.pinHash;
        attempts = attempts.filter((a) => a.fp !== e.team);
        applied.organizer++;
        break;
      }
      case 'org-reject-signup': {
        const g = gate('signup:reject', record.stage);
        if (!g.ok) { drop(name, g.error); break; }
        if (admitted.some((t) => t.fp === e.team)) { drop(name, `${e.team} is admitted — \`unadmit\` it first`); break; }
        signups = signups.filter((s) => s.fp !== e.team);
        attempts = attempts.filter((a) => a.fp !== e.team);
        applied.organizer++;
        break;
      }
      case 'org-reject-score': {
        const g = gate('score:reject', record.stage);
        if (!g.ok) { drop(name, g.error); break; }
        scores = scores.filter((r) => !(r.matchId === e.match && (!e.team || r.reporterFp === e.team)));
        applied.organizer++;
        break;
      }
      case 'org-reset':
        signups = []; scores = []; attempts = [];
        applied.organizer++;
        break;
      default:
        drop(name, `unknown entry kind "${e.kind}"`);
    }
  }

  scores = pruneScores(scores, record);
  return { signups, scores, attempts, rejected, applied };
}

// ---- 4. publish: planning a stage change ------------------------------------------------

// ctx: { tournament, record, admitted, accepted, signups, inboxNames }
// opts: { seed, leavePending }
// Returns { ok, error } or { ok, plan: { action, summary[], results?, roster?, config, clearPrivate? }, fingerprint }.
// The CLI shows `summary` and the fingerprint and asks the organizer to
// confirm; the stage workflow re-plans and refuses unless it gets the same
// fingerprint. What is published is exactly what was confirmed.
export async function planTransition(action, ctx, opts = {}) {
  const { tournament: t, record, admitted, accepted } = ctx;
  const play = t.phases.find((p) => p.kind !== 'signup' && p.kind !== 'complete');
  const signupPhase = t.phases.find((p) => p.kind === 'signup');
  const donePhase = t.phases.find((p) => p.kind === 'complete');
  const fail = (error) => ({ ok: false, error });
  const summary = [];
  let plan;

  if (action === 'reset') {
    summary.push('Clear roster.md and results.md (public).', 'Remove the draw seed and round; reopen registration.', 'Clear the private queue and your admitted/accepted lists.');
    plan = { action, results: [], roster: [], config: { ...t, activePhase: signupPhase.id, drawSeed: null, round: null }, clearPrivate: true };
  } else {
    if (record.stage === 'invalid') return fail(gate(action === 'advance' ? 'round:advance' : 'draw', 'invalid').error);
    if (action === 'close') {
      const g = gate('phase:close', record.stage); if (!g.ok) return fail(g.error);
      if (!play) return fail('The phase table has no phase after registration.');
      const roster = sortTeams(admitted);
      summary.push(`Publish roster.md: ${roster.length} team(s)${roster.length ? ` — ${roster.map((x) => x.fp).join(' ')}` : ''}.`, `Close registration (phase → "${play.id}").`);
      plan = { action, roster, config: { ...t, activePhase: play.id } };
    } else if (action === 'reopen') {
      const g = gate('phase:reopen', record.stage); if (!g.ok) return fail(g.error);
      summary.push(`Reopen registration (phase → "${signupPhase.id}"). The published roster stays until the next close.`);
      plan = { action, config: { ...t, activePhase: signupPhase.id } };
    } else if (action === 'draw') {
      const g = gate('draw', record.stage); if (!g.ok) return fail(g.error);
      const roster = sortTeams(admitted);
      if (roster.length < 2) return fail(`Need at least 2 admitted teams to draw (have ${roster.length}).`);
      const pending = [...ctx.signups.filter((s) => !admitted.some((a) => a.fp === s.fp)).map((s) => s.fp),
        ...ctx.inboxNames.map(describeName).filter((d) => d?.kind === 'signup').map((d) => d.team)];
      if (pending.length && !opts.leavePending) return fail(`${pending.length} registration(s) are still waiting (${pending.join(' ')}). The draw freezes the roster — admit or reject them first, or draw with --leave-pending.`);
      if (!opts.seed) return fail('A draw needs a seed.');
      const state = buildDraw(roster.map((x) => x.fp), opts.seed);
      summary.push(`Publish roster.md: ${roster.length} team(s) — frozen from here on.`, `Draw with seed "${opts.seed}": ${state.rounds.map((r) => r.label).join(' → ')}.`);
      for (const m of state.rounds[0].matches) summary.push(`  ${m.id}: ${m.a || 'bye'} vs ${m.b || 'bye'}`);
      summary.push('Open round 1 for scores.');
      plan = { action, roster, config: { ...t, drawSeed: opts.seed, round: 1 } };
    } else if (action === 'advance') {
      const g = gate('round:advance', record.stage); if (!g.ok) return fail(g.error);
      const c = advanceCheck(record, accepted);
      if (!c.ok) return fail(c.error);
      // Validate the whole round as a sequence against a scratch copy.
      const scratch = JSON.parse(JSON.stringify(record.state));
      for (const r of c.rows) {
        const v = validateResult(scratch, r);
        if (!v.ok) return fail(`${r.matchId}: ${v.error}`);
        applyResult(scratch, r.matchId, r.winner);
      }
      const results = [...record.results, ...c.rows.map(({ sides, ...r }) => r)];
      const label = record.state.rounds[record.round - 1].label;
      summary.push(`Publish ${c.rows.length} result(s) for round ${record.round} (${label}) to results.md:`);
      for (const r of c.rows) summary.push(`  ${r.matchId}: ${r.winner} ${r.scoreWinner}-${r.scoreLoser}`);
      if (c.next === 'done') {
        summary.push(`Complete the tournament — 🏆 ${scratch.champion}.`);
        plan = { action, results, config: { ...t, round: 'done', activePhase: donePhase ? donePhase.id : t.activePhase } };
      } else {
        summary.push(`Open round ${c.next} (${record.state.rounds[c.next - 1].label}) for scores.`);
        plan = { action, results, config: { ...t, round: c.next } };
      }
    } else {
      return fail(`Unknown stage action "${action}".`);
    }
  }

  const fingerprint = (await hashToken([
    plan.action,
    plan.roster ? formatRosterMd(plan.roster) : '-',
    plan.results ? formatResultsMd(plan.results) : '-',
    formatConfigMd(plan.config),
  ].join('\n§\n'))).slice(0, 12);
  return { ok: true, plan: { ...plan, summary }, fingerprint };
}

const sortTeams = (teams) => [...teams].sort((a, b) => a.fp.localeCompare(b.fp))
  .map((x) => ({ fp: x.fp, tokenHash: x.tokenHash, registeredAt: x.registeredAt || null }));

// ---- rejected.md -----------------------------------------------------------------------

export function formatRejectedMd(rows) {
  return mdTable('Rejected at batch', 'Submissions valid at intake but not by the time they were batched, plus anything malformed. Newest last; the last 200 are kept.',
    ['When', 'Entry', 'Reason'], rows.slice(-200).map((r) => [r.at, r.entry, String(r.reason).replace(/\|/g, '/')]));
}

export function parseRejectedMd(md) {
  return tableRows(md).map(([at, name, reason]) => ({ at, entry: name, reason }));
}
