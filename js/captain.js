// game-state — captain's-eye view.
//
// `bracket` here is `{ drawn, views }`, reconstructed client-side (see
// js/app.js + js/config.js) from the roster repo's roster.md/results.md —
// nothing per-captain is stored anywhere. Views are keyed by team code, and
// the bracket is public anyway, so this page reveals nothing a spectator
// couldn't read off bracket.html. It is a filter, not a private channel.
//
// Reporting a score is NOT here: it needs the captain's key and it has to be
// bounded to open matches, which is report.html's whole job.

import { el, clear, identityStore } from './util.js';
import { parseKey } from './identity.js';

export async function renderCaptain(root, tournament, bracket) {
  clear(root);
  const id = identityStore.load(tournament.name);

  if (!id) return renderIdentityLoader(root, tournament, bracket);

  const view = bracket.views?.[id.fp];
  const header = el('div', { class: 'row spread' },
    el('h2', {}, 'Captain view'),
    el('button', { class: 'btn ghost sm', onclick: () => renderIdentityLoader(root, tournament, bracket) }, 'Use a different key'),
  );

  if (!view) {
    root.append(header, el('div', { class: 'card' },
      el('p', {}, 'Your team ', el('code', { class: 'mono' }, id.fp), ' is set up on this device.'),
      el('p', { class: 'muted' }, !bracket.drawn
        ? 'The draw has not happened yet. Your fixtures appear here once it runs — and you are only on the roster once the organizer has ingested your entry.'
        : 'No fixture is published for you in the current round. If you were eliminated, your run ends here — well played.'),
    ));
    return;
  }

  root.append(header, renderView(view, id));
}

function renderView(view, id) {
  const [text, tone] = {
    champion: ['🏆 Champion', 'gold'],
    eliminated: ['Eliminated', 'muted'],
    bye: ['Bye — you advance', 'good'],
    scheduled: ['Match scheduled', 'good'],
  }[view.status] || ['In the running', 'good'];

  const card = el('div', { class: 'card' },
    el('div', { class: 'row spread' },
      el('h3', {}, 'Your team'),
      el('span', { class: `badge ${tone}` }, text),
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

  if (view.status === 'scheduled' && view.opponent && view.matchId) {
    card.append(el('div', { class: 'row' },
      el('a', { class: 'btn', href: 'report.html' }, 'Report this score →')));
  }
  return card;
}

function renderIdentityLoader(root, tournament, bracket) {
  clear(root);
  const ta = el('textarea', {
    class: 'input mono', rows: '3',
    placeholder: 'AB12:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  });
  const msg = el('div', {});

  root.append(el('div', { class: 'card' },
    el('h2', {}, 'Load your score report key'),
    el('p', { class: 'muted' }, 'Paste the key you saved at registration. Not registered yet? ',
      el('a', { href: 'index.html' }, 'Register here'), '.'),
    ta,
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: async () => {
      const parsed = await parseKey(ta.value);
      if (!parsed) {
        clear(msg);
        msg.append(el('p', { class: 'sm danger' }, 'That does not look like a valid key.'));
        return;
      }
      identityStore.save(tournament.name, parsed);
      renderCaptain(root, tournament, bracket);
    } }, 'Load')),
    msg,
  ));
}
