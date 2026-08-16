// game-state — app entry. Renders the tournament from static config, computes
// the live phase from the clock, and routes between Status / Signup / Captain.

import { loadTournament, loadBracket } from './config.js';
import { resolvePhases, currentPhase, isSignupOpen, msToNextTransition, formatDuration } from './stateMachine.js';
import { el, clear, fmtDate } from './util.js';
import { renderSignup } from './signup.js';
import { renderCaptain } from './captain.js';

const app = document.getElementById('app');
let tournament, bracket, countdownTimer;

async function boot() {
  try {
    [tournament, bracket] = await Promise.all([loadTournament(), loadBracket()]);
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Config error'), el('p', {}, String(err.message))));
    return;
  }
  document.getElementById('brand-name').textContent = 'game-state';
  document.getElementById('tourney-name').textContent = tournament.name;
  document.getElementById('tagline').textContent = tournament.tagline || 'simple state-based tournaments';
  document.title = `${tournament.name} · game-state`;
  window.addEventListener('hashchange', route);
  route();
}

function nav() {
  const routes = [['#/status', 'Status'], ['#/signup', 'Sign up'], ['#/captain', 'Captain view']];
  const here = location.hash || '#/status';
  return el('nav', { class: 'tabs' }, routes.map(([href, label]) =>
    el('a', { href, class: 'tab' + (here.startsWith(href) ? ' active' : '') }, label)));
}

function route() {
  clearInterval(countdownTimer);
  clear(app);
  app.append(nav());
  const view = el('div', { class: 'view' });
  app.append(view);
  const hash = location.hash || '#/status';
  if (hash.startsWith('#/signup')) renderSignup(view, tournament);
  else if (hash.startsWith('#/captain')) renderCaptain(view, tournament, bracket);
  else renderStatus(view);
}

function renderStatus(root) {
  const now = new Date();
  const phases = resolvePhases(tournament, now);
  const cur = currentPhase(tournament, now);

  const countdown = el('span', { class: 'mono big' }, '—');
  const tick = () => {
    const ms = msToNextTransition(tournament, new Date());
    countdown.textContent = ms == null ? 'complete' : formatDuration(ms);
  };
  tick();
  countdownTimer = setInterval(tick, 1000);

  root.append(
    el('div', { class: 'card hero' },
      el('div', { class: 'muted' }, 'Current stage'),
      el('h2', { class: 'phase-title' }, cur ? cur.label : '—'),
      cur?.blurb ? el('p', { class: 'muted' }, cur.blurb) : null,
      cur && isFinite(cur.endMs)
        ? el('p', {}, 'Next stage in ', countdown)
        : el('p', { class: 'muted' }, cur?.kind === 'complete' ? 'The tournament is over.' : ''),
      isSignupOpen(tournament, now)
        ? el('a', { class: 'btn', href: '#/signup' }, 'Register your team →')
        : null,
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Roadmap'),
      el('ol', { class: 'timeline' }, phases.map((p) =>
        el('li', { class: `tl ${p.status}` },
          el('span', { class: 'dot' }),
          el('div', {},
            el('div', { class: 'row spread' },
              el('strong', {}, p.label),
              el('span', { class: 'badge ' + p.status }, p.status),
            ),
            el('div', { class: 'muted sm' }, fmtDate(p.start)),
            p.blurb ? el('div', { class: 'muted sm' }, p.blurb) : null,
          ),
        ))),
    ),
    el('p', { class: 'muted sm center' },
      'Everyone sees the same stage — the clock decides it. Your fixtures are private to your captain key.'),
    el('p', { class: 'center' },
      el('a', { class: 'btn ghost sm', href: 'public.html' }, 'View public bracket →')),
  );
}

boot();
