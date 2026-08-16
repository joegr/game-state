// game-state — captain's-eye view.
//
// A captain sees ONLY their own slice of the tournament. The public bracket.json
// carries per-fingerprint encrypted blobs; a captain can decrypt exactly one —
// their own — with the private key they hold. No captain can enumerate the field,
// see other identities, or read the full draw. That is the whole privacy model.

import { el, clear, keyStore, fmtDate, copy } from './util.js';
import { unseal, authSeal } from './crypto.js';

export async function renderCaptain(root, tournament, bracket) {
  clear(root);
  let key = keyStore.load(tournament.name);

  if (!key) {
    renderKeyLoader(root, tournament, bracket);
    return;
  }

  const blob = bracket.views?.[key.fingerprint];
  const header = el('div', { class: 'row spread' },
    el('h2', {}, 'Captain view'),
    el('button', { class: 'btn ghost sm', onclick: () => renderKeyLoader(root, tournament, bracket) }, 'Load a different key'),
  );

  if (!blob) {
    root.append(header, el('div', { class: 'card' },
      el('p', {}, 'Your team ', el('code', { class: 'mono' }, key.fingerprint), ' is registered.'),
      el('p', { class: 'muted' }, bracket.activePhase === 'signup'
        ? 'The draw has not happened yet. Check back once the group stage begins — your fixtures will appear here.'
        : 'No fixture is published for you in the current round. If you were eliminated, your journey ends here — well played.'),
    ));
    return;
  }

  root.append(header, el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Decrypting your view…')));
  try {
    const view = JSON.parse(await unseal(blob, key.privateKey));
    clear(root);
    root.append(header, renderView(view, key, tournament));
  } catch (err) {
    clear(root);
    root.append(header, el('div', { class: 'card danger' },
      el('h3', {}, 'Could not decrypt'),
      el('p', { class: 'muted' }, 'This key does not match the published fixture. Make sure you loaded the right captain key.'),
    ));
  }
}

function renderView(view, key, tournament) {
  const statusBadge = {
    champion: ['🏆 Champion', 'gold'],
    eliminated: ['Eliminated', 'muted'],
    bye: ['Bye — you advance', 'good'],
    scheduled: ['Match scheduled', 'good'],
  }[view.status] || ['In the running', 'good'];

  const card = el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('h3', {}, view.teamName || key.teamName || 'Your team'),
      el('span', { class: `badge ${statusBadge[1]}` }, statusBadge[0]),
    ),
    el('p', { class: 'muted' }, 'Anonymous ID ', el('code', { class: 'mono' }, key.fingerprint)),
    view.phaseLabel ? el('p', {}, 'Current stage: ', el('strong', {}, view.phaseLabel)) : null,
    view.group ? el('p', {}, 'Group: ', el('strong', {}, view.group)) : null,
    view.opponent ? el('div', { class: 'match' },
      el('div', {}, 'Next opponent'),
      el('div', { class: 'opp' }, el('code', { class: 'mono' }, view.opponent)),
      view.matchTime ? el('div', { class: 'muted' }, fmtDate(view.matchTime)) : null,
    ) : null,
    view.instructions ? el('p', { class: 'muted' }, view.instructions) : null,
    view.status === 'champion' ? el('p', { class: 'gold big' }, 'You won the Gauntlet.') : null,
  );

  // Score reporting: only for a live match with a known opponent.
  if (view.status === 'scheduled' && view.opponent && view.matchId) {
    card.append(renderScoreReport(view, key, tournament));
  }
  return card;
}

// A captain reports the final score of their current match. The report is
// authenticated with their captain key (so it can't be forged) and encrypted to
// the organizer. Once BOTH captains report matching scores, the engine queues
// the match for the admin — triple confirmation before the bracket advances.
function renderScoreReport(view, key, tournament) {
  const box = el('div', { class: 'match' });
  const reportedKey = `game-state:score:${tournament.name}:${view.matchId}`;
  const prior = localStorage.getItem(reportedKey);

  box.append(el('div', { class: 'row spread' }, el('strong', {}, 'Report final score'), el('span', { class: 'muted sm' }, view.matchId)));

  if (!tournament.organizerPublicKey) {
    box.append(el('p', { class: 'warn' }, 'Score reporting is not configured yet (no organizer key).'));
    return box;
  }

  const mine = el('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: 'your score', style: 'max-width:120px' });
  const theirs = el('input', { class: 'input', type: 'number', min: '0', step: '1', placeholder: 'their score', style: 'max-width:120px' });
  const out = el('div', {});

  box.append(
    el('p', { class: 'muted sm' }, 'Both captains submit independently. The result only advances when your scores agree and the admin confirms.'),
    el('div', { class: 'row' }, mine, el('span', { class: 'muted' }, '–'), theirs,
      el('button', { class: 'btn', onclick: async () => {
        const my = parseInt(mine.value, 10), op = parseInt(theirs.value, 10);
        if (!Number.isInteger(my) || !Number.isInteger(op)) return alert('Enter both scores.');
        if (my === op) return alert('Ties cannot advance a single-elimination match. Enter the decisive score.');
        const report = JSON.stringify({ v: 1, matchId: view.matchId, myScore: my, oppScore: op, ts: new Date().toISOString() });
        const sealed = await authSeal(report, key.privateKey, key.publicKey, tournament.organizerPublicKey);
        localStorage.setItem(reportedKey, `${my}-${op}`);
        renderScoreSubmission(out, tournament, view, key, sealed, my, op);
      } }, 'Seal & submit')),
    prior ? el('p', { class: 'muted sm' }, 'You previously reported ', el('code', { class: 'mono' }, prior), ' on this device. Re-submitting overrides it.') : null,
    out,
  );
  return box;
}

function renderScoreSubmission(out, tournament, view, key, sealed, my, op) {
  clear(out);
  const repo = tournament.signup?.repo || 'your-org/your-tournament';
  const title = `score: ${view.matchId} (${key.fingerprint})`;
  const body = `game-state score report\nmatch: ${view.matchId}\n\n\`\`\`\n${sealed}\n\`\`\`\n`;
  const issueUrl = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  out.append(el('div', { class: 'card success' },
    el('p', {}, 'Score sealed: ', el('strong', {}, `${my}–${op}`), '. Submit it to the organizer:'),
    el('div', { class: 'row' },
      el('a', { class: 'btn', href: issueUrl, target: '_blank', rel: 'noopener' }, 'Open pre-filled GitHub issue'),
      el('button', { class: 'btn ghost', onclick: async (e) => { e.target.textContent = (await copy(sealed)) ? 'Copied ✓' : 'Copy failed'; } }, 'Copy blob'),
    ),
  ));
}

function renderKeyLoader(root, tournament, bracket) {
  clear(root);
  root.append(el('div', { class: 'card' },
    el('h2', {}, 'Load your captain key'),
    el('p', { class: 'muted' }, 'Paste the captain key JSON you downloaded at signup, or drop the file.'),
    (() => {
      const ta = el('textarea', { class: 'input mono', rows: '5', placeholder: '{ "publicKey": "...", "privateKey": "...", "fingerprint": "..." }' });
      const file = el('input', { type: 'file', accept: '.json', class: 'input', onchange: async (e) => {
        const f = e.target.files[0]; if (f) ta.value = await f.text();
      } });
      const load = el('button', { class: 'btn', onclick: () => {
        try {
          const k = JSON.parse(ta.value);
          if (!k.privateKey || !k.fingerprint) throw new Error('missing fields');
          keyStore.save(tournament.name, { publicKey: k.publicKey, privateKey: k.privateKey, fingerprint: k.fingerprint, teamName: k.teamName });
          renderCaptain(root, tournament, bracket);
        } catch { alert('That does not look like a valid captain key.'); }
      } }, 'Load key');
      return el('div', {}, el('div', { class: 'row' }, file), ta, el('div', { class: 'row' }, load));
    })(),
  ));
}
