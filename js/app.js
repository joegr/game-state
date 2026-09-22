// game-state — captain.html: sign in as your team, see where you stand, and
// submit a score. Reads the same public markdown every page reconstructs from
// (js/config.js); submits only through the intake workflow (js/api.js).

import { loadTournament, loadTournamentState } from './config.js';
import { el, clear } from './util.js';
import { renderCaptain } from './captain.js';
import { mountOrganizer } from './organizer.js';

const app = document.getElementById('app');

boot();

async function boot() {
  let tournament, live;
  try {
    tournament = await loadTournament();
    live = await loadTournamentState(tournament);
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Config error'), el('p', {}, String(err.message))));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · captain · game-state`;

  clear(app);
  const view = el('div', { class: 'view' });
  app.append(nav(), view);
  renderCaptain(view, tournament, live);
  mountOrganizer(tournament, live);
}

function nav() {
  return el('nav', { class: 'tabs' },
    el('a', { href: 'index.html', class: 'tab' }, 'Register'),
    el('a', { href: 'bracket.html', class: 'tab' }, 'Bracket'),
    el('span', { class: 'tab active' }, 'Captain view'));
}
