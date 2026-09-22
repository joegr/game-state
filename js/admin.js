// game-state — organizer status view (admin.html).
//
// This is a READ-ONLY mirror of the public site, plus a dry-run Inbox and a
// cheatsheet of what to run next. It is not a database: markdown IS the
// database of record (roster.md + results.md, in the roster repo) and
// config/tournament.json (the activePhase/drawSeed spine, in this repo) — and
// the only thing that ever writes to either is `tools/advance.mjs`, which
// only ever writes by calling `gh`. Nothing here persists a working copy of
// the tournament; every render re-fetches the live state.
//
// The PIN below is a local device toggle, not a credential — there is
// nothing sensitive behind it. The real gate on changing anything is who has
// an authenticated `gh` with push access to the app repo and the roster repo.

import { el, clear, copy } from './util.js';
import { hashToken, generateCode, decodeBlob } from './identity.js';
import {
  currentPhaseLabel, playableMatches, computeQueue, classifyPayload,
} from './engine.js';
import { loadTournament, loadTournamentState } from './config.js';

const PIN = 'game-state:admin:pin';
const app = document.getElementById('app');

let tournament = null;
let unlocked = false; // local-device view toggle only, reset on reload
let live = null;      // { roster, progress, state } — always the live, fetched truth

async function boot() {
  try {
    tournament = await loadTournament();
    live = await loadTournamentState(tournament);
  } catch (e) {
    app.append(el('div', { class: 'card danger' }, 'Config error: ' + e.message)); return;
  }
  document.getElementById('tourney-name').textContent = tournament.name || 'Tournament';
  render();
}

function render() {
  clear(app);
  if (!unlocked) return localStorage.getItem(PIN) ? renderUnlock() : renderSetup();
  renderConsole();
}

// ---- view toggle: local device PIN ------------------------------------------

function renderSetup() {
  const p1 = el('input', { type: 'password', class: 'input', placeholder: 'choose a PIN', autocomplete: 'new-password' });
  const p2 = el('input', { type: 'password', class: 'input', placeholder: 'confirm PIN', autocomplete: 'new-password' });

  app.append(el('div', { class: 'card' },
    el('h2', {}, 'Set up this view'),
    el('p', { class: 'muted' }, 'Choose a PIN for this device. It only switches this browser to the organizer-flavored view of public data — it is not a credential and does not protect anything. Nothing here can change the tournament; only an authenticated gh with push access to the repos can do that.'),
    el('label', {}, 'PIN'), p1, p2,
    el('button', { class: 'btn', onclick: async () => {
      if (p1.value.length < 4) return alert('Use at least 4 characters.');
      if (p1.value !== p2.value) return alert('PINs do not match.');
      localStorage.setItem(PIN, await hashToken(p1.value));
      unlocked = true; render();
    } }, 'Set PIN'),
  ));
}

function renderUnlock() {
  const pin = el('input', { type: 'password', class: 'input', placeholder: 'PIN', autocomplete: 'current-password' });
  const form = el('form', { class: 'card' },
    el('h2', {}, 'Organizer view'),
    el('p', { class: 'muted' }, 'Enter your PIN to switch to the organizer view on this device.'),
    pin,
    el('div', { class: 'row' },
      el('button', { type: 'submit', class: 'btn' }, 'Unlock'),
      el('button', { type: 'button', class: 'btn ghost', onclick: () => { if (confirm('Remove the PIN from this device?')) { localStorage.removeItem(PIN); render(); } } }, 'Reset PIN'),
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await hashToken(pin.value) !== localStorage.getItem(PIN)) return alert('Wrong PIN.');
    unlocked = true; render();
  });
  app.append(form);
}

// ---- console (read-only) ----------------------------------------------------

function renderConsole() {
  const { state } = live;
  const drawn = !!state;
  const complete = drawn && state.status === 'complete';

  app.append(el('div', { class: 'row spread' },
    el('h2', {}, 'Organizer view'),
    el('div', { class: 'row' },
      el('a', { class: 'btn ghost sm', href: 'bracket.html', target: '_blank' }, 'View public ↗'),
      el('button', { class: 'btn ghost sm', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Refreshing…';
        live = await loadTournamentState(tournament); render();
      } }, 'Refresh'),
      el('button', { class: 'btn ghost sm', onclick: () => { unlocked = false; render(); } }, 'Lock'),
    ),
  ));

  app.append(el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {}, el('div', { class: 'muted sm' }, tournament.name), el('h3', {}, complete ? 'Champion crowned' : (drawn ? currentPhaseLabel(state) : 'Registration'))),
      el('span', { class: 'badge ' + (complete ? 'gold' : 'good') }, complete ? 'COMPLETE' : (drawn ? 'LIVE' : 'OPEN')),
    ),
    el('p', { class: 'muted sm' }, `${live.roster.length} confirmed team(s)${state ? ' · seed ' + state.seed : ''}`),
    complete ? el('p', { class: 'gold big' }, '🏆 ', el('span', { class: 'mono' }, state.champion)) : null,
  ));

  renderNextSteps();
  queuePreviewCard = (drawn && !complete) ? renderQueuePreview() : null;
  if (queuePreviewCard) app.append(queuePreviewCard);
  renderInbox();
}

// What to run next, given the live state. This is guidance only — nothing
// here executes anything; the organizer runs these in a terminal with `gh`
// authenticated against the app repo and the roster repo.
function renderNextSteps() {
  const { state, progress } = live;
  const curIdx = tournament.phases.findIndex((p) => p.id === tournament.activePhase);
  const next = tournament.phases[curIdx + 1];
  const cmds = [];

  if (!state) {
    cmds.push('node tools/advance.mjs ingest <file>   # add pasted signups to roster.md');
    if (progress.full) cmds.push(next ? `node tools/advance.mjs stage ${next.id}   # close registration` : null);
    cmds.push('node tools/advance.mjs draw   # once registration is closed');
  } else if (state.status !== 'complete') {
    cmds.push('node tools/advance.mjs ingest <file>   # add pasted score reports');
    cmds.push('node tools/advance.mjs tally   # check two-captain agreement');
    cmds.push('node tools/advance.mjs result <matchId> <winnerFp> <scoreWinner> <scoreLoser>');
    if (next) cmds.push(`node tools/advance.mjs stage ${next.id}   # when this round is done`);
  } else if (next) {
    cmds.push(`node tools/advance.mjs stage ${next.id}   # mark the tournament complete`);
  }

  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Run next'),
    el('pre', { class: 'blob' }, cmds.filter(Boolean).join('\n')),
  ));
}

// Preview only: shows what `tally` + `result` would report, using whatever
// verified reports are currently pasted in the Inbox below. Nothing here is
// persisted — paste again next time. Rebuilt in place (not via a full
// render()) so checking blobs doesn't clear the Inbox textarea.
let previewReports = [];
let queuePreviewCard = null;
function renderQueuePreview() {
  const queue = computeQueue(live.state, previewReports);
  const entries = Object.entries(queue);
  const agreed = entries.filter(([, v]) => v.status === 'agreed');
  const unreported = [...playableMatches(live.state)].filter(([id]) => !queue[id]);

  const card = el('div', { class: 'card' }, el('h3', {}, 'Result queue (preview)'),
    el('p', { class: 'muted sm' }, 'Reflects whatever verified score reports are pasted in the Inbox below — paste both captains\' reports to see agreement here.'));

  if (agreed.length) {
    for (const [id, v] of agreed) card.append(el('div', { class: 'match' },
      el('div', { class: 'row spread' }, el('strong', {}, id), el('span', { class: 'badge good' }, 'AGREED')),
      el('p', {}, el('code', { class: 'mono' }, v.winner), ' wins ', el('strong', {}, `${Math.max(v.scoreA, v.scoreB)}–${Math.min(v.scoreA, v.scoreB)}`)),
      el('pre', { class: 'blob sm' }, `node tools/advance.mjs result ${id} ${v.winner} ${Math.max(v.scoreA, v.scoreB)} ${Math.min(v.scoreA, v.scoreB)}`),
    ));
  }
  const other = entries.filter(([, v]) => v.status !== 'agreed');
  for (const [id, v] of other) card.append(el('p', { class: 'sm muted' }, el('code', { class: 'mono' }, id), ' — ', v.status));
  if (!entries.length) card.append(el('p', { class: 'muted' }, unreported.length ? `${unreported.length} match(es) awaiting reports.` : 'Nothing pending.'));
  return card;
}

function refreshQueuePreview() {
  if (!queuePreviewCard) return;
  const fresh = renderQueuePreview();
  queuePreviewCard.replaceWith(fresh);
  queuePreviewCard = fresh;
}

// Dry-run only: classify + verify pasted blobs against the LIVE roster. Never
// writes anywhere — publishing signups/results is `tools/advance.mjs`'s job.
function renderInbox() {
  const ta = el('textarea', { class: 'input mono', rows: '3', placeholder: 'paste signup entries and/or score reports to preview (any amount, any format — blobs are auto-detected)' });
  const out = el('div', {});
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Inbox (preview only)'),
    el('p', { class: 'muted sm' }, 'Checks blobs against the live roster and shows what would happen. To actually publish, save the same text to a file and run ', el('code', {}, 'node tools/advance.mjs ingest <file>'), '.'),
    ta,
    el('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true;
      await previewInbox(ta.value, out);
      e.target.disabled = false;
    } }, 'Check blobs'),
    out,
  ));
}

async function previewInbox(text, out) {
  const rosterByFp = new Map(live.roster.map((t) => [t.fp, t.tokenHash]));
  const existingFps = new Set(live.roster.map((t) => t.fp));
  const tokens = text.match(/[A-Za-z0-9_-]{60,}/g) || [];
  const lines = [];
  previewReports = [];

  for (const tok of tokens) {
    let payload;
    try { payload = decodeBlob(tok); } catch { lines.push(['bad', 'Unreadable blob.']); continue; }
    const c = classifyPayload(payload);
    if (!c) { lines.push(['bad', 'Unrecognized blob shape.']); continue; }
    if (c.type === 'signup') {
      const fp = await generateCode(c.token);
      lines.push(existingFps.has(fp) ? ['dup', `${fp} — already on the roster.`] : ['good', `${fp} — new team, would be added to roster.md.`]);
    } else {
      const expected = rosterByFp.get(c.fp);
      if (!expected || await hashToken(c.token) !== expected) { lines.push(['bad', `${c.fp} — token does not match the roster (rejected).`]); continue; }
      previewReports.push({ reporterFp: c.fp, matchId: c.matchId, myScore: c.myScore, oppScore: c.oppScore, ts: c.ts });
      lines.push(['good', `${c.fp} — verified report for ${c.matchId} (${c.myScore}-${c.oppScore}).`]);
    }
  }

  clear(out);
  if (!lines.length) { out.append(el('p', { class: 'muted sm' }, 'No blobs found in that text.')); return; }
  for (const [kind, msg] of lines) out.append(el('p', { class: 'sm ' + (kind === 'bad' ? 'danger' : kind === 'dup' ? 'muted' : '') }, msg));
  refreshQueuePreview();
}

boot();
