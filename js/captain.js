// game-state — captain's-eye view.
//
// `bracket` here is `{ drawn, views }`, reconstructed client-side (see
// js/app.js + js/config.js) from the roster repo's roster.md/results.md —
// there is no bracket.json. Views are keyed by team code, and the bracket is
// public anyway — every code shows up on it eventually. What a captain's token
// protects is the one action that matters: reporting a score as that team.

import { el, clear, identityStore, copy } from './util.js';
import { encodeBlob } from './identity.js';

export async function renderCaptain(root, tournament, bracket) {
  clear(root);
  const id = identityStore.load(tournament.name);

  if (!id) {
    renderIdentityLoader(root, tournament, bracket);
    return;
  }

  const view = bracket.views?.[id.fp];
  const header = el('div', { class: 'row spread' },
    el('h2', {}, 'Captain view'),
    el('button', { class: 'btn ghost sm', onclick: () => renderIdentityLoader(root, tournament, bracket) }, 'Load a different code'),
  );

  if (!view) {
    root.append(header, el('div', { class: 'card' },
      el('p', {}, 'Your team ', el('code', { class: 'mono' }, id.fp), ' is registered.'),
      el('p', { class: 'muted' }, !bracket.drawn
        ? 'The draw has not happened yet. Check back once the group stage begins — your fixtures will appear here.'
        : 'No fixture is published for you in the current round. If you were eliminated, your journey ends here — well played.'),
    ));
    return;
  }

  root.append(header, renderView(view, id, tournament));
}

function renderView(view, id, tournament) {
  const statusBadge = {
    champion: ['🏆 Champion', 'gold'],
    eliminated: ['Eliminated', 'muted'],
    bye: ['Bye — you advance', 'good'],
    scheduled: ['Match scheduled', 'good'],
  }[view.status] || ['In the running', 'good'];

  const card = el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('h3', {}, 'Your team'),
      el('span', { class: `badge ${statusBadge[1]}` }, statusBadge[0]),
    ),
    el('p', { class: 'muted' }, 'Anonymous ID ', el('code', { class: 'mono' }, id.fp)),
    view.phaseLabel ? el('p', {}, 'Current stage: ', el('strong', {}, view.phaseLabel)) : null,
    view.opponent ? el('div', { class: 'match' },
      el('div', {}, 'Next opponent'),
      el('div', { class: 'opp' }, el('code', { class: 'mono' }, view.opponent)),
    ) : null,
    view.instructions ? el('p', { class: 'muted' }, view.instructions) : null,
    view.status === 'champion' ? el('p', { class: 'gold big' }, 'You won the Gauntlet.') : null,
  );

  // Score reporting: only for a live match with a known opponent.
  if (view.status === 'scheduled' && view.opponent && view.matchId) {
    card.append(renderScoreReport(view, id, tournament));
  }
  return card;
}

// A captain reports the final score of their current match. The report carries
// their token, so the organizer can check it hashes to the roster entry for
// this code — that's the whole anti-forgery property. Once BOTH captains
// report matching scores, the engine queues the match for the organizer:
// triple confirmation before the bracket advances.
function renderScoreReport(view, id, tournament) {
  const box = el('div', { class: 'match' });
  const reportedKey = `game-state:score:${tournament.name}:${view.matchId}`;
  const prior = localStorage.getItem(reportedKey);

  box.append(el('div', { class: 'row spread' }, el('strong', {}, 'Report final score'), el('span', { class: 'muted sm' }, view.matchId)));

  const mine = el('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: 'your score', style: 'max-width:120px' });
  const theirs = el('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: 'their score', style: 'max-width:120px' });
  const out = el('div', {});

  box.append(
    el('p', { class: 'muted sm' }, 'Both captains submit independently. The result only advances when your scores agree and the organizer confirms.'),
    el('div', { class: 'row' }, mine, el('span', { class: 'muted' }, '–'), theirs,
      el('button', { class: 'btn', onclick: async () => {
        const my = parseInt(mine.value, 10), op = parseInt(theirs.value, 10);
        if (!Number.isInteger(my) || !Number.isInteger(op)) return alert('Enter both scores.');
        if (my === op) return alert('Ties cannot advance a single-elimination match. Enter the decisive score.');
        const report = encodeBlob({ v: 1, fp: id.fp, token: id.token, matchId: view.matchId, myScore: my, oppScore: op, ts: new Date().toISOString() });
        localStorage.setItem(reportedKey, `${my}-${op}`);
        renderScoreSubmission(out, view, report, my, op);
      } }, 'Submit')),
    prior ? el('p', { class: 'muted sm' }, 'You previously reported ', el('code', { class: 'mono' }, prior), ' on this device. Re-submitting overrides it.') : null,
    out,
  );
  return box;
}

function renderScoreSubmission(out, view, report, my, op) {
  clear(out);
  out.append(el('div', { class: 'card success' },
    el('p', {}, 'Score recorded: ', el('strong', {}, `${my}–${op}`), ' for ', el('code', { class: 'mono' }, view.matchId), '.'),
    el('p', { class: 'muted sm' }, 'Send this report to the organizer. It advances the match only if your opponent reports the same score.'),
    el('pre', { class: 'blob' }, report),
    el('button', { class: 'btn', onclick: async (e) => { e.target.textContent = (await copy(report)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy report'),
  ));
}

function renderIdentityLoader(root, tournament, bracket) {
  clear(root);
  root.append(el('div', { class: 'card' },
    el('h2', {}, 'Load your team code + token'),
    el('p', { class: 'muted' }, 'Paste the token JSON you downloaded at signup, or your "CODE:token" line, or drop the file.'),
    (() => {
      const ta = el('textarea', { class: 'input mono', rows: '3', placeholder: '{ "fp": "AB12", "token": "..." }  or  AB12:xxxxxxxx' });
      const file = el('input', { type: 'file', accept: '.json', class: 'input', onchange: async (e) => {
        const f = e.target.files[0]; if (f) ta.value = await f.text();
      } });
      const load = el('button', { class: 'btn', onclick: () => {
        const parsed = parseIdentityInput(ta.value);
        if (!parsed) return alert('That does not look like a valid code + token.');
        identityStore.save(tournament.name, parsed);
        renderCaptain(root, tournament, bracket);
      } }, 'Load');
      return el('div', {}, el('div', { class: 'row' }, file), ta, el('div', { class: 'row' }, load));
    })(),
  ));
}

function parseIdentityInput(text) {
  const t = text.trim();
  try {
    const j = JSON.parse(t);
    if (j.fp && j.token) return { fp: j.fp, token: j.token };
  } catch { /* not JSON — try CODE:token */ }
  const m = t.match(/^([A-Za-z0-9]{4}):(\S+)$/);
  return m ? { fp: m[1].toUpperCase(), token: m[2] } : null;
}
