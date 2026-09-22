// game-state — the PUBLIC tournament view (the front door / landing page).
//
// This is what a visitor to user.github.io/game-state/ sees first: the current
// stage, a roadmap before the draw, and the anonymized bracket once matches
// begin. Everything here is public and anonymous — the private "captain
// perspective" lives on captain.html.

import { loadTournament } from './config.js';
import { currentPhase, isSignupOpen } from './stateMachine.js';
import { el, clear } from './util.js';

const app = document.getElementById('app');
let tournament, pub;

async function loadPublic() {
  try {
    const res = await fetch(new URL('config/public.json', document.baseURI).href, { cache: 'no-cache' });
    return await res.json();
  } catch { return { rounds: [], status: 'registration' }; }
}

async function boot() {
  try {
    [tournament, pub] = await Promise.all([loadTournament(), loadPublic()]);
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Config error'), el('p', {}, String(err.message))));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · game-state`;
  render();
}

function teamChip(fp, { winner, dim } = {}) {
  if (!fp) return el('span', { class: 'team empty' }, 'bye');
  return el('span', { class: 'team' + (winner ? ' win' : '') + (dim ? ' out' : '') },
    el('span', { class: 'mono' }, fp), winner ? el('span', { class: 'check' }, '✓') : null);
}

function render() {
  clear(app);
  const cur = currentPhase(tournament);
  const drawn = pub.rounds && pub.rounds.length > 0;
  const complete = pub.status === 'complete';

  app.append(el('div', { class: 'card hero' },
    el('div', { class: 'row spread' },
      el('div', {},
        el('div', { class: 'muted' }, 'Current stage'),
        el('h2', { class: 'phase-title' }, complete ? 'Champion crowned' : (cur ? cur.label : '—')),
      ),
      el('span', { class: 'badge ' + (complete ? 'gold' : 'good') }, complete ? 'COMPLETE' : 'LIVE'),
    ),
    cur?.blurb && !complete ? el('p', { class: 'muted' }, cur.blurb) : null,
    complete && pub.champion
      ? el('p', { class: 'gold big' }, '🏆 Champion: ', el('span', { class: 'mono' }, pub.champion))
      : null,
    drawn && !complete
      ? el('p', { class: 'muted sm' }, `${pub.teamCount || 0} teams · ${pub.matchesDecided}/${pub.matchesTotal} matches decided`)
      : null,
    isSignupOpen(tournament)
      ? el('a', { class: 'btn', href: 'index.html' }, 'Register your team →')
      : null,
  ));

  if (drawn) renderBracket(); else renderRoadmap();

  app.append(el('p', { class: 'muted sm center' },
    'Anonymized public bracket · registered captains track their own fixtures in the ',
    el('a', { href: 'captain.html#/captain' }, 'Captain view'), '.'));
}

function renderBracket() {
  const pct = pub.matchesTotal ? Math.round((pub.matchesDecided / pub.matchesTotal) * 100) : 0;
  app.append(
    pub.seed ? el('p', { class: 'muted sm' }, 'Draw seed ', el('code', { class: 'mono' }, pub.seed), ' — a reproducible, seeded random draw.') : null,
    pub.matchesTotal ? el('div', { class: 'progress' }, el('div', { class: 'bar', style: `width:${pct}%` })) : null,
    el('div', { class: 'bracket' }, pub.rounds.map((round) =>
      el('div', { class: 'col' },
        el('div', { class: 'col-head' }, el('strong', {}, round.label)),
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

// Before the draw: an ordered list of stages relative to the current one — no
// dates, since nothing here is clock-driven. Advancing past a stage means the
// organizer edits `activePhase` and pushes; this list just reflects that.
function renderRoadmap() {
  const cur = currentPhase(tournament);
  const curIdx = tournament.phases.findIndex((p) => p.id === cur?.id);
  app.append(el('div', { class: 'card' },
    el('h3', {}, 'Roadmap'),
    el('ol', { class: 'timeline' }, tournament.phases.map((p, i) => {
      const status = i < curIdx ? 'past' : i === curIdx ? 'active' : 'upcoming';
      return el('li', { class: `tl ${status}` },
        el('span', { class: 'dot' }),
        el('div', {},
          el('div', { class: 'row spread' },
            el('strong', {}, p.label),
            el('span', { class: 'badge ' + status }, status),
          ),
          p.blurb ? el('div', { class: 'muted sm' }, p.blurb) : null,
        ),
      );
    })),
  ));
}

boot();
