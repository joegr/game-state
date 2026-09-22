// game-state — the organizer control bar.
//
// On every page, revealed on a device where the organizer has set a PIN. It
// shows everything the organizer decides on, from the private tentative repo
// (read with the organizer's OWN read-only token, kept on this device):
// registrations to admit, scores side by side to accept, locked teams, the
// batch inbox, and what the batch rejected. Alongside each is the exact
// command that acts on it, gated by the same stage table the workflows use.
//
// IT CANNOT CHANGE ANYTHING. Accepting is a CLI command (private, reversible);
// a stage change is a CLI command that shows its plan and waits for the
// organizer to confirm it before a workflow publishes it. Every button here
// copies one of those commands.

import { el, clear, copy } from './util.js';
import { hashToken } from './identity.js';
import {
  gate, roundOpenMatches, computeQueue, advanceCheck, pruneScores, MAX_PIN_ATTEMPTS,
  parseSignupsMd, parseScoresMd, parseAttemptsMd, parseAdmittedMd, parseAcceptedMd,
} from './engine.js';
import { describeName, attemptCount, parseRejectedMd } from './pipeline.js';
import { loadTournamentState } from './config.js';

const PIN = 'game-state:admin:pin';
const READ_TOKEN = 'game-state:admin:read-token';
const UNLOCK = 'game-state:admin:unlocked';   // per tab
const OPEN = 'game-state:admin:bar-open';     // per tab
const store = (s) => ({
  get: (k) => { try { return s().getItem(k); } catch { return null; } },
  set: (k, v) => { try { s().setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { s().removeItem(k); } catch { /* private mode */ } },
});
const session = store(() => sessionStorage);
const local = store(() => localStorage);
const CLI = 'node tools/advance.mjs';

let tournament = null;
let record = null;
let bar = null;

// Every page calls this. `#organizer` in any URL opens the bar directly.
export function mountOrganizer(t, r) {
  tournament = t;
  record = r;
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
  clear(bar);
  bar.append(el('div', { class: 'row spread org-bar-head' },
    el('h2', {}, 'Organizer'),
    el('button', { class: 'btn ghost sm', onclick: close, title: 'Close (Esc)' }, 'Close')));
  const body = el('div', { class: 'org-bar-body' });
  bar.append(body);
  if (!local.get(PIN)) renderSetPin(body);
  else if (!session.get(UNLOCK)) renderUnlock(body);
  else renderConsole(body);
}

// ---- the device toggle -------------------------------------------------------

function renderSetPin(body) {
  const p1 = el('input', { type: 'password', class: 'input', placeholder: 'choose a PIN', autocomplete: 'new-password' });
  const p2 = el('input', { type: 'password', class: 'input', placeholder: 'confirm PIN', autocomplete: 'new-password' });
  body.append(
    el('p', { class: 'muted sm' }, 'Set a PIN to mark this device as the organizer’s. It only reveals this bar in this browser — it is not a credential. Changing the tournament always takes ', el('code', {}, 'gh'), ' and your confirmation.'),
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
        if (!confirm('Remove the organizer PIN and read token from this device?')) return;
        local.del(PIN); local.del(READ_TOKEN); render();
      } }, 'Reset')));
  pin.focus();
}

// ---- reading the private repo -----------------------------------------------------

async function readPrivate(token) {
  const repo = tournament.tentativeRepo;
  const h = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const file = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers: { ...h, Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
    if (res.status === 404) return '';
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('The read token was refused.'), { auth: true });
    if (!res.ok) throw new Error(`Reading ${path} failed (${res.status}).`);
    return res.text();
  };
  const inbox = async () => {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/inbox`, { headers: { ...h, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Listing inbox failed (${res.status}).`);
    return (await res.json()).filter((f) => f.type === 'file').map((f) => `inbox/${f.name}`).sort();
  };
  const [signups, scores, attempts, admitted, accepted, rejected, inboxNames] = await Promise.all([
    file('signups.md'), file('scores.md'), file('attempts.md'), file('admitted.md'), file('accepted.md'), file('rejected.md'), inbox(),
  ]);
  return {
    signups: parseSignupsMd(signups), scores: parseScoresMd(scores), attempts: parseAttemptsMd(attempts),
    admitted: parseAdmittedMd(admitted), accepted: parseAcceptedMd(accepted), rejected: parseRejectedMd(rejected), inboxNames,
  };
}

// ---- the console --------------------------------------------------------------

async function renderConsole(body) {
  const stageLine = record.stage === 'round' ? `Round ${record.round} · ${record.state.rounds[record.round - 1].label}` : record.stage;
  const header = el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {}, el('div', { class: 'muted sm' }, tournament.name), el('h3', {}, `Stage: ${stageLine}`)),
      el('span', { class: 'badge ' + (record.stage === 'invalid' ? 'danger' : record.stage === 'complete' ? 'gold' : 'good') }, record.stage.toUpperCase())),
    el('p', { class: 'muted sm' }, `Public: ${record.roster.length} team(s) on the roster · ${record.results.length} result(s)${tournament.drawSeed ? ` · seed ${tournament.drawSeed}` : ''}`),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost sm', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Refreshing…';
        record = await loadTournamentState(tournament);
        render();
      } }, 'Refresh'),
      el('a', { class: 'btn ghost sm', href: 'bracket.html' }, 'Bracket'),
      el('a', { class: 'btn ghost sm', href: 'index.html' }, 'Register'),
      el('a', { class: 'btn ghost sm', href: 'captain.html' }, 'Captain')));
  body.append(header);

  if (record.errors.length) {
    body.append(el('div', { class: 'card danger' },
      el('h3', {}, 'The published record is inconsistent'),
      el('p', { class: 'sm' }, 'Every intake, acceptance and stage change is refused until this is fixed:'),
      ...record.errors.map((e) => el('p', { class: 'sm mono' }, '✖ ' + e)),
      cmdRow('See the full check', `${CLI} check`),
      cmdRow('Or start over (shows its plan first)', `${CLI} reset`)));
  }

  body.append(el('p', { class: 'muted sm banner' },
    'Accepting is private and reversible. A stage change publishes — its command shows you the exact plan and waits for your confirmation first. The buttons copy commands; nothing here writes.'));

  const slot = el('div', {});
  body.append(slot);
  renderStage(body, null);
  const token = local.get(READ_TOKEN);
  if (!tournament.tentativeRepo) {
    slot.append(el('div', { class: 'card' }, el('p', { class: 'muted sm' }, 'No "Tentative repo" in config/tournament.md yet.')));
    return;
  }
  if (!token) return renderTokenPrompt(slot);
  slot.append(el('div', { class: 'card' }, el('p', { class: 'muted sm' }, 'Loading the private queue…')));
  try {
    const q = await readPrivate(token);
    clear(slot);
    renderQueues(slot, q);
    // Re-render the stage card now that we know the private side.
    body.querySelector('.stage-card')?.replaceWith(stageCard(q));
  } catch (e) {
    clear(slot);
    if (e.auth) { local.del(READ_TOKEN); return renderTokenPrompt(slot, e.message); }
    slot.append(el('div', { class: 'card danger' }, el('p', { class: 'sm' }, e.message)));
  }
}

function renderTokenPrompt(slot, message) {
  const input = el('input', { type: 'password', class: 'input', placeholder: 'github_pat_…', autocomplete: 'off' });
  const save = () => { if (!input.value.trim()) return; local.set(READ_TOKEN, input.value.trim()); render(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  slot.append(el('div', { class: 'card' },
    el('h3', {}, 'Connect the private queue'),
    el('p', { class: 'muted sm' }, `Paste a fine-grained token with read-only Contents access to ${tournament.tentativeRepo}. It stays in this browser and can only read the queue.`),
    message ? el('p', { class: 'sm danger' }, message) : null,
    input,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: save }, 'Connect'))));
}

// ---- the queues: teams and scores, same road ---------------------------------------

function renderQueues(slot, q) {
  // Registrations.
  const waiting = q.signups.filter((s) => !q.admitted.some((a) => a.fp === s.fp));
  const pendingIntake = q.inboxNames.map(describeName).filter((d) => d?.kind === 'signup');
  const canAdmit = gate('signup:admit', record.stage).ok;
  const teams = el('div', { class: 'card' },
    el('h3', {}, `Teams · ${waiting.length} waiting · ${q.admitted.length} admitted`));
  if (!canAdmit) teams.append(el('p', { class: 'muted sm' }, gate('signup:admit', record.stage).error));
  for (const s of waiting) {
    teams.append(el('div', { class: 'match' },
      el('div', { class: 'row spread' }, el('code', { class: 'mono' }, s.fp), el('span', { class: 'muted sm' }, 'waiting')),
      canAdmit ? cmdRow('Admit', `${CLI} admit ${s.fp}`) : null,
      canAdmit ? cmdRow('Reject', `${CLI} reject-signup ${s.fp}`) : null));
  }
  if (canAdmit && waiting.length > 1) teams.append(cmdRow(`Admit all ${waiting.length}`, `${CLI} admit --all`));
  if (q.admitted.length) {
    teams.append(el('h4', {}, 'Admitted'),
      el('div', { class: 'row' }, q.admitted.map((a) => el('code', { class: 'mono chip' + (record.roster.some((t) => t.fp === a.fp) ? '' : ' unpublished') }, a.fp))),
      el('p', { class: 'muted sm' }, record.roster.length === q.admitted.length ? 'All published.' : 'Dashed = admitted, not yet published. Published at close and at the draw.'));
    if (canAdmit) teams.append(el('details', {}, el('summary', { class: 'muted sm' }, 'Un-admit a team'),
      ...q.admitted.map((a) => cmdRow(a.fp, `${CLI} unadmit ${a.fp}`))));
  }
  if (pendingIntake.length) teams.append(el('p', { class: 'muted sm' }, `${pendingIntake.length} more registration(s) in the inbox, not batched yet.`));
  slot.append(teams);

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
        row.append(el('p', { class: 'sm' }, `Accepted: ${acc.winner} ${acc.scoreWinner}–${acc.scoreLoser}`), cmdRow('Take it back', `${CLI} unconfirm ${id}`));
      } else if (status === 'agreed') {
        row.append(cmdRow(`Accept: ${v.winner} ${Math.max(v.scoreA, v.scoreB)}–${Math.min(v.scoreA, v.scoreB)}`, `${CLI} confirm ${id}`));
      } else if (status === 'disputed' || status === 'tie') {
        row.append(
          cmdRow('Clear both submissions so they resubmit', `${CLI} reject-score ${id}`),
          el('details', {}, el('summary', { class: 'muted sm' }, 'Or decide it yourself'),
            cmdRow(`${s.a} wins`, `${CLI} result ${id} ${s.a} <scoreW> <scoreL>`),
            cmdRow(`${s.b} wins`, `${CLI} result ${id} ${s.b} <scoreW> <scoreL>`)));
      } else {
        row.append(el('details', {}, el('summary', { class: 'muted sm' }, 'No-show? Award a walkover'),
          cmdRow(`${s.a} advances`, `${CLI} result ${id} ${s.a} 1 0`),
          cmdRow(`${s.b} advances`, `${CLI} result ${id} ${s.b} 1 0`)));
      }
      card.append(row);
    }
    if (agreedCount > 1) card.append(cmdRow(`Accept all ${agreedCount} agreed`, `${CLI} confirm --all`));
    const pendingScores = q.inboxNames.map(describeName).filter((d) => d?.kind === 'score').length;
    if (pendingScores) card.append(el('p', { class: 'muted sm' }, `${pendingScores} more score(s) in the inbox, not batched yet.`));
    slot.append(card);
  }

  // Lockouts.
  const locked = [...new Set(q.signups.map((s) => s.fp))].filter((fp) => attemptCount(fp, q.attempts, q.inboxNames) >= MAX_PIN_ATTEMPTS);
  const struggling = [...new Set(q.attempts.map((a) => a.fp))].filter((fp) => !locked.includes(fp));
  if (locked.length || struggling.length) {
    const card = el('div', { class: 'card' }, el('h3', {}, 'PINs'));
    for (const fp of locked) card.append(el('div', { class: 'match' },
      el('p', { class: 'sm' }, el('code', { class: 'mono' }, fp), ` is locked after ${MAX_PIN_ATTEMPTS} wrong PINs.`),
      cmdRow('Unlock', `${CLI} unlock ${fp}`), cmdRow('Issue a new PIN', `${CLI} repin ${fp}`)));
    for (const fp of struggling) card.append(el('p', { class: 'muted sm' }, `${fp}: ${attemptCount(fp, q.attempts, q.inboxNames)} wrong PIN(s) so far.`));
    slot.append(card);
  }

  // Pipeline health.
  const health = el('div', { class: 'card' }, el('h3', {}, 'Pipeline'),
    el('p', { class: 'muted sm' }, q.inboxNames.length ? `${q.inboxNames.length} submission(s) waiting in the inbox for the next batch.` : 'Inbox empty — everything has been batched.'));
  if (q.inboxNames.length) health.append(cmdRow('Batch now', `${CLI} batch`));
  if (q.rejected.length) {
    health.append(el('details', {}, el('summary', { class: 'muted sm' }, `Rejected at batch (${q.rejected.length})`),
      ...q.rejected.slice(-10).reverse().map((r) => el('p', { class: 'sm' }, el('span', { class: 'mono' }, r.entry), el('br', {}), el('span', { class: 'muted' }, r.reason)))));
  }
  health.append(el('div', { class: 'row' }, el('button', { class: 'btn ghost sm', onclick: () => render() }, 'Reload queue'),
    el('button', { class: 'btn ghost sm', onclick: () => { if (confirm('Forget the read token on this device?')) { local.del(READ_TOKEN); render(); } } }, 'Forget read token')));
  slot.append(health);
}

function claimCell(fp, c) {
  return el('div', { class: 'claim' },
    el('code', { class: 'mono' }, fp),
    c ? el('div', {}, el('strong', {}, `${c.myScore}–${c.oppScore}`), el('div', { class: 'muted sm' }, 'own score first'))
      : el('div', { class: 'muted sm' }, 'not submitted'));
}

// ---- stage changes -------------------------------------------------------------------

function renderStage(body, q) { body.append(stageCard(q)); }

function stageCard(q) {
  const card = el('div', { class: 'card stage-card' }, el('h3', {}, 'Stage changes'),
    el('p', { class: 'muted sm' }, 'Each shows the exact plan and its fingerprint and publishes nothing until you type the fingerprint back.'));
  const row = (action, label, cmd, extra) => {
    const g = gate(action, record.stage);
    card.append(el('div', { class: 'step' },
      el('div', { class: 'row spread' }, el('strong', {}, label), el('span', { class: 'muted sm' }, g.ok ? (extra || 'available') : 'not now')),
      g.ok ? cmdRow('', cmd) : el('p', { class: 'muted sm' }, g.error)));
  };
  row('phase:close', 'Close registration', `${CLI} close`, q ? `publishes ${q.admitted.length} admitted team(s)` : null);
  row('phase:reopen', 'Reopen registration', `${CLI} reopen`);
  if (q && gate('draw', record.stage).ok) {
    const waiting = q.signups.filter((s) => !q.admitted.some((a) => a.fp === s.fp)).length;
    row('draw', 'Draw', waiting ? `${CLI} draw --leave-pending` : `${CLI} draw`, `${q.admitted.length} team(s)${waiting ? ` · ${waiting} still waiting` : ''}`);
  } else row('draw', 'Draw', `${CLI} draw`);
  if (record.stage === 'round' && q) {
    const c = advanceCheck(record, q.accepted);
    card.append(el('div', { class: 'step' },
      el('div', { class: 'row spread' }, el('strong', {}, `Advance round ${record.round}`), el('span', { class: 'muted sm' }, c.ok ? 'ready' : 'not yet')),
      c.ok ? cmdRow(c.next === 'done' ? 'Publishes the final and completes the tournament' : `Publishes round ${record.round}, opens round ${c.next}`, `${CLI} advance`)
        : el('p', { class: 'muted sm' }, c.error)));
  } else row('round:advance', 'Advance round', `${CLI} advance`);
  card.append(el('details', {},
    el('summary', { class: 'muted sm' }, 'More'),
    cmdRow('Where everything stands', `${CLI} status`),
    cmdRow('Check the record and the queue for problems', `${CLI} check`),
    cmdRow('The whole queue, in the terminal', `${CLI} queue`),
    el('hr', {}),
    el('p', { class: 'muted sm' }, 'Start over: clears the public roster and results, the draw, and the private queue. Shows its plan first.'),
    cmdRow('Reset', `${CLI} reset`)));
  return card;
}

function cmdRow(label, cmd) {
  return el('div', { class: 'cmd' },
    label ? el('div', { class: 'muted sm' }, label) : null,
    el('div', { class: 'row' },
      el('pre', { class: 'blob cmd-text' }, cmd),
      el('button', { class: 'btn sm', onclick: async (e) => {
        e.target.textContent = (await copy(cmd)) ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => { e.target.textContent = 'Copy'; }, 1400);
      } }, 'Copy')));
}
