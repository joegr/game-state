// game-state — time-based tournament state machine.
//
// The whole point: tournament progression is a *pure function of the clock*.
// A config lists phases, each with a UTC `start`. Given "now", the current phase
// is the last phase whose start has passed. No server, no writes, no polling —
// every visitor computes the same state from the same static config.
//
// Phases are ordered; `start` is ISO-8601 UTC. The final "complete" phase marks
// the tournament as over. This module has no DOM and no network — pure logic,
// so it is trivially testable.

// Returns the ordered phases with derived timing, given a Date `now`.
export function resolvePhases(config, now = new Date()) {
  const t = now.getTime();
  const phases = [...config.phases].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  return phases.map((p, i) => {
    const start = new Date(p.start).getTime();
    const next = phases[i + 1] ? new Date(phases[i + 1].start).getTime() : Infinity;
    let status;
    if (t < start) status = 'upcoming';
    else if (t < next) status = 'active';
    else status = 'past';
    return { ...p, index: i, startMs: start, endMs: next, status };
  });
}

// The single currently-active phase (or the first upcoming one before kickoff).
export function currentPhase(config, now = new Date()) {
  const phases = resolvePhases(config, now);
  return phases.find((p) => p.status === 'active') || phases[0];
}

// Convenience: is registration open right now?
export function isSignupOpen(config, now = new Date()) {
  const cur = currentPhase(config, now);
  return cur && cur.kind === 'signup' && cur.status === 'active';
}

// Milliseconds until the next phase transition (for a live countdown), or null
// if the tournament is complete.
export function msToNextTransition(config, now = new Date()) {
  const cur = currentPhase(config, now);
  if (!cur || !isFinite(cur.endMs)) return null;
  return cur.endMs - now.getTime();
}

// Human-friendly duration like "2d 4h 11m 03s".
export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000) % 24;
  const d = Math.floor(ms / 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  parts.push(`${pad(m)}m`, `${pad(s)}s`);
  return parts.join(' ');
}
