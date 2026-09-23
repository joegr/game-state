#!/usr/bin/env node
// game-state — STAGE CHANGE. The only code that writes the public record.
//
// Runs in the app repo's stage.yml, dispatched by the organizer (only people
// with write access can dispatch it), after the organizer has seen and
// confirmed the plan in the CLI. It:
//   1. re-plans the change from the live files (js/pipeline.js → planTransition),
//   2. refuses unless the plan's fingerprint is the one the organizer
//      confirmed. If anything moved in between, it stops rather than publish
//      something they didn't see,
//   3. writes results.md, then roster.md, then tournament.md LAST. Every
//      intermediate state is still a consistent record, so no reader ever
//      sees a stage that the files don't support yet.
//
// Inputs (env, from stage.yml): INPUT_ACTION, INPUT_EXPECT (fingerprint),
// INPUT_SEED (draw only), INPUT_LEAVE_PENDING ('true' | 'false').
import { appendFileSync } from 'node:fs';
import { formatConfigMd, formatRosterMd, formatResultsMd, formatAdmittedMd, formatAcceptedMd } from '../js/engine.js';
import { planTransition, formatEntry, entryName } from '../js/pipeline.js';
import { loadConfig, loadPublic, loadQueue, rand } from './context.mjs';
import { publish, tentativeWrite, tentativeCreate } from './lib.mjs';

export async function planFor(action, opts = {}) {
  const { tournament } = loadConfig();
  const { record, rosterSha, resultsSha } = loadPublic(tournament);
  const queue = loadQueue(tournament);
  const planned = await planTransition(action, {
    tournament, record, admitted: queue.admitted, accepted: queue.accepted, signups: queue.signups, inboxNames: queue.inboxNames,
  }, opts);
  return { ...planned, tournament, record, queue, rosterSha, resultsSha };
}

export function executePlan({ plan, tournament, queue, rosterSha, resultsSha }) {
  const msg = (what) => `stage ${plan.action}: ${what}`;
  if (plan.results) publish(tournament.rosterRepo, 'results.md', formatResultsMd(plan.results), msg('results'), resultsSha);
  if (plan.roster) publish(tournament.rosterRepo, 'roster.md', formatRosterMd(plan.roster), msg('roster'), rosterSha);
  if (plan.clearPrivate) {
    tentativeWrite(tournament, 'admitted.md', formatAdmittedMd([]), msg('clear admitted'), queue.admittedSha);
    tentativeWrite(tournament, 'accepted.md', formatAcceptedMd([]), msg('clear accepted'), queue.acceptedSha);
    const e = { kind: 'org-reset', at: new Date().toISOString() };
    tentativeCreate(tournament, entryName(e, rand()), formatEntry(e), msg('reset queue'));
  }
  // Config last: the stage only flips once everything it depends on is published.
  publish(tournament.appRepo, 'config/tournament.md', formatConfigMd(plan.config), msg('config'));
}

async function main() {
  const action = process.env.INPUT_ACTION;
  const expect = String(process.env.INPUT_EXPECT || '').trim();
  const opts = { seed: process.env.INPUT_SEED || undefined, leavePending: process.env.INPUT_LEAVE_PENDING === 'true' };
  const summary = (s) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n');
  // stage.yml names a step after this, and the organizer bar reads it.
  const verdict = (v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${v.replace(/[\r\n]+/g, ' ')}\n`);

  const p = await planFor(action, opts);
  if (!p.ok) { console.log(`::error title=REFUSED::${p.error}`); summary(`**Refused** — ${p.error}`); verdict(`REFUSED: ${p.error}`); process.exit(1); }
  if (!expect) { const m = 'No confirmed plan fingerprint. Stage changes start from the organizer bar (or the CLI), which shows the plan and asks you to confirm it.'; console.log(`::error title=REFUSED::${m}`); verdict(`REFUSED: ${m}`); process.exit(1); }
  if (p.fingerprint !== expect) {
    const m = `The plan changed after you confirmed it (confirmed ${expect}, now ${p.fingerprint}) — something was accepted or published in between. Nothing was written. Open the stage change again to see the new plan.`;
    console.log(`::error title=REFUSED::${m}`); summary(`**Refused** — ${m}`); verdict(`REFUSED: ${m}`); process.exit(1);
  }
  console.log(`Plan ${p.fingerprint} (${action}), as confirmed:`);
  for (const line of p.plan.summary) console.log(`  ${line}`);
  executePlan(p);
  console.log(`::notice title=PUBLISHED::${action} (${p.fingerprint}) published.`);
  verdict(`PUBLISHED: ${action} (${p.fingerprint}) — ${p.plan.summary[0]?.trim() || 'done'}`);
  summary(`**Published** \`${action}\` (${p.fingerprint})\n\n${p.plan.summary.map((l) => `- ${l.trim()}`).join('\n')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
