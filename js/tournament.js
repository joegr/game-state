// game-state — the PUBLIC bracket page.
//
// What anyone sees: the current stage, a roadmap from registration to the
// champion, the drawn bracket (js/bracketView.js, d3), and a card for every
// team. All of it is reconstructed from the published record, the same
// reconstruct() every workflow gates on. It is read through the GitHub API
// (js/config.js → loadLive) and re-read every minute while the page is open,
// so it follows the tournament live. Nothing private is ever shown.

import { loadTournament, loadLive } from './config.js';
import { roundLabel } from './engine.js';
import { el, clear } from './util.js';
import { mountOrganizer } from './organizer.js';

const app = document.getElementById('app');
const REFRESH_MS = 60 * 1000;
let siteTournament = null;
let live = null;          // { tournament, record, fingerprint }
let checkedAt = null;
let bracket = null;       // { highlight }
let traced = null;        // the team being traced, kept across refreshes

async function boot() {
  try {
    siteTournament = await loadTournament();
    live = await loadLive(siteTournament);
    checkedAt = new Date();
  } catch (err) {
    app.append(el('div', { class: 'card danger' }, el('h2', {}, 'Could not load the tournament'), el('p', {}, String(err.message))));
    return;
  }
  render();
  mountOrganizer(siteTournament);
  setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(drawBracketNow, 150); });
}

async function refresh() {
  if (document.hidden) return;
  try {
    const next = await loadLive(siteTournament);
    checkedAt = new Date();
    if (next.fingerprint !== live.fingerprint) { live = next; render(); }
    else updateStamp();
  } catch { /* keep showing what we have */ }
}

// ---- the stage ---------------------------------------------------------------

function stageHeadline(t, rec) {
  const cur = t.phases.find((p) => p.id === t.activePhase);
  switch (rec.stage) {
    case 'registration': return [cur?.label || 'Registration', 'good', 'OPEN', cur?.blurb || 'Captains register their team. Entries are anonymous.'];
    case 'closed': return ['Registration closed', 'upcoming', 'DRAW NEXT', `${rec.roster.length} teams are in. The draw is next.`];
    case 'round': return [`${rec.state.rounds[rec.round - 1].label}`, 'good', `ROUND ${rec.round} · LIVE`, 'Captains submit scores for this round. The organizer publishes the whole round once every match is decided.'];
    case 'complete': return ['Champion crowned', 'gold', 'COMPLETE', null];
    default: return ['Being corrected', 'upcoming', 'PAUSED', 'The organizer is correcting the tournament record. Everything resumes once it is fixed.'];
  }
}

function render() {
  const { tournament: t, record: rec } = live;
  document.getElementById('tourney-name').textContent = t.name;
  document.title = `${t.name} · game-state`;
  clear(app);

  const [title, tone, badge, blurb] = stageHeadline(t, rec);
  const decided = rec.state ? rec.state.rounds.reduce((n, r) => n + r.matches.filter((m) => m.winner && m.a && m.b).length, 0) : 0;
  const total = rec.state ? rec.state.rounds.reduce((n, r) => n + r.matches.filter((m) => !(r === rec.state.rounds[0] && (!m.a || !m.b))).length, 0) : 0;
  app.append(el('div', { class: 'card hero' },
    el('div', { class: 'row spread' },
      el('div', {}, el('div', { class: 'muted' }, 'Current stage'), el('h2', { class: 'phase-title' }, title)),
      el('span', { class: 'badge ' + tone }, badge)),
    blurb ? el('p', { class: 'muted' }, blurb) : null,
    rec.stage === 'complete' && rec.state?.champion
      ? el('p', { class: 'champion-line' }, '🏆 ', el('span', { class: 'mono' }, rec.state.champion), ' wins ', t.name) : null,
    rec.state ? el('p', { class: 'muted sm' }, `${rec.roster.length} teams · ${decided} of ${total} matches decided`) : null,
    rec.state && total ? el('div', { class: 'progress' }, el('div', { class: 'bar', style: `width:${Math.round((decided / total) * 100)}%` })) : null,
    rec.stage === 'registration' ? el('a', { class: 'btn', href: 'index.html' }, 'Register your team →') : null,
    el('p', { class: 'muted sm live-stamp' })));
  updateStamp();

  app.append(roadmap(t, rec));

  if (rec.state && rec.stage !== 'invalid') {
    app.append(el('div', { class: 'card bracket-card' },
      el('div', { class: 'row spread' },
        el('h3', {}, 'Bracket'),
        el('span', { class: 'muted sm' }, 'Hover or tap a team to trace its path')),
      el('div', { class: 'bracket-frame', id: 'bracket' }),
      el('p', { class: 'muted sm' }, 'Draw seed ', el('code', { class: 'mono' }, t.drawSeed), ' — anyone can reproduce this draw from the published roster and the seed.')));
    drawBracketNow();
  }

  app.append(teamCards(rec));
  app.append(el('p', { class: 'muted sm center' },
    'Anonymized public bracket · captains sign in and submit scores in the ', el('a', { href: 'captain.html' }, 'Captain view'), '.'));
}

function updateStamp() {
  const s = app.querySelector('.live-stamp');
  if (s && checkedAt) s.textContent = `● Live · checked ${checkedAt.toLocaleTimeString()} · refreshes every minute`;
}

async function drawBracketNow() {
  const host = document.getElementById('bracket');
  if (!host || !live?.record.state) return;
  try {
    const { drawBracket } = await import('./bracketView.js');
    bracket = drawBracket(host, live.record, { onTeam: (fp) => { traced = fp; markCard(fp); } });
    if (traced) bracket.highlight(traced);
  } catch (e) {
    host.replaceChildren(el('p', { class: 'muted sm' }, `The bracket drawing could not load (${e.message}). The team cards below are up to date.`));
  }
}

// ---- roadmap: registration → draw → each round → champion ------------------------------

function roadmap(t, rec) {
  const rounds = rec.state
    ? rec.state.rounds.map((r) => ({ label: r.label, matches: r.matches }))
    : projectedRounds(rec.stage === 'closed' && rec.roster.length >= 2 ? rec.roster.length : t.teamCount);
  const steps = [
    { label: 'Registration', sub: rec.stage === 'registration' ? 'Open now' : `${rec.roster.length} teams in` },
    { label: 'The draw', sub: rec.state ? 'Seeded & published' : rec.stage === 'closed' ? 'Next' : 'After registration' },
    ...rounds.map((r) => {
      if (!r.matches) return { label: r.label, sub: 'Projected' };
      const played = r.matches.filter((m) => m.a && m.b);
      const done = played.filter((m) => m.winner).length;
      return { label: r.label, sub: played.length ? `${done}/${played.length} decided` : `${r.matches.length} match${r.matches.length === 1 ? '' : 'es'}` };
    }),
    { label: 'Champion', sub: rec.state?.champion ? `🏆 ${rec.state.champion}` : 'To be decided' },
  ];
  // Complete: every step is reached, and the last one is the trophy.
  const at = rec.stage === 'registration' ? 0 : rec.stage === 'closed' ? 1 : rec.stage === 'round' ? 1 + rec.round : rec.stage === 'complete' ? steps.length : -1;
  const last = steps.length - 1;
  return el('div', { class: 'card' },
    el('h3', {}, 'Roadmap'),
    el('ol', { class: 'stepper' }, steps.map((s, i) => el('li', { class: `step-item ${i < at ? 'past' : i === at ? 'active' : 'upcoming'}${i === last && rec.stage === 'complete' ? ' crowned' : ''}` },
      el('span', { class: 'step-dot' }, i === last && rec.stage === 'complete' ? '🏆' : i < at ? '✓' : String(i + 1)),
      el('span', { class: 'step-label' }, s.label),
      el('span', { class: 'step-sub muted sm' }, s.sub)))),
    rec.stage === 'invalid' ? el('p', { class: 'muted sm' }, 'Paused while the organizer corrects the record.') : null);
}

function projectedRounds(n) {
  let size = 2; while (size < n) size *= 2;
  const out = [];
  for (let s = size; s >= 2; s /= 2) out.push({ label: roundLabel(s) });
  return out;
}

// ---- team cards --------------------------------------------------------------------------

function teamStatus(rec, fp) {
  const s = rec.state;
  if (!s) return { tone: 'upcoming', label: rec.stage === 'closed' ? 'In · awaiting the draw' : 'Registered', detail: null, order: 1 };
  if (s.champion === fp) return { tone: 'gold', label: 'Champion', detail: `Won all ${s.rounds.length} rounds`, order: 0 };
  const res = new Map(rec.results.map((r) => [r.matchId, r]));
  let wins = 0;
  for (let r = 0; r < s.rounds.length; r++) {
    for (const m of s.rounds[r].matches) {
      if (m.a !== fp && m.b !== fp) continue;
      const opp = m.a === fp ? m.b : m.a;
      if (m.winner && m.winner !== fp) {
        const x = res.get(m.id);
        return { tone: 'out', label: `Out · ${s.rounds[r].label}`, detail: `Lost to ${m.winner}${x ? ` ${x.scoreLoser}–${x.scoreWinner}` : ''}`, order: 3 + (s.rounds.length - r) / 100, wins };
      }
      if (m.winner === fp) { if (opp) wins++; continue; }
      const live = rec.stage === 'round' && rec.round === r + 1;
      return opp
        ? { tone: live ? 'good' : 'upcoming', label: live ? `Playing · ${s.rounds[r].label}` : `Next · ${s.rounds[r].label}`, detail: `vs ${opp} (${m.id})`, order: 1, wins }
        : { tone: 'upcoming', label: `Through to ${s.rounds[r].label}`, detail: 'Opponent to be decided', order: 2, wins };
    }
  }
  return { tone: 'upcoming', label: 'Waiting', detail: null, order: 2, wins };
}

function teamCards(rec) {
  if (!rec.roster.length) {
    return el('div', { class: 'card' }, el('h3', {}, 'Teams'),
      el('p', { class: 'muted sm' }, `Up to ${rec.progress.capacity} teams. The organizer reviews registrations and publishes the field when registration closes.`));
  }
  const teams = rec.roster.map((t) => ({ fp: t.fp, ...teamStatus(rec, t.fp) }))
    .sort((a, b) => a.order - b.order || a.fp.localeCompare(b.fp));
  return el('div', { class: 'card' },
    el('h3', {}, `Teams · ${teams.length}`),
    el('div', { class: 'team-grid' }, teams.map((t) => el('button', {
      class: `team-card ${t.tone}`, 'data-fp': t.fp, type: 'button',
      onclick: () => {
        traced = traced === t.fp ? null : t.fp;
        markCard(traced);
        if (bracket) { bracket.highlight(traced); if (traced) document.getElementById('bracket')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      },
    },
      el('span', { class: 'team-code mono' }, t.fp),
      el('span', { class: `badge ${t.tone === 'out' ? '' : t.tone}` }, t.label),
      t.detail ? el('span', { class: 'muted sm' }, t.detail) : null,
      t.wins ? el('span', { class: 'muted sm' }, `${t.wins} win${t.wins === 1 ? '' : 's'}`) : null))));
}

function markCard(fp) {
  for (const c of app.querySelectorAll('.team-card')) c.classList.toggle('traced', !!fp && c.dataset.fp === fp);
}

boot();
