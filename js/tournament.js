// game-state — the PUBLIC tournament view (the front door / landing page).
//
// This is what a visitor to user.github.io/game-state/ sees first: the current
// stage, a roadmap before the draw, and the anonymized bracket once matches
// begin. Everything here is reconstructed live from config/tournament.md
// (the organizer-owned spine) plus the roster repo's roster.md/results.md —
// there is no pre-baked snapshot in this repo. The per-captain view of the
// same public data lives on captain.html.

import { loadTournament, loadTournamentState } from './config.js';
import { buildPublic } from './engine.js';
import { currentPhase } from './stateMachine.js';
import { el, clear } from './util.js';
import { mountOrganizer } from './organizer.js';

const app = document.getElementById('app');
let tournament, progress, pub, state, live; // pub/state are null pre-draw

async function boot() {
  try {
    tournament = await loadTournament();
    live = await loadTournamentState(tournament);
    ({ progress, state } = live);
    pub = state && live.stage !== 'invalid' ? buildPublic(state, tournament.name, live.roster.length) : null;
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Config error'), el('p', {}, String(err.message))));
    return;
  }
  document.getElementById('tourney-name').textContent = tournament.name;
  document.title = `${tournament.name} · game-state`;
  render();
  mountOrganizer(tournament, live);
}

function teamChip(fp, { winner, dim } = {}) {
  if (!fp) return el('span', { class: 'team empty' }, 'bye');
  return el('span', { class: 'team' + (winner ? ' win' : '') + (dim ? ' out' : '') },
    el('span', { class: 'mono' }, fp), winner ? el('span', { class: 'check' }, '✓') : null);
}

// The hero follows the derived stage — the same one every workflow gates on.
function stageHeadline() {
  const cur = currentPhase(tournament);
  switch (live.stage) {
    case 'registration': return [cur?.label || 'Registration', 'good', 'OPEN', cur?.blurb];
    case 'closed': return ['Registration closed', 'upcoming', 'DRAW NEXT', 'The roster is published. The draw is next.'];
    case 'round': return [`Round ${live.round} · ${state.rounds[live.round - 1].label}`, 'good', 'LIVE', 'Captains submit scores for this round. The organizer publishes the whole round when it is complete.'];
    case 'complete': return ['Champion crowned', 'gold', 'COMPLETE', null];
    default: return ['Being corrected', 'upcoming', 'PAUSED', 'The organizer is correcting the tournament record. Everything resumes once it is fixed.'];
  }
}

function render() {
  clear(app);
  const drawn = !!pub;
  const complete = live.stage === 'complete';
  const [title, tone, badge, blurb] = stageHeadline();

  app.append(el('div', { class: 'card hero' },
    el('div', { class: 'row spread' },
      el('div', {},
        el('div', { class: 'muted' }, 'Current stage'),
        el('h2', { class: 'phase-title' }, title),
      ),
      el('span', { class: 'badge ' + tone }, badge),
    ),
    blurb ? el('p', { class: 'muted' }, blurb) : null,
    complete && pub?.champion
      ? el('p', { class: 'gold big' }, '🏆 Champion: ', el('span', { class: 'mono' }, pub.champion))
      : null,
    drawn && !complete
      ? el('p', { class: 'muted sm' }, `${pub.teamCount || 0} teams · ${pub.matchesDecided}/${pub.matchesTotal} matches decided`)
      : null,
    live.stage === 'registration'
      ? el('a', { class: 'btn', href: 'index.html' }, 'Register your team →')
      : null,
  ));

  if (drawn) renderBracket(); else renderRoadmap();

  app.append(el('p', { class: 'muted sm center' },
    'Anonymized public bracket · captains sign in and submit scores in the ',
    el('a', { href: 'captain.html' }, 'Captain view'), '.'));
}

function renderBracket() {
  const pct = pub.matchesTotal ? Math.round((pub.matchesDecided / pub.matchesTotal) * 100) : 0;
  // .filter(Boolean): native Node.append renders a null child as the text
  // "null", unlike the el() helper, which skips it.
  app.append(...[
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
      ))),
  ].filter(Boolean));
}

// Before the draw: an ordered list of stages relative to the current one — no
// dates, since nothing here is clock-driven. Advancing past a stage means the
// organizer pushes a new activePhase via `gh`; this list just reflects that.
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

  renderField();
}

// The public roster is only published at a stage change (when registration
// closes, and at the draw), so while registration is open this shows the
// room there is, not a live count. Registrations are private until then.
function renderField() {
  if (live.stage === 'registration' && !live.roster.length) {
    app.append(el('div', { class: 'card' },
      el('h3', {}, 'The field'),
      el('p', { class: 'muted sm' }, `Up to ${progress.capacity} teams. The organizer reviews registrations and publishes the roster when registration closes.`)));
    return;
  }
  if (!live.roster.length) return;
  app.append(el('div', { class: 'card' },
    el('h3', {}, `The field · ${live.roster.length} team${live.roster.length === 1 ? '' : 's'}`),
    el('div', { class: 'row' }, live.roster.map((t) => el('code', { class: 'mono chip' }, t.fp)))));
}

boot();
