// game-state — shared helpers for the organizer CLI.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const p = (...s) => join(ROOT, ...s);

// ---- gh CLI-backed publishing ------------------------------------------------
//
// Stage progression and confirmed results are published straight to GitHub
// via `gh api`, not by asking the organizer to hand-commit a downloaded file.
// This makes "who can run an authenticated `gh` against these repos" the real
// authorization boundary — there is no key anymore, so this IS the gate.

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`gh ${args[0]} failed: ${err.stderr || err.message}`);
  }
}

export function ghCheckAuth() {
  try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); }
  catch { throw new Error('gh is not authenticated. Run `gh auth login` first — publishing requires push access to the repo.'); }
}

function ghFileSha(repo, path) {
  try { return gh(['api', `repos/${repo}/contents/${path}`, '--jq', '.sha']).trim(); }
  catch { return null; } // file doesn't exist yet
}

// Commits `content` to `path` in `repo` on `branch` via the Contents API — no
// local clone of `repo` required. Overwrites if the file exists.
export function ghPutFile(repo, path, content, message, branch = 'main') {
  ghCheckAuth();
  const sha = ghFileSha(repo, path);
  const args = [
    'api', `repos/${repo}/contents/${path}`, '-X', 'PUT',
    '-f', `message=${message}`,
    '-f', `content=${Buffer.from(content, 'utf8').toString('base64')}`,
    '-f', `branch=${branch}`,
  ];
  if (sha) args.push('-f', `sha=${sha}`);
  gh(args);
}

// The public roster (and results ledger) live in a separate, public repo (see
// config/tournament.json → rosterRepo), fetched at runtime — no submodule, no
// local copy to keep in sync. An env override reads a local file instead, for
// local testing without network access or a real roster repo.
async function fetchRepoFile(repo, path, envOverride) {
  if (envOverride) {
    const { readFileSync, existsSync } = await import('node:fs');
    if (!existsSync(envOverride)) return ''; // treat as empty/new
    return readFileSync(envOverride, 'utf8');
  }
  const url = `https://raw.githubusercontent.com/${repo}/main/${path}`;
  const res = await fetch(url);
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

export function fetchRosterMd(tournament) {
  return fetchRepoFile(tournament.rosterRepo, 'roster.md', process.env.ROSTER_FILE);
}

export function fetchResultsMd(tournament) {
  return fetchRepoFile(tournament.rosterRepo, 'results.md', process.env.RESULTS_FILE);
}
