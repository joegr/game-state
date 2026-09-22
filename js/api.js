// game-state — how a captain's submission reaches GitHub Actions.
//
// The browser dispatches intake.yml in the private tentative repo, using a
// token that can do nothing but start workflows there and read their check
// results. It cannot read or write a single file. deploy.yml writes that token
// into js/submit-config.js at deploy time, so it is never committed. Then
// the page waits for the run named after a random receipt, and reads its
// ACCEPTED / REJECTED annotation, which is the intake's verdict.
//
// An Actions run takes roughly 20–60 seconds end to end.

import { SUBMIT } from './submit-config.js';

const API = 'https://api.github.com';
const headers = () => ({
  Authorization: `Bearer ${SUBMIT.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

export const submitReady = () => !!(SUBMIT && SUBMIT.repo && SUBMIT.token);

const receiptId = () => {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(b, (x) => (x % 36).toString(36)).join('');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// kind: 'signup' | 'score'. fields: flat strings. onProgress(label) is
// called as the run moves along. Resolves { accepted, message } or
// { accepted: false, error: true, message } if the service itself failed.
export async function submit(kind, fields, onProgress = () => {}) {
  if (!submitReady()) return { accepted: false, error: true, message: 'Submissions are not connected yet — the organizer needs to finish setup.' };
  const receipt = receiptId();
  const workflow = `${API}/repos/${SUBMIT.repo}/actions/workflows/intake.yml`;

  onProgress('Sending…');
  let res;
  try {
    res = await fetch(`${workflow}/dispatches`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { receipt, kind, payload: new URLSearchParams(fields).toString() } }),
    });
  } catch { return { accepted: false, error: true, message: 'Could not reach GitHub. Check your connection and try again.' }; }
  if (res.status !== 204) return { accepted: false, error: true, message: `GitHub refused the submission (${res.status}). Tell the organizer.` };

  // Find our run by its name, then wait for it to finish.
  const deadline = Date.now() + 3 * 60 * 1000;
  let run = null;
  while (Date.now() < deadline) {
    await sleep(run ? 4000 : 2500);
    try {
      const list = await (await fetch(`${workflow}/runs?event=workflow_dispatch&per_page=30`, { headers: headers(), cache: 'no-store' })).json();
      run = (list.workflow_runs || []).find((r) => r.display_title === `intake ${receipt}` || r.name === `intake ${receipt}`) || run;
    } catch { /* transient — keep polling */ }
    if (!run) { onProgress('Waiting for GitHub to pick it up…'); continue; }
    if (run.status !== 'completed') { onProgress(run.status === 'in_progress' ? 'Checking your submission…' : 'Queued at GitHub…'); continue; }
    return verdict(run);
  }
  return { accepted: false, error: true, message: 'GitHub is taking unusually long. Your submission may still land — check back in a few minutes before resubmitting.' };
}

async function verdict(run) {
  try {
    const jobs = await (await fetch(run.jobs_url, { headers: headers(), cache: 'no-store' })).json();
    const job = (jobs.jobs || [])[0];
    if (job?.check_run_url) {
      const notes = await (await fetch(`${job.check_run_url}/annotations`, { headers: headers(), cache: 'no-store' })).json();
      const hit = (Array.isArray(notes) ? notes : []).find((a) => a.title === 'ACCEPTED' || a.title === 'REJECTED');
      if (hit) return { accepted: hit.title === 'ACCEPTED', message: hit.message };
    }
  } catch { /* fall through */ }
  return { accepted: false, error: true, message: run.conclusion === 'success'
    ? 'Your submission ran, but its result could not be read. Check with the organizer before resubmitting.'
    : 'The submission service failed. Try again in a minute; if it keeps failing, tell the organizer.' };
}
