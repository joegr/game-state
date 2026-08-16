// game-state — captain's-eye view.
//
// A captain sees ONLY their own slice of the tournament. The public bracket.json
// carries per-fingerprint encrypted blobs; a captain can decrypt exactly one —
// their own — with the private key they hold. No captain can enumerate the field,
// see other identities, or read the full draw. That is the whole privacy model.

import { el, clear, keyStore, fmtDate } from './util.js';
import { unseal } from './crypto.js';

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
    root.append(header, renderView(view, key));
  } catch (err) {
    clear(root);
    root.append(header, el('div', { class: 'card danger' },
      el('h3', {}, 'Could not decrypt'),
      el('p', { class: 'muted' }, 'This key does not match the published fixture. Make sure you loaded the right captain key.'),
    ));
  }
}

function renderView(view, key) {
  const alive = view.status !== 'eliminated' && view.status !== 'champion';
  const statusBadge = {
    champion: ['🏆 Champion', 'gold'],
    eliminated: ['Eliminated', 'muted'],
    bye: ['Bye — you advance', 'good'],
    scheduled: ['Match scheduled', 'good'],
  }[view.status] || ['In the running', 'good'];

  return el('div', { class: 'card' },
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
