// game-state — config loading + live reconstruction.
//
// No JSON anywhere: config/tournament.md is the only durable state in THIS
// repo, and everything else public (the roster, the confirmed results, and
// therefore the whole bracket) is reconstructed here, in the browser, from
// the roster repo's markdown. This module IS the "database read" for every
// page.

import {
  parseConfigMd, parseRosterMd, parseResultsMd, buildDraw, applyResult, signupProgress,
} from './engine.js';

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

export function loadRosterMd(tournament) {
  return loadRepoText(`https://raw.githubusercontent.com/${tournament.rosterRepo}/main/roster.md`);
}

export function loadResultsMd(tournament) {
  return loadRepoText(`https://raw.githubusercontent.com/${tournament.rosterRepo}/main/results.md`);
}

// The one reconstruction every page needs. `state` is null pre-draw — the
// draw itself is just buildDraw(roster, tournament.drawSeed) replayed with
// every confirmed result, so nothing about the bracket needs to be published
// beyond the seed (in tournament.md) and the results ledger (in the roster
// repo). Rows are sorted by team code before the draw, same as
// formatRosterMd writes them — the shuffle depends on that order, not just
// the seed, so this MUST match how the roster was written.
export async function loadTournamentState(tournament) {
  const [rosterMd, resultsMd] = await Promise.all([loadRosterMd(tournament), loadResultsMd(tournament)]);
  const roster = parseRosterMd(rosterMd).sort((a, b) => a.fp.localeCompare(b.fp));
  const fps = roster.map((t) => t.fp);
  const progress = signupProgress(fps, tournament.teamCount, tournament.groupSize);

  if (!tournament.drawSeed) return { roster, progress, state: null };

  const state = buildDraw(fps, tournament.drawSeed);
  for (const r of parseResultsMd(resultsMd)) applyResult(state, r.matchId, r.winner);
  return { roster, progress, state };
}
