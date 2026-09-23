// game-state — the organizer's browser client for the GitHub API.
//
// Used only by the organizer bar, with the organizer's own fine-grained token,
// kept in this browser. Everything goes through api.github.com (never the
// 5-minute-cached raw host), so what the bar reads is current, and every
// overwrite is a compare-and-swap against the sha it was read at.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export class Conflict extends GitHubError {}

const utf8ToB64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function client(token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(`${API}/${path}`, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch { throw new GitHubError('Could not reach GitHub.', 0); }
    if (res.status === 409 || (res.status === 422 && method === 'PUT')) throw new Conflict('Changed on GitHub since it was read — nothing was written. Reload and try again.', res.status);
    if (res.status === 401) throw new GitHubError('GitHub refused the organizer token (expired or revoked).', 401);
    if (res.status === 403 || res.status === 404) {
      const msg = (await res.json().catch(() => ({}))).message || '';
      if (res.status === 404 && method === 'GET') return null;
      throw new GitHubError(`GitHub refused ${method} ${path.split('?')[0]} (${res.status}${msg ? `: ${msg}` : ''}). The organizer token may be missing a permission.`, res.status);
    }
    if (!res.ok) throw new GitHubError(`GitHub error ${res.status} on ${path.split('?')[0]}.`, res.status);
    return res.status === 204 ? true : res.json();
  }

  return {
    // { text, sha } — sha null and text '' if the file does not exist.
    async read(repo, path) {
      const j = await call('GET', `repos/${repo}/contents/${path}`);
      return j ? { text: b64ToUtf8(j.content || ''), sha: j.sha } : { text: '', sha: null };
    },
    async list(repo, dir) {
      const j = await call('GET', `repos/${repo}/contents/${dir}`);
      return Array.isArray(j) ? j.filter((f) => f.type === 'file').map((f) => `${dir}/${f.name}`).sort() : [];
    },
    // Compare-and-swap: sha of the version read, or null to create only.
    async write(repo, path, content, message, sha) {
      return call('PUT', `repos/${repo}/contents/${path}`, { message, content: utf8ToB64(content), ...(sha ? { sha } : {}) });
    },
    // A brand-new, uniquely named file. GitHub can refuse a create that races
    // another commit to the branch, so it retries.
    async create(repo, path, content, message) {
      for (let i = 0; ; i++) {
        try { return await call('PUT', `repos/${repo}/contents/${path}`, { message, content: utf8ToB64(content) }); }
        catch (e) { if (!(e instanceof Conflict) || i >= 5) throw e; await sleep(300 + Math.random() * 700); }
      }
    },
    dispatch(repo, workflow, inputs) {
      return call('POST', `repos/${repo}/actions/workflows/${workflow}/dispatches`, { ref: 'main', inputs });
    },
    // Find a dispatched run by its run-name and follow it until it finishes.
    // onStatus(label) is called as it moves along. Resolves the run, plus the
    // name of any step titled "PUBLISHED: …" / "REFUSED: …".
    async follow(repo, workflow, runName, onStatus = () => {}, timeoutMs = 10 * 60 * 1000) {
      const deadline = Date.now() + timeoutMs;
      let run = null;
      while (Date.now() < deadline) {
        await sleep(run ? 4000 : 2500);
        try {
          const list = await call('GET', `repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=20`);
          run = (list?.workflow_runs || []).find((r) => r.display_title === runName) || run;
        } catch { /* transient */ }
        if (!run) { onStatus('Waiting for GitHub to start it…'); continue; }
        if (run.status !== 'completed') {
          onStatus({ waiting: 'Waiting for your approval on GitHub (publish environment)…', queued: 'Queued at GitHub…', in_progress: 'Running…' }[run.status] || `${run.status}…`);
          continue;
        }
        const jobs = await call('GET', `repos/${repo}/actions/runs/${run.id}/jobs`).catch(() => null);
        const verdict = (jobs?.jobs?.[0]?.steps || []).map((s) => s.name).find((n) => /^(PUBLISHED|REFUSED): /.test(n));
        return { run, verdict, url: run.html_url };
      }
      return { run, verdict: null, timeout: true, url: run?.html_url };
    },
  };
}
