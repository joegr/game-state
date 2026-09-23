// game-state — the organizer control bar.
//
// On every page, revealed on a device where the organizer has set a PIN. It is
// the organizer's whole console. It shows everything they decide on, from the
// private tentative repo, and every control ACTS, with the organizer's own
// fine-grained token kept in this browser:
//
//   accept (private, reversible)  admit · un-admit · reject · confirm · decide ·
//                                 take back · clear submissions · unlock · new PIN
//     Decided by js/orgActions.js (the same decisions the CLI makes) and
//     written straight to the private repo, compare-and-swap.
//   stage change (public)         close · reopen · draw · advance · reset
//     The bar computes the exact plan and its fingerprint (js/pipeline.js →
//     planTransition), shows it, and publishes only when the organizer clicks
//     Confirm & publish. That dispatches stage.yml, which re-plans on GitHub
//     and refuses unless it gets the same fingerprint.
//
// Everything is read through api.github.com, so the bar sees the live record,
// not the few-minutes-cached copy the public pages read.

import { el, clear } from './util.js';
import { hashToken, randomPin, pinHash } from './identity.js';
import {
  gate, reconstruct, parseConfigMd, roundOpenMatches, computeQueue, advanceCheck, pruneScores, MAX_PIN_ATTEMPTS,
  parseSignupsMd, parseScoresMd, parseAttemptsMd, parseAdmittedMd, parseAcceptedMd,
} from './engine.js';
import { describeName, attemptCount, parseRejectedMd, planTransition, formatEntry, entryName } from './pipeline.js';
import {
  waitingSignups, decideAdmit, decideUnadmit, decideRejectSignup, decideConfirm, decideResult, decideUnconfirm,
  decideRejectScore, decideUnlock, decideRepin,
} from './orgActions.js';
import { client } from './github.js';

const PIN = 'game-state:admin:pin';
const TOKEN = 'game-state:admin:token';
const OLD_TOKEN = 'game-state:admin:read-token';
const UNLOCK = 'game-state:admin:unlocked';   // per tab
const OPEN = 'game-state:admin:bar-open';     // per tab
const store = (s) => ({
  get: (k) => { try { return s().getItem(k); } catch { return null; } },
  set: (k, v) => { try { s().setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { s().removeItem(k); } catch { /* private mode */ } },
});
const session = store(() => sessionStorage);
const local = store(() => localStorage);

let pageTournament = null;   // what the page loaded (for the repo names)
let bar = null;
let live = null;             // { tournament, record, queue } — read fresh through the API
let gh = null;
let notice = null;           // { kind: 'ok' | 'error' | 'busy', text, extra? } shown at the top
let pending = null;          // a stage-change plan waiting for confirmation

// Every page calls this. `#organizer` in any URL opens the bar directly.
export function mountOrganizer(t) {
  pageTournament = t;
  if (!local.get(TOKEN) && local.get(OLD_TOKEN)) { local.set(TOKEN, local.get(OLD_TOKEN)); local.del(OLD_TOKEN); }
  document.body.append(el('button', { class: 'organizer-trigger', onclick: () => (bar ? close() : open()), title: 'Organizer controls' }, '⚙ Organizer'));
  if (location.hash === '#organizer' || session.get(OPEN)) open();
  window.addEventListener('hashchange', () => { if (location.hash === '#organizer') open(); });
}

function open() {
  if (bar) return;
  bar = el('aside', { class: 'org-bar', role: 'complementary', 'aria-label': 'Organizer controls' });
  document.body.append(bar);
  document.body.classList.add('org-bar-open');
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => bar && bar.classList.add('open'));
  session.set(OPEN, '1');
  render();
}

function close() {
  if (!bar) return;
  document.removeEventListener('keydown', onKey);
  document.body.classList.remove('org-bar-open');
  bar.remove();
  bar = null;
  session.del(OPEN);
  if (location.hash === '#organizer') history.replaceState(null, '', location.pathname + location.search);
}

function onKey(e) { if (e.key === 'Escape') close(); }

function render() {
  if (!bar) return;
  const scroll = bar.scrollTop;
  clear(bar);
  bar.append(el('div', { class: 'row spread org-bar-head' },
    el('h2', {}, 'Organizer'),
    el('button', { class: 'btn ghost sm', onclick: close, title: 'Close (Esc)' }, 'Close')));
  const body = el('div', { class: 'org-bar-body' });
  bar.append(body);
  if (!local.get(PIN)) renderSetPin(body);
  else if (!session.get(UNLOCK)) renderUnlock(body);
  else if (!local.get(TOKEN)) renderTokenPrompt(body);
  else if (!live) { body.append(el('p', { class: 'muted sm' }, 'Loading the live record and the private queue…')); reload(); }
  else renderConsole(body);
  // A plan waiting for confirmation, or the outcome of an action, is shown at
  // the top: jump there so it is never rendered out of view.
  bar.scrollTop = pending || notice ? 0 : scroll;
}

// ---- the device toggle -------------------------------------------------------

function renderSetPin(body) {
  const p1 = el('input', { type: 'password', class: 'input', placeholder: 'choose a PIN', autocomplete: 'new-password' });
  const p2 = el('input', { type: 'password', class: 'input', placeholder: 'confirm PIN', autocomplete: 'new-password' });
  body.append(
    el('p', { class: 'muted sm' }, 'Set a PIN to mark this device as the organizer’s. It only reveals this bar in this browser. What the bar can change is decided by your GitHub token.'),
    p1, p2,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: async () => {
      if (p1.value.length < 4) return alert('Use at least 4 characters.');
      if (p1.value !== p2.value) return alert('PINs do not match.');
      local.set(PIN, await hashToken(p1.value));
      session.set(UNLOCK, '1');
      render();
    } }, 'Set PIN')));
}

function renderUnlock(body) {
  const pin = el('input', { type: 'password', class: 'input', placeholder: 'PIN', autocomplete: 'current-password' });
  const go = async () => {
    if (await hashToken(pin.value) !== local.get(PIN)) return alert('Wrong PIN.');
    session.set(UNLOCK, '1');
    render();
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  body.append(
    el('p', { class: 'muted sm' }, 'Enter your organizer PIN.'),
    pin,
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: go }, 'Unlock'),
      el('button', { class: 'btn ghost', onclick: () => {
        if (!confirm('Remove the organizer PIN and token from this device?')) return;
        local.del(PIN); local.del(TOKEN); render();
      } }, 'Reset')));
  pin.focus();
}

function renderTokenPrompt(body, message) {
  const t = pageTournament;
  const input = el('input', { type: 'password', class: 'input', placeholder: 'github_pat_…', autocomplete: 'off' });
  const save = () => { if (!input.value.trim()) return; local.set(TOKEN, input.value.trim()); live = null; render(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  body.append(el('div', { class: 'card' },
    el('h3', {}, 'Connect your organizer token'),
    el('p', { class: 'muted sm' }, 'A fine-grained token, kept only in this browser:'),
    el('ul', { class: 'sm' },
      el('li', {}, el('code', {}, t.tentativeRepo || 'the tentative repo'), ' — Contents: read & write, Actions: read & write'),
      el('li', {}, el('code', {}, t.appRepo), ' — Actions: read & write')),
    el('p', { class: 'muted sm' }, 'Accepting writes the private queue; a stage change starts the publish workflow after you confirm its plan.'),
    message ? el('p', { class: 'sm danger' }, message) : null,
    input,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: save }, 'Connect'))));
}

// ---- reading everything, fresh -----------------------------------------------------

let loading = null;
function reload() {
  if (!loading) loading = load().finally(() => { loading = null; });
  return loading;
}

async function load() {
  gh = client(local.get(TOKEN));
  const t0 = pageTournament;
  try {
    const cfg = await gh.read(t0.appRepo, 'config/tournament.md');
    const tournament = cfg.text ? parseConfigMd(cfg.text) : t0;
    const tr = tournament.tentativeRepo;
    const [roster, results] = await Promise.all([gh.read(tournament.rosterRepo, 'roster.md'), gh.read(tournament.rosterRepo, 'results.md')]);
    const record = reconstruct(tournament, roster.text, results.text);
    let queue = null;
    if (tr) {
      const [signups, scores, attempts, admitted, accepted, rejected, inboxNames] = await Promise.all([
        gh.read(tr, 'signups.md'), gh.read(tr, 'scores.md'), gh.read(tr, 'attempts.md'), gh.read(tr, 'admitted.md'),
        gh.read(tr, 'accepted.md'), gh.read(tr, 'rejected.md'), gh.list(tr, 'inbox'),
      ]);
      queue = {
        signups: parseSignupsMd(signups.text), scores: parseScoresMd(scores.text), attempts: parseAttemptsMd(attempts.text),
        admitted: parseAdmittedMd(admitted.text), admittedSha: admitted.sha,
        accepted: parseAcceptedMd(accepted.text), acceptedSha: accepted.sha,
        rejected: parseRejectedMd(rejected.text), inboxNames,
      };
    }
    live = { tournament, record, queue };
  } catch (e) {
    live = null;
    if (e.status === 401) { local.del(TOKEN); notice = null; clear(bar.querySelector('.org-bar-body')); return renderTokenPrompt(bar.querySelector('.org-bar-body'), e.message); }
    notice = { kind: 'error', text: `Could not read GitHub: ${e.message}` };
    const body = bar?.querySelector('.org-bar-body');
    if (body) { clear(body); renderNotice(body); body.append(el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => render() }, 'Try again'), el('button', { class: 'btn ghost', onclick: forgetToken }, 'Change token'))); }
    return;
  }
  render();
}

function forgetToken() {
  if (!confirm('Forget the organizer token on this device?')) return;
  local.del(TOKEN); live = null; notice = null; render();
}

// ---- carrying out a decision --------------------------------------------------------

async function run(label, fn) {
  notice = { kind: 'busy', text: `${label}…` };
  render();
  try {
    const out = await fn();
    if (out) notice = out;
  } catch (e) {
    notice = { kind: 'error', text: e.message };
  }
  live = null;           // re-read everything, so the bar shows what GitHub now holds
  render();
}

// Carry out a private decision from js/orgActions.js.
function act(label, decide) {
  return run(label, async () => {
    const d = await decide();
    if (!d.ok) return { kind: 'error', text: d.error };
    const tr = live.tournament.tentativeRepo;
    if (d.write) await gh.write(tr, d.write.path, d.write.content, d.write.message, d.write.sha);
    if (d.entry) {
      const full = { ...d.entry, at: new Date().toISOString() };
      await gh.create(tr, entryName(full, Math.random().toString(36).slice(2, 10) || 'r'), formatEntry(full), `organizer: ${d.entry.kind} ${d.entry.team || d.entry.match || ''}`.trim());
    }
    let text = d.message;
    if (d.batch) {
      try { await gh.dispatch(tr, 'batch.yml', {}); text += ' A batch is running now.'; }
      catch (e) { text += ` (Could not start a batch: ${e.message} It runs hourly anyway.)`; }
    }
    return { kind: 'ok', text, extra: d.extra };
  });
}

function btn(label, onclick, cls = 'btn sm') {
  return el('button', { class: cls, onclick: (e) => { e.target.disabled = true; onclick(e); } }, label);
}

function renderNotice(body) {
  if (!notice) return;
  body.append(el('div', { class: `card notice ${notice.kind}` },
    el('p', { class: 'sm' }, notice.kind === 'busy' ? '⏳ ' : notice.kind === 'error' ? '✖ ' : '✓ ', notice.text),
    notice.extra || null,
    notice.kind === 'busy' ? null : el('button', { class: 'btn ghost sm', onclick: () => { notice = null; render(); } }, 'Dismiss')));
}

// ---- the console --------------------------------------------------------------

function renderConsole(body) {
  const { tournament, record, queue: q } = live;
  const stageLine = record.stage === 'round' ? `Round ${record.round} · ${record.state.rounds[record.round - 1].label}` : record.stage;
  renderNotice(body);
  body.append(el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {}, el('div', { class: 'muted sm' }, tournament.name), el('h3', {}, `Stage: ${stageLine}`)),
      el('span', { class: 'badge ' + (record.stage === 'invalid' ? 'danger' : record.stage === 'complete' ? 'gold' : 'good') }, record.stage.toUpperCase())),
    el('p', { class: 'muted sm' }, `Live: ${record.roster.length} team(s) on the roster · ${record.results.length} result(s)${tournament.drawSeed ? ` · seed ${tournament.drawSeed}` : ''}`),
    el('div', { class: 'row' },
      btn('Reload', () => { live = null; render(); }, 'btn ghost sm'),
      el('a', { class: 'btn ghost sm', href: 'bracket.html' }, 'Bracket'),
      el('a', { class: 'btn ghost sm', href: 'index.html' }, 'Register'),
      el('a', { class: 'btn ghost sm', href: 'captain.html' }, 'Captain'))));

  if (record.errors.length) {
    body.append(el('div', { class: 'card danger' },
      el('h3', {}, 'The published record is inconsistent'),
      el('p', { class: 'sm' }, 'Every intake, acceptance and stage change is refused until it is fixed, or you reset:'),
      ...record.errors.map((e) => el('p', { class: 'sm mono' }, '✖ ' + e))));
  }

  if (pending) { renderPlan(body); return; }

  body.append(el('p', { class: 'muted sm banner' },
    'Accepting is private and reversible. A stage change publishes: it shows you the exact plan first and waits for you to confirm it.'));

  if (!tournament.tentativeRepo) body.append(el('div', { class: 'card' }, el('p', { class: 'muted sm' }, 'No "Tentative repo" in config/tournament.md yet.')));
  else if (q) renderQueues(body, q);
  body.append(stageCard(q));
  body.append(el('div', { class: 'row' }, btn('Change token', forgetToken, 'btn ghost sm')));
}

// ---- the queues: teams and scores, same road ---------------------------------------

function renderQueues(body, q) {
  const { record } = live;
  const ctx = { record, queue: q };

  // Registrations.
  const waiting = waitingSignups(q);
  const pendingIntake = q.inboxNames.map(describeName).filter((d) => d?.kind === 'signup');
  const canAdmit = gate('signup:admit', record.stage).ok;
  const teams = el('div', { class: 'card' }, el('h3', {}, `Teams · ${waiting.length} waiting · ${q.admitted.length} admitted`));
  if (!canAdmit) teams.append(el('p', { class: 'muted sm' }, gate('signup:admit', record.stage).error));
  for (const s of waiting) {
    teams.append(el('div', { class: 'match' },
      el('div', { class: 'row spread' },
        el('code', { class: 'mono' }, s.fp),
        el('span', { class: 'muted sm' }, `waiting since ${new Date(s.submittedAt).toLocaleString()}`)),
      canAdmit ? el('div', { class: 'row' },
        btn('Admit', () => act(`Admitting ${s.fp}`, () => decideAdmit(ctx, [s.fp]))),
        btn('Reject', () => { if (confirm(`Reject ${s.fp}'s registration?`)) act(`Rejecting ${s.fp}`, () => decideRejectSignup(ctx, s.fp)); else render(); }, 'btn ghost sm')) : null));
  }
  if (canAdmit && waiting.length > 1) teams.append(el('div', { class: 'row' }, btn(`Admit all ${waiting.length}`, () => act('Admitting everyone waiting', () => decideAdmit(ctx, 'all')))));
  if (q.admitted.length) {
    teams.append(el('h4', {}, 'Admitted'),
      el('div', { class: 'row' }, q.admitted.map((a) => el('code', { class: 'mono chip' + (record.roster.some((t) => t.fp === a.fp) ? '' : ' unpublished') }, a.fp))),
      el('p', { class: 'muted sm' }, record.roster.length === q.admitted.length && q.admitted.every((a) => record.roster.some((t) => t.fp === a.fp)) ? 'All published.' : 'Dashed = admitted, not yet published. Published at close and at the draw.'));
    if (canAdmit) teams.append(el('details', {}, el('summary', { class: 'muted sm' }, 'Un-admit a team'),
      el('div', { class: 'row' }, q.admitted.map((a) => btn(a.fp, () => act(`Un-admitting ${a.fp}`, () => decideUnadmit(ctx, a.fp)), 'btn ghost sm')))));
  }
  if (pendingIntake.length) teams.append(el('p', { class: 'muted sm' }, `${pendingIntake.length} more registration(s) in the inbox, not batched yet.`));
  body.append(teams);

  // Scores.
  if (record.stage === 'round') {
    const open = [...roundOpenMatches(record)];
    const reports = pruneScores(q.scores, record);
    const cq = computeQueue(record.state, reports);
    const claim = (id, fp) => reports.find((r) => r.matchId === id && r.reporterFp === fp);
    const card = el('div', { class: 'card' }, el('h3', {}, `Scores · round ${record.round} · ${open.length} match(es)`));
    let agreedCount = 0;
    for (const [id, s] of open) {
      const acc = q.accepted.find((r) => r.matchId === id);
      const v = cq[id];
      const status = acc ? 'accepted' : v ? v.status : 'waiting';
      if (status === 'agreed') agreedCount++;
      const row = el('div', { class: 'match accept' },
        el('div', { class: 'row spread' },
          el('strong', { class: 'mono' }, id),
          el('span', { class: 'badge ' + ({ accepted: 'good', agreed: 'good', disputed: 'danger', tie: 'danger' }[status] || 'upcoming') },
            { accepted: 'ACCEPTED', agreed: 'AGREED', disputed: 'DISPUTED', tie: 'TIE CLAIMED', awaiting: 'ONE IN', waiting: 'NONE IN' }[status])),
        el('div', { class: 'claims' }, claimCell(s.a, claim(id, s.a)), claimCell(s.b, claim(id, s.b))));
      if (acc) {
        row.append(el('p', { class: 'sm' }, `Accepted: ${acc.winner} ${acc.scoreWinner}–${acc.scoreLoser}`),
          el('div', { class: 'row' }, btn('Take it back', () => act(`Taking back ${id}`, () => decideUnconfirm(ctx, id)), 'btn ghost sm')));
      } else if (status === 'agreed') {
        row.append(el('div', { class: 'row' }, btn(`Accept: ${v.winner} ${Math.max(v.scoreA, v.scoreB)}–${Math.min(v.scoreA, v.scoreB)}`, () => act(`Accepting ${id}`, () => decideConfirm(ctx, [id])))));
      } else if (status === 'disputed' || status === 'tie') {
        row.append(
          el('div', { class: 'row' }, btn('Clear both so they resubmit', () => act(`Clearing ${id}`, () => decideRejectScore(ctx, id)), 'btn ghost sm')),
          decideForm(ctx, id, s, 'Or decide it yourself'));
      } else {
        row.append(decideForm(ctx, id, s, 'Decide it yourself (no-show, walkover)'));
      }
      card.append(row);
    }
    if (agreedCount > 1) card.append(el('div', { class: 'row' }, btn(`Accept all ${agreedCount} agreed`, () => act('Accepting every agreed result', () => decideConfirm(ctx, 'all')))));
    const pendingScores = q.inboxNames.map(describeName).filter((d) => d?.kind === 'score').length;
    if (pendingScores) card.append(el('p', { class: 'muted sm' }, `${pendingScores} more score(s) in the inbox, not batched yet.`));
    body.append(card);
  }

  // PINs.
  const locked = [...new Set(q.signups.map((s) => s.fp))].filter((fp) => attemptCount(fp, q.attempts, q.inboxNames) >= MAX_PIN_ATTEMPTS);
  const struggling = [...new Set(q.attempts.map((a) => a.fp))].filter((fp) => !locked.includes(fp));
  const pins = el('div', { class: 'card' }, el('h3', {}, 'PINs'));
  for (const fp of locked) pins.append(el('div', { class: 'match' },
    el('p', { class: 'sm' }, el('code', { class: 'mono' }, fp), ` is locked after ${MAX_PIN_ATTEMPTS} wrong PINs.`),
    el('div', { class: 'row' }, btn('Unlock', () => act(`Unlocking ${fp}`, () => decideUnlock(ctx, fp))))));
  for (const fp of struggling) pins.append(el('p', { class: 'muted sm' }, `${fp}: ${attemptCount(fp, q.attempts, q.inboxNames)} wrong PIN(s) so far.`));
  const teamCodes = [...new Set(q.signups.map((s) => s.fp))];
  if (teamCodes.length) {
    pins.append(el('details', {}, el('summary', { class: 'muted sm' }, 'Issue a new PIN (a captain lost theirs)'),
      el('p', { class: 'muted sm' }, 'The new PIN is shown here once. Give it to that captain privately; the old one stops working at the next batch.'),
      el('div', { class: 'row' }, teamCodes.map((fp) => btn(fp, () => {
        if (!confirm(`Issue a new PIN for ${fp}? Their current PIN stops working.`)) return render();
        const pin = randomPin();
        act(`Issuing a new PIN for ${fp}`, async () => {
          const d = decideRepin(ctx, fp, await pinHash(fp, pin));
          return d.ok ? { ...d, extra: el('p', {}, 'New PIN for ', el('code', { class: 'mono' }, fp), ': ', el('strong', { class: 'mono big' }, pin), el('br', {}), el('span', { class: 'muted sm' }, 'Shown once — write it down now.')) } : d;
        });
      }, 'btn ghost sm')))));
  } else pins.append(el('p', { class: 'muted sm' }, 'No registrations yet.'));
  body.append(pins);

  // Pipeline health.
  const health = el('div', { class: 'card' }, el('h3', {}, 'Pipeline'),
    el('p', { class: 'muted sm' }, q.inboxNames.length ? `${q.inboxNames.length} submission(s) waiting in the inbox for the next batch.` : 'Inbox empty — everything has been batched.'),
    el('div', { class: 'row' }, btn('Batch now', () => run('Starting a batch', async () => {
      await gh.dispatch(live.tournament.tentativeRepo, 'batch.yml', {});
      return { kind: 'ok', text: 'Batch started. It takes about half a minute; Reload to see the result.' };
    }), 'btn ghost sm')));
  if (q.rejected.length) {
    health.append(el('details', {}, el('summary', { class: 'muted sm' }, `Rejected at batch (${q.rejected.length})`),
      ...q.rejected.slice(-10).reverse().map((r) => el('p', { class: 'sm' }, el('span', { class: 'mono' }, r.entry), el('br', {}), el('span', { class: 'muted' }, r.reason)))));
  }
  body.append(health);
}

function claimCell(fp, c) {
  return el('div', { class: 'claim' },
    el('code', { class: 'mono' }, fp),
    c ? el('div', {}, el('strong', {}, `${c.myScore}–${c.oppScore}`), el('div', { class: 'muted sm' }, 'own score first'))
      : el('div', { class: 'muted sm' }, 'not submitted'));
}

function decideForm(ctx, id, s, summary) {
  const winner = el('select', { class: 'input' }, el('option', { value: s.a }, `${s.a} wins`), el('option', { value: s.b }, `${s.b} wins`));
  const sw = el('input', { class: 'input', type: 'number', min: '0', value: '1', 'aria-label': 'winner score' });
  const sl = el('input', { class: 'input', type: 'number', min: '0', value: '0', 'aria-label': 'loser score' });
  return el('details', {}, el('summary', { class: 'muted sm' }, summary),
    el('div', { class: 'row' }, winner, sw, el('span', {}, '–'), sl),
    el('div', { class: 'row' }, btn('Decide', () => act(`Deciding ${id}`, () => decideResult(ctx, id, winner.value, sw.value, sl.value)))));
}

// ---- stage changes: plan → your confirmation → stage.yml ------------------------------------

function stageCard(q) {
  const { record } = live;
  const card = el('div', { class: 'card stage-card' }, el('h3', {}, 'Stage changes'),
    el('p', { class: 'muted sm' }, 'Each shows you the exact plan first. Nothing is published until you confirm it.'));
  const row = (action, gateName, label, detail, opts) => {
    const g = gate(gateName, record.stage);
    card.append(el('div', { class: 'step' },
      el('div', { class: 'row spread' }, el('strong', {}, label), el('span', { class: 'muted sm' }, g.ok ? (detail || '') : 'not now')),
      g.ok ? el('div', { class: 'row' }, btn(`Plan: ${label.toLowerCase()}`, () => plan(action, opts), 'btn sm')) : el('p', { class: 'muted sm' }, g.error)));
  };
  row('close', 'phase:close', 'Close registration', q ? `publishes ${q.admitted.length} admitted team(s)` : '');
  row('reopen', 'phase:reopen', 'Reopen registration');
  const stillWaiting = q ? waitingSignups(q).length : 0;
  row('draw', 'draw', 'Draw', q ? `${q.admitted.length} team(s)${stillWaiting ? ` · ${stillWaiting} still waiting` : ''}` : '', stillWaiting ? { askLeavePending: stillWaiting } : undefined);
  if (record.stage === 'round' && q) {
    const c = advanceCheck(record, q.accepted);
    card.append(el('div', { class: 'step' },
      el('div', { class: 'row spread' }, el('strong', {}, `Advance round ${record.round}`), el('span', { class: 'muted sm' }, c.ok ? 'ready' : 'not yet')),
      c.ok ? el('div', { class: 'row' }, btn(c.next === 'done' ? 'Plan: publish the final' : `Plan: publish round ${record.round}`, () => plan('advance'), 'btn sm'))
        : el('p', { class: 'muted sm' }, c.error)));
  } else row('advance', 'round:advance', 'Advance round');
  card.append(el('details', {},
    el('summary', { class: 'muted sm' }, 'Start over'),
    el('p', { class: 'muted sm' }, 'Reset clears the public roster and results, the draw, and the private queue. It shows its plan first.'),
    el('div', { class: 'row' }, btn('Plan: reset', () => plan('reset'), 'btn ghost sm danger'))));
  return card;
}

async function plan(action, opts = {}) {
  let leavePending = false;
  if (opts.askLeavePending) {
    if (!confirm(`${opts.askLeavePending} registration(s) are still waiting. The draw freezes the roster and they would be left out. Draw anyway?`)) return render();
    leavePending = true;
  }
  const { tournament, record, queue: q } = live;
  if (!q && action !== 'reset') { notice = { kind: 'error', text: 'The private queue could not be read.' }; return render(); }
  const seed = action === 'draw' ? `${tournament.name}:${Date.now()}` : undefined;
  const p = await planTransition(action, {
    tournament, record, admitted: q?.admitted || [], accepted: q?.accepted || [], signups: q?.signups || [], inboxNames: q?.inboxNames || [],
  }, { seed, leavePending });
  if (!p.ok) { notice = { kind: 'error', text: p.error }; return render(); }
  pending = { action, seed, leavePending, ...p };
  notice = null;
  render();
}

function renderPlan(body) {
  const p = pending;
  body.append(el('div', { class: 'card plan' },
    el('div', { class: 'muted sm' }, 'Stage change — review the plan'),
    el('h3', {}, `${p.action} · plan ${p.fingerprint}`),
    el('pre', { class: 'blob' }, p.plan.summary.join('\n')),
    el('p', { class: 'muted sm' }, 'Confirming starts the publish workflow on GitHub. It re-plans from the live files and publishes only if it gets this same plan; if anything changed meanwhile, it refuses and nothing is written.'),
    el('div', { class: 'row' },
      btn(`Confirm & publish ${p.fingerprint}`, () => publishPlan(), `btn${p.action === 'reset' ? ' danger' : ''}`),
      btn('Cancel', () => { pending = null; render(); }, 'btn ghost'))));
}

function publishPlan() {
  const p = pending;
  pending = null;
  const appRepo = live.tournament.appRepo;
  const status = (text) => { notice = { kind: 'busy', text: `${p.action} ${p.fingerprint}: ${text}` }; render(); };
  run(`Starting ${p.action} (${p.fingerprint})`, async () => {
    const inputs = { action: p.action, expect: p.fingerprint, leave_pending: String(!!p.leavePending) };
    if (p.seed) inputs.seed = p.seed;
    await gh.dispatch(appRepo, 'stage.yml', inputs);
    const out = await gh.follow(appRepo, 'stage.yml', `stage ${p.action} (${p.fingerprint})`, status);
    const link = out.url ? el('p', { class: 'sm' }, el('a', { href: out.url, target: '_blank', rel: 'noopener' }, 'The run on GitHub')) : null;
    if (out.timeout) return { kind: 'error', text: 'The publish workflow has not finished yet. Check the run, then Reload.', extra: link };
    if (out.verdict?.startsWith('PUBLISHED')) {
      // A reset clears the private queue through an inbox entry, and the
      // publish workflow can't start a batch. Start it from here so the queue
      // is empty now, not at the hourly run.
      if (p.plan.clearPrivate) await gh.dispatch(live.tournament.tentativeRepo, 'batch.yml', {}).catch(() => {});
      return { kind: 'ok', text: `${out.verdict.replace(/^PUBLISHED: /, 'Published ').replace(/[.:]+$/, '')}. The public pages update within a few minutes (the site redeploys, and GitHub caches the roster files briefly).`, extra: link };
    }
    if (out.verdict) return { kind: 'error', text: out.verdict.replace(/^REFUSED: /, 'Refused: '), extra: link };
    return { kind: 'error', text: `The publish workflow ${out.run?.conclusion || 'failed'} without a verdict — open the run for details.`, extra: link };
  });
}
