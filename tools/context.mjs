// game-state — load the tournament the same way everywhere on the Node side:
// the organizer CLI and the tentative repo's intake and batch workflows.
import { readFileSync } from 'node:fs';
import {
  parseConfigMd, reconstruct, parseSignupsMd, parseScoresMd, parseAttemptsMd, parseAdmittedMd, parseAcceptedMd,
} from '../js/engine.js';
import { parseRejectedMd } from '../js/pipeline.js';
import { p, ghReadFile, readPublic, tentativeRead, tentativeReadSha, tentativeInbox } from './lib.mjs';

// The PUBLISHED tournament.md is the record, so that is what gets read. The
// local copy only supplies the app repo's name (a checkout can lag behind
// after `stage` or `draw`). TOURNAMENT_FILE swaps in a scratch file.
export function loadConfig() {
  const localPath = process.env.TOURNAMENT_FILE || p('config', 'tournament.md');
  const local = parseConfigMd(readFileSync(localPath, 'utf8'));
  if (process.env.TOURNAMENT_FILE) return { tournament: local, sha: 'local' };
  const appRepo = process.env.APP_REPO || local.appRepo;
  try {
    const text = ghReadFile(appRepo, 'config/tournament.md');
    if (text) return { tournament: parseConfigMd(text), sha: undefined };
  } catch (e) {
    if (process.env.GITHUB_ACTIONS) throw e; // a workflow must never act on a stale copy
    console.error(`(could not read the published tournament.md — using the local copy: ${e.message.split('\n')[0]})`);
  }
  return { tournament: local, sha: undefined };
}

// The public record, reconstructed and checked. Also returns the shas the
// files were read at, so a publish can refuse if anything moved underneath.
export function loadPublic(tournament) {
  const roster = readPublic(tournament.rosterRepo, 'roster.md');
  const results = readPublic(tournament.rosterRepo, 'results.md');
  return { record: reconstruct(tournament, roster.text, results.text), rosterSha: roster.sha, resultsSha: results.sha };
}

// The private side. Batch-owned: signups, scores, attempts, rejected, inbox.
// Organizer-owned: admitted, accepted (with shas, for compare-and-swap writes).
export function loadQueue(tournament) {
  const admitted = tentativeReadSha(tournament, 'admitted.md');
  const accepted = tentativeReadSha(tournament, 'accepted.md');
  return {
    signups: parseSignupsMd(tentativeRead(tournament, 'signups.md')),
    scores: parseScoresMd(tentativeRead(tournament, 'scores.md')),
    attempts: parseAttemptsMd(tentativeRead(tournament, 'attempts.md')),
    rejected: parseRejectedMd(tentativeRead(tournament, 'rejected.md')),
    admitted: parseAdmittedMd(admitted.text), admittedSha: admitted.sha,
    accepted: parseAcceptedMd(accepted.text), acceptedSha: accepted.sha,
    inboxNames: tentativeInbox(tournament),
  };
}

export const rand = () => Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') || 'r';
