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
