// game-state — captain.html app: anonymous Sign-up + the Captain view. The
// public tournament/status view lives on the landing page (index.html /
// js/tournament.js); this page is the one that holds a team's own token.

import { loadTournament, loadBracket, loadPublic } from './config.js';
import { el, clear } from './util.js';
import { renderSignup } from './signup.js';
import { renderCaptain } from './captain.js';

const app = document.getElementById('app');
let tournament, bracket, pub;

async function boot() {
  try {
    [tournament, bracket, pub] = await Promise.all([loadTournament(), loadBracket(), loadPublic()]);
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Config error'), el('p', {}, String(err.message))));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · captain · game-state`;
  window.addEventListener('hashchange', route);
  route();
}

function nav() {
  const routes = [['#/signup', 'Sign up'], ['#/captain', 'Captain view']];
  const here = location.hash || '#/signup';
  return el('nav', { class: 'tabs' },
    el('a', { href: 'bracket.html', class: 'tab' }, '← Bracket'),
    routes.map(([href, label]) =>
      el('a', { href, class: 'tab' + (here.startsWith(href) ? ' active' : '') }, label)));
}

function route() {
  clear(app);
  app.append(nav());
  const view = el('div', { class: 'view' });
  app.append(view);
  const hash = location.hash || '#/signup';
  if (hash.startsWith('#/captain')) renderCaptain(view, tournament, bracket);
  else renderSignup(view, tournament, pub);
}

boot();
