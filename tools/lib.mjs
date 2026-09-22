// game-state — I/O helpers shared by the organizer CLI and the tentative
// repo's workflows (intake.mjs, batch.mjs). Everything talks to GitHub through
// the `gh` CLI, which is preinstalled on Actions runners and authenticated
// there by GH_TOKEN. There is no other backend.
//
// Every file has a local override, so the whole pipeline can be rehearsed
// offline against scratch files with no way to touch a real repo:
//   TOURNAMENT_FILE, ROSTER_FILE, RESULTS_FILE   the public files
//   TENTATIVE_DIR                                 the private repo, as a folder
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const p = (...s) => join(ROOT, ...s);

export function gh(args, { input } = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(err.stderr || err.message).trim()}`);
  }
}

export function ghCheckAuth() {
  try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); }
  catch { throw new Error('gh is not authenticated. Run `gh auth login` first — publishing requires push access.'); }
}

export class Conflict extends Error {}

// Read a file with its sha. The GitHub API, never raw.githubusercontent.com:
// raw is CDN-cached for ~5 minutes, and a stale read written back would
// silently drop whatever changed in between.
export function ghRead(repo, path) {
  try {
    const j = JSON.parse(gh(['api', `repos/${repo}/contents/${path}`]));
    return { text: Buffer.from(j.content || '', 'base64').toString('utf8'), sha: j.sha };
  } catch (err) {
    if (/404|Not Found/.test(err.message)) return { text: '', sha: null };
    throw err;
  }
}
export const ghReadFile = (repo, path) => ghRead(repo, path).text;

// Write a file. With `sha` it is a compare-and-swap: if the file changed since
// that read, GitHub refuses and this throws Conflict, so nothing is overwritten
// blind. With sha === undefined it looks the current sha up (a plain overwrite),
// and with sha === null it only succeeds if the file does not exist yet.
export function ghWrite(repo, path, content, message, sha) {
  ghCheckAuth();
  if (sha === undefined) sha = ghRead(repo, path).sha;
  const args = [
    'api', `repos/${repo}/contents/${path}`, '-X', 'PUT',
    '-f', `message=${message}`,
    '-f', `content=${Buffer.from(content, 'utf8').toString('base64')}`,
  ];
  if (sha) args.push('-f', `sha=${sha}`);
  try { gh(args); }
  catch (err) {
    if (/409|422|does not match|sha/i.test(err.message)) throw new Conflict(`${path} changed while this command was running — nothing was written. Run it again.`);
    throw err;
  }
}

// ---- the public record ------------------------------------------------------------

const LOCAL = { 'roster.md': 'ROSTER_FILE', 'results.md': 'RESULTS_FILE', 'config/tournament.md': 'TOURNAMENT_FILE' };

// { text, sha } of a public file: tournament.md from the app repo, roster.md
// and results.md from the roster repo.
export function readPublic(repo, path) {
  const local = process.env[LOCAL[path]];
  if (local) return { text: existsSync(local) ? readFileSync(local, 'utf8') : '', sha: 'local' };
  return ghRead(repo, path);
}

// Publish a public file, compare-and-swap against the sha it was read with.
export function publish(repo, path, content, message, sha) {
  const local = process.env[LOCAL[path]];
  if (local) { writeFileSync(local, content); return; }
  ghWrite(repo, path, content, message, sha === 'local' ? undefined : sha);
}

// ---- the private tentative repo -----------------------------------------------------

const tentativeRepo = (t) => {
  const repo = process.env.TENTATIVE_REPO || t.tentativeRepo;
  if (!repo) throw new Error('config/tournament.md has no "Tentative repo" — see the README, "Set up the private repo".');
  return repo;
};

export function tentativeRead(t, path) {
  return tentativeReadSha(t, path).text;
}

export function tentativeReadSha(t, path) {
  const dir = process.env.TENTATIVE_DIR;
  if (dir) return { text: existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '', sha: 'local' };
  return ghRead(tentativeRepo(t), path);
}

// Overwrite an organizer-owned private file (admitted.md, accepted.md),
// compare-and-swap against the sha it was read at.
export function tentativeWrite(t, path, content, message, sha) {
  const dir = process.env.TENTATIVE_DIR;
  if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, path), content); return; }
  ghWrite(tentativeRepo(t), path, content, message, sha === 'local' ? undefined : sha);
}

// Create a NEW file. Used for inbox entries, whose names are unique, so two
// writers can never collide on one. GitHub can still refuse a create that
// races another commit to the branch, so it retries.
export function tentativeCreate(t, path, content, message) {
  const dir = process.env.TENTATIVE_DIR;
  if (dir) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), content); return; }
  for (let i = 0; ; i++) {
    try { return ghWrite(tentativeRepo(t), path, content, message, null); }
    catch (err) {
      if (!(err instanceof Conflict) || i >= 5) throw err;
      execFileSync('sleep', [String(0.3 + Math.random())]);
    }
  }
}

// Names of the files waiting in inbox/.
export function tentativeInbox(t) {
  const dir = process.env.TENTATIVE_DIR;
  if (dir) {
    const d = join(dir, 'inbox');
    return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.md')).sort().map((f) => `inbox/${f}`) : [];
  }
  try {
    const list = JSON.parse(gh(['api', `repos/${tentativeRepo(t)}/contents/inbox`]));
    return list.filter((f) => f.type === 'file' && f.name.endsWith('.md')).map((f) => `inbox/${f.name}`).sort();
  } catch (err) {
    if (/404|Not Found/.test(err.message)) return [];
    throw err;
  }
}

// Ask the tentative repo to run a workflow now (e.g. batch.yml).
export function triggerWorkflow(t, file) {
  gh(['workflow', 'run', file, '--repo', tentativeRepo(t)]);
}

export function tentativeRepoName(t) { return tentativeRepo(t); }
