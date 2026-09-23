// game-state — config loading + live reconstruction.
//
// No JSON anywhere: config/tournament.md is the only durable state in THIS
// repo, and everything else public (the roster, the confirmed results, and
// therefore the whole bracket) is reconstructed here, in the browser, from
// the roster repo's markdown. This module IS the "database read" for every
// page.

import { parseConfigMd, reconstruct } from './engine.js';

async function loadRepoText(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? await res.text() : '';
  } catch {
    return ''; // offline, or the remote repo is unreachable — degrade, don't crash
  }
}

export async function loadTournament() {
  const path = new URL('config/tournament.md', document.baseURI).href;
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return parseConfigMd(await res.text());
}

// `Roster repo` is normally owner/name on GitHub; a full http(s) URL is used
// as a base instead (the local dev harness, tools/dev.mjs, relies on this).
function rosterFileUrl(tournament, path) {
  const repo = tournament.rosterRepo || '';
  return /^https?:\/\//.test(repo)
    ? `${repo.replace(/\/+$/, '')}/${path}`
    : `https://raw.githubusercontent.com/${repo}/main/${path}`;
}

export function loadRosterMd(tournament) {
  return loadRepoText(rosterFileUrl(tournament, 'roster.md'));
}

export function loadResultsMd(tournament) {
  return loadRepoText(rosterFileUrl(tournament, 'results.md'));
}

// The one reconstruction, the same function the intake, batch and stage
// workflows and the organizer CLI use (engine.js → reconstruct). Returns the
// record: { roster, results, progress, state, stage, round, errors }. `stage`
// drives every page: what is offered, and what is refused.
//
// raw.githubusercontent.com caches for about 5 minutes, so a page can lag a
// stage change by that much. The workflows read through the API and are
// authoritative, so a stale page can offer something, but it can never
// make something invalid happen.
export async function loadTournamentState(tournament) {
  const [rosterMd, resultsMd] = await Promise.all([loadRosterMd(tournament), loadResultsMd(tournament)]);
  return reconstruct(tournament, rosterMd, resultsMd);
}

// The freshest public read, for the public bracket: the three files through
// api.github.com (about a minute behind, instead of the site's ten and raw's
// five), falling back to the cached copies if the API refuses. `no-cache` makes
// the browser revalidate with the stored ETag, and GitHub doesn't count an
// unchanged (304) answer against the 60-requests-an-hour anonymous limit, so
// polling costs almost nothing. Returns { tournament, record, fingerprint }.
async function apiText(repo, path) {
  if (!repo || /^https?:\/\//.test(repo)) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-cache',
    });
    if (res.status === 404) return '';
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

export async function loadLive(siteTournament) {
  const cfg = await apiText(siteTournament.appRepo, 'config/tournament.md');
  const tournament = cfg ? parseConfigMd(cfg) : siteTournament;
  const [roster, results] = await Promise.all([
    apiText(tournament.rosterRepo, 'roster.md'), apiText(tournament.rosterRepo, 'results.md'),
  ]);
  const rosterMd = roster ?? await loadRosterMd(tournament);
  const resultsMd = results ?? await loadResultsMd(tournament);
  return {
    tournament,
    record: reconstruct(tournament, rosterMd, resultsMd),
    fingerprint: [cfg ?? '', rosterMd, resultsMd].join('\u0000'),
  };
}
