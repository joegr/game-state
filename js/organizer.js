// game-state — the organizer control bar.
//
// This is what used to be admin.html: a side bar that slides in from the edge,
// on a device where the organizer has set a PIN. It sits alongside the page
// rather than covering it, so the organizer can keep an eye on what everyone
// else is looking at while they work.
//
// IT CANNOT CHANGE THE TOURNAMENT. Nothing in a browser can: the record is
// markdown in two repos, and the only thing that writes to either is
// `tools/advance.mjs` calling `gh`. So every "action" here produces the exact
// command to run — the button copies it, the terminal does it. That is not a
// limitation to work around; it is the authorization model. Push access to the
// repos is the gate, and a web page has none.
//
// The PIN is a local device toggle, not a credential. There is nothing
// sensitive behind it — every number it shows is already public.

import { el, clear, copy } from './util.js';
import { hashToken, generateCode, decodeBlob } from './identity.js';
import { currentPhaseLabel, playableMatches, computeQueue, classifyPayload } from './engine.js';
import { loadTournamentState } from './config.js';

const PIN = 'game-state:admin:pin';

let tournament = null;
let live = null;
let bar = null;
let trigger = null;
let previewReports = [];

// Adds the trigger to the page. Unobtrusive until it's wanted; clicking it
// slides the control bar in (or offers to set a PIN up first).
export function mountOrganizer(t, l) {
  tournament = t;
  live = l;
  trigger = el('button', { class: 'organizer-trigger', onclick: toggle }, 'Organizer');
  document.body.append(trigger);
}

function toggle() { bar ? close() : open(); }

function open() {
  if (bar) return;
  bar = el('aside', { class: 'org-bar', role: 'complementary', 'aria-label': 'Organizer controls' });
  document.body.append(bar);
  document.body.classList.add('org-bar-open');
  document.addEventListener('keydown', onKey);
  // Let the element land before transitioning, so it slides rather than snaps.
  requestAnimationFrame(() => bar && bar.classList.add('open'));
  renderPanel(bar);
}

function close() {
  if (!bar) return;
  document.removeEventListener('keydown', onKey);
  document.body.classList.remove('org-bar-open');
  bar.remove();
  bar = null;
}

function onKey(e) { if (e.key === 'Escape') close(); }

function renderPanel(panel) {
  clear(panel);
  panel.append(el('div', { class: 'row spread org-bar-head' },
    el('h2', {}, 'Organizer'),
    el('button', { class: 'btn ghost sm', onclick: close, title: 'Close (Esc)' }, 'Close'),
  ));
  const body = el('div', { class: 'org-bar-body' });
  panel.append(body);

  if (!localStorage.getItem(PIN)) renderSetup(body, panel);
  else if (!sessionUnlocked) renderUnlock(body, panel);
  else renderConsole(body, panel);
}

let sessionUnlocked = false;

function renderSetup(body, panel) {
  const p1 = el('input', { type: 'password', class: 'input', placeholder: 'choose a PIN', autocomplete: 'new-password' });
  const p2 = el('input', { type: 'password', class: 'input', placeholder: 'confirm PIN', autocomplete: 'new-password' });
  body.append(
    el('p', { class: 'muted sm' }, 'Set a PIN to mark this device as yours. It only unlocks this panel on this browser — it is not a credential and protects nothing, because everything below is already public. The real gate on changing the tournament is an authenticated ', el('code', {}, 'gh'), ' with push access.'),
    p1, p2,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: async () => {
      if (p1.value.length < 4) return alert('Use at least 4 characters.');
      if (p1.value !== p2.value) return alert('PINs do not match.');
      localStorage.setItem(PIN, await hashToken(p1.value));
      sessionUnlocked = true;
      renderPanel(panel);
    } }, 'Set PIN')),
  );
}

function renderUnlock(body, panel) {
  const pin = el('input', { type: 'password', class: 'input', placeholder: 'PIN', autocomplete: 'current-password' });
  const go = async () => {
    if (await hashToken(pin.value) !== localStorage.getItem(PIN)) return alert('Wrong PIN.');
    sessionUnlocked = true;
    renderPanel(panel);
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  body.append(
    el('p', { class: 'muted sm' }, 'Enter your PIN to show the organizer panel on this device.'),
    pin,
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: go }, 'Unlock'),
      el('button', { class: 'btn ghost', onclick: () => {
        if (!confirm('Remove the organizer PIN from this device?')) return;
        localStorage.removeItem(PIN);
        renderPanel(panel);
      } }, 'Reset PIN'),
    ),
  );
}

function renderConsole(body, panel) {
  const { state, roster, progress } = live;
  const drawn = !!state;
  const complete = drawn && state.status === 'complete';

  body.append(el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('div', {},
        el('div', { class: 'muted sm' }, tournament.name),
        el('h3', {}, complete ? 'Champion crowned' : (drawn ? currentPhaseLabel(state) : 'Registration'))),
      el('span', { class: 'badge ' + (complete ? 'gold' : 'good') }, complete ? 'COMPLETE' : (drawn ? 'LIVE' : 'OPEN')),
    ),
    el('p', { class: 'muted sm' }, `${roster.length} confirmed team(s)${drawn ? ' · seed ' + state.seed : ` · ${progress.registered}/${progress.capacity} places filled`}`),
    complete ? el('p', { class: 'gold big' }, '🏆 ', el('span', { class: 'mono' }, state.champion)) : null,
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost sm', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Refreshing…';
        live = await loadTournamentState(tournament);
        renderPanel(panel);
      } }, 'Refresh'),
      el('a', { class: 'btn ghost sm', href: 'bracket.html', target: '_blank' }, 'Public bracket ↗'),
    ),
  ));

  body.append(el('p', { class: 'muted sm banner' },
    'Every button below copies a command. This page cannot write to the repos — run the command in a terminal with ', el('code', {}, 'gh'), ' authenticated.'));

  renderStageActions(body);
  if (drawn && !complete) renderQueue(body);
  renderInbox(body);
}

// ---- advance the stage --------------------------------------------------------

function renderStageActions(body) {
  const curIdx = tournament.phases.findIndex((p) => p.id === tournament.activePhase);
  const next = tournament.phases[curIdx + 1];

  const card = el('div', { class: 'card' },
    el('h3', {}, 'Advance the stage'),
    el('p', { class: 'muted sm' }, 'Current: ', el('strong', {}, tournament.phases[curIdx]?.label || tournament.activePhase)),
  );

  if (next) card.append(cmdRow(`Advance to “${next.label}”`, `node tools/advance.mjs stage ${next.id}`));
  else card.append(el('p', { class: 'muted sm' }, 'This is the last declared phase.'));

  if (!live.state) {
    card.append(cmdRow('Run the draw', 'node tools/advance.mjs draw'));
    card.append(el('p', { class: 'muted sm' }, 'The draw freezes the field — no team can be added after it.'));
  }

  const others = tournament.phases.filter((p) => p.id !== tournament.activePhase && p.id !== next?.id);
  if (others.length) {
    card.append(el('details', {},
      el('summary', { class: 'muted sm' }, 'Jump to another phase'),
      ...others.map((p) => cmdRow(p.label, `node tools/advance.mjs stage ${p.id}`)),
    ));
  }
  body.append(card);
}

// ---- review the score queue ---------------------------------------------------

function renderQueue(body) {
  const queue = computeQueue(live.state, previewReports);
  const entries = Object.entries(queue);
  const agreed = entries.filter(([, v]) => v.status === 'agreed');
  const other = entries.filter(([, v]) => v.status !== 'agreed');
  const unreported = [...playableMatches(live.state)].filter(([id]) => !queue[id]);

  const card = el('div', { class: 'card', id: 'org-queue' },
    el('h3', {}, 'Score queue'),
    el('p', { class: 'muted sm' }, 'Reflects the reports pasted into the Inbox below. Paste both captains’ reports to see a match reach agreement.'),
  );

  for (const [id, v] of agreed) {
    const hi = Math.max(v.scoreA, v.scoreB), lo = Math.min(v.scoreA, v.scoreB);
    card.append(el('div', { class: 'match' },
      el('div', { class: 'row spread' },
        el('strong', { class: 'mono' }, id),
        el('span', { class: 'badge good' }, 'AGREED')),
      el('p', {}, el('code', { class: 'mono' }, v.winner), ' wins ', el('strong', {}, `${hi}–${lo}`)),
      cmdRow('Publish this result', `node tools/advance.mjs result ${id} ${v.winner} ${hi} ${lo}`),
    ));
  }

  for (const [id, v] of other) {
    card.append(el('p', { class: 'sm muted' }, el('code', { class: 'mono' }, id), ' — ', v.status));
  }

  if (!entries.length) {
    card.append(el('p', { class: 'muted sm' }, unreported.length
      ? `${unreported.length} match(es) open, none reported into this panel yet.`
      : 'Nothing pending.'));
  }
  card.append(cmdRow('Tally the reports you have ingested', 'node tools/advance.mjs tally'));
  body.append(card);
}

function refreshQueue() {
  const old = document.getElementById('org-queue');
  if (!old || !live.state) return;
  const holder = el('div', {});
  renderQueue(holder);
  old.replaceWith(holder.firstChild);
}

// ---- dry-run inbox ------------------------------------------------------------

function renderInbox(body) {
  const ta = el('textarea', { class: 'input mono', rows: '3', placeholder: 'paste signup entries and/or score reports to check them' });
  const out = el('div', {});
  body.append(el('div', { class: 'card' },
    el('h3', {}, 'Inbox (check only)'),
    el('p', { class: 'muted sm' }, 'Classifies blobs and verifies them against the live roster. Nothing is stored or published. To actually publish, save the same text to a file and run ', el('code', {}, 'node tools/advance.mjs ingest <file>'), '.'),
    ta,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: async (e) => {
      e.target.disabled = true;
      await checkBlobs(ta.value, out);
      e.target.disabled = false;
    } }, 'Check blobs')),
    out,
  ));
}

async function checkBlobs(text, out) {
  const byFp = new Map(live.roster.map((t) => [t.fp, t.tokenHash]));
  const existing = new Set(live.roster.map((t) => t.fp));
  const lines = [];
  previewReports = [];

  for (const tok of text.match(/[A-Za-z0-9_-]{60,}/g) || []) {
    let payload;
    try { payload = decodeBlob(tok); } catch { lines.push(['bad', 'Unreadable blob.']); continue; }
    const c = classifyPayload(payload);
    if (!c) { lines.push(['bad', 'Unrecognized blob shape.']); continue; }

    if (c.type === 'signup') {
      const fp = await generateCode(c.token);
      lines.push(existing.has(fp)
        ? ['dup', `${fp} — already on the roster.`]
        : ['good', `${fp} — new team, would be added to roster.md.`]);
    } else {
      const expected = byFp.get(c.fp);
      if (!expected || await hashToken(c.token) !== expected) {
        lines.push(['bad', `${c.fp} — key does not match the roster (would be rejected).`]);
        continue;
      }
      previewReports.push({ reporterFp: c.fp, matchId: c.matchId, myScore: c.myScore, oppScore: c.oppScore, ts: c.ts });
      lines.push(['good', `${c.fp} — verified report for ${c.matchId} (${c.myScore}–${c.oppScore}).`]);
    }
  }

  clear(out);
  if (!lines.length) { out.append(el('p', { class: 'muted sm' }, 'No blobs found in that text.')); return; }
  for (const [kind, msg] of lines) {
    out.append(el('p', { class: 'sm ' + (kind === 'bad' ? 'danger' : kind === 'dup' ? 'muted' : 'good-text') }, msg));
  }
  refreshQueue();
}

// ---- one command, one copy button ---------------------------------------------

function cmdRow(label, cmd) {
  return el('div', { class: 'cmd' },
    el('div', { class: 'muted sm' }, label),
    el('div', { class: 'row' },
      el('pre', { class: 'blob cmd-text' }, cmd),
      el('button', { class: 'btn sm', onclick: async (e) => {
        e.target.textContent = (await copy(cmd)) ? 'Copied ✓' : 'Copy failed';
        setTimeout(() => { e.target.textContent = 'Copy'; }, 1400);
      } }, 'Copy'),
    ));
}
