#!/usr/bin/env node
// game-state — BATCH. Folds every waiting inbox entry into the queue files,
// in filename (= chronological) order, re-checking every gate against the
// current public record, then removes the entries it processed.
//
// Runs in the tentative repo's batch.yml, one run at a time (a concurrency
// group), inside a checkout of that repo: TENTATIVE_DIR is the checkout, and
// the workflow commits whatever this changes as ONE commit. Only entries
// present at the start are processed. Anything intake writes meanwhile stays
// for the next batch, so nothing is lost and nothing is applied twice.
//
// Offline it works the same way on a scratch folder (TENTATIVE_DIR), which
// is how the organizer CLI runs a batch locally.
import { readFileSync, writeFileSync, unlinkSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatSignupsMd, formatScoresMd, formatAttemptsMd } from '../js/engine.js';
import { foldBatch, formatRejectedMd } from '../js/pipeline.js';
import { loadConfig, loadPublic, loadQueue } from './context.mjs';

export function runBatch({ quiet = false } = {}) {
  const dir = process.env.TENTATIVE_DIR;
  if (!dir) throw new Error('batch needs TENTATIVE_DIR (the tentative repo checkout).');
  const { tournament } = loadConfig();
  const { record } = loadPublic(tournament);
  const queue = loadQueue(tournament);

  const entries = queue.inboxNames.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
  if (!entries.length) {
    if (!quiet) console.log('Inbox empty — nothing to batch.');
    return { processed: 0, summary: 'nothing to batch' };
  }

  const out = foldBatch(entries, {
    record, signups: queue.signups, scores: queue.scores, attempts: queue.attempts,
    admitted: queue.admitted, accepted: queue.accepted, now: new Date().toISOString(),
  });

  writeFileSync(join(dir, 'signups.md'), formatSignupsMd(out.signups));
  writeFileSync(join(dir, 'scores.md'), formatScoresMd(out.scores));
  writeFileSync(join(dir, 'attempts.md'), formatAttemptsMd(out.attempts));
  if (out.rejected.length || existsSync(join(dir, 'rejected.md'))) {
    writeFileSync(join(dir, 'rejected.md'), formatRejectedMd([...queue.rejected, ...out.rejected]));
  }
  for (const { name } of entries) unlinkSync(join(dir, name));

  const a = out.applied;
  const summary = `batched ${entries.length}: +${a.signup} signup, +${a.score} score, +${a.attempt} wrong-PIN, ${a.organizer} organizer, ${out.rejected.length} rejected`;
  if (!quiet) {
    console.log(`${summary} (stage ${record.stage})`);
    for (const r of out.rejected) console.log(`  rejected ${r.entry}: ${r.reason}`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `message=${summary}\n`);
  return { processed: entries.length, summary, rejected: out.rejected };
}

if (import.meta.url === `file://${process.argv[1]}`) runBatch();
