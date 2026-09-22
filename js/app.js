// game-state — captain.html: a team's own view of the bracket.
//
// Registration lives on index.html and score reporting on report.html; this
// page is just "where do I stand". All three read the same public markdown and
// reconstruct the same state — see js/config.js.

import { loadTournament, loadTournamentState } from './config.js';
import { buildViews } from './engine.js';
import { el, clear } from './util.js';
import { renderCaptain } from './captain.js';

const app = document.getElementById('app');

boot();

async function boot() {
  let tournament, views, drawn;
  try {
    tournament = await loadTournament();
    const { roster, state } = await loadTournamentState(tournament);
    drawn = !!state;
    views = state ? buildViews(state, roster.map((t) => t.fp)) : {};
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Config error'), el('p', {}, String(err.message))));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · captain · game-state`;

  clear(app);
  app.append(nav());
  const view = el('div', { class: 'view' });
  app.append(view);
  renderCaptain(view, tournament, { drawn, views });
}

function nav() {
  return el('nav', { class: 'tabs' },
    el('a', { href: 'index.html', class: 'tab' }, '← Register'),
    el('a', { href: 'bracket.html', class: 'tab' }, 'Public bracket'),
    el('span', { class: 'tab active' }, 'Captain view'),
    el('a', { href: 'report.html', class: 'tab' }, 'Report a score'));
}
