// game-state — PUBLIC spectator view.
//
// Renders the anonymized bracket from config/public.json. Everyone sees the same
// thing: opaque team IDs, match results as they close, the live champion. No
// identities, no keys — the private "captain perspective" lives on the main app.

import { el, clear, fmtDate } from './util.js';

const app = document.getElementById('app');

async function boot() {
  let data;
  try {
    const res = await fetch(new URL('config/public.json', document.baseURI).href, { cache: 'no-cache' });
    data = await res.json();
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Could not load bracket'), el('p', {}, String(err))));
    return;
  }
  document.getElementById('tourney-name').textContent = data.tournament || 'Tournament';
  document.title = `${data.tournament || 'Tournament'} · spectator · game-state`;
  render(data);
}

function teamChip(fp, { winner, dim } = {}) {
  if (!fp) return el('span', { class: 'team empty' }, 'bye');
  return el('span', { class: 'team' + (winner ? ' win' : '') + (dim ? ' out' : '') },
    el('span', { class: 'mono' }, fp), winner ? el('span', { class: 'check' }, '✓') : null);
}

function render(data) {
  clear(app);

  const pct = data.matchesTotal ? Math.round((data.matchesDecided / data.matchesTotal) * 100) : 0;
  app.append(el('div', { class: 'card hero' },
    el('div', { class: 'row spread' },
      el('div', {},
        el('div', { class: 'muted' }, 'Current stage'),
        el('h2', { class: 'phase-title' }, data.status === 'complete' ? 'Champion crowned' : (data.activePhase || '—')),
      ),
      el('span', { class: 'badge ' + (data.status === 'complete' ? 'gold' : 'good') }, (data.status || '').toUpperCase() || 'LIVE'),
    ),
    data.champion
      ? el('p', { class: 'gold big' }, '🏆 Champion: ', el('span', { class: 'mono' }, data.champion))
      : el('p', { class: 'muted' }, `${data.teamCount || 0} teams · ${data.matchesDecided}/${data.matchesTotal} matches decided`),
    data.matchesTotal ? el('div', { class: 'progress' }, el('div', { class: 'bar', style: `width:${pct}%` })) : null,
    data.seed ? el('p', { class: 'muted sm' }, 'Draw seed: ', el('code', { class: 'mono' }, data.seed), ' — the bracket is a reproducible, seeded random draw.') : null,
  ));

  if (!data.rounds || !data.rounds.length) {
    app.append(el('div', { class: 'card' }, el('p', { class: 'muted' }, data.note || 'The draw has not happened yet. Check back once registration closes.')));
  } else {
    app.append(el('div', { class: 'bracket' }, data.rounds.map((round) =>
      el('div', { class: 'col' },
        el('div', { class: 'col-head' }, el('strong', {}, round.label), round.start ? el('div', { class: 'muted sm' }, fmtDate(round.start)) : null),
        round.matches.map((m) => {
          const decided = !!m.winner;
          return el('div', { class: 'bmatch' + (decided ? ' done' : '') },
            el('div', { class: 'mid' }, m.id),
            teamChip(m.a, { winner: decided && m.winner === m.a, dim: decided && m.winner !== m.a && m.a }),
            teamChip(m.b, { winner: decided && m.winner === m.b, dim: decided && m.winner !== m.b && m.b }),
          );
        }),
      ))));
  }

  app.append(el('p', { class: 'muted sm center' },
    'Anonymized public bracket · your personal fixtures live in the ',
    el('a', { href: 'index.html#/captain' }, 'Captain view'), '.'));
}

boot();
