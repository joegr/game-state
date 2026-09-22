// game-state — tournament stage lookup.
//
// The stage is an explicit field the organizer sets: `Active phase` in
// config/tournament.md. Advancing the tournament means publishing a new value
// for that field — a push, not a clock tick. Every visitor reads the same
// static config, so there is nothing to poll, no clock skew to worry about,
// and no ambiguity about whether a stage has "really" started.

// The single currently-active phase.
export function currentPhase(config) {
  return config.phases.find((p) => p.id === config.activePhase) || config.phases[0];
}

// Convenience: is registration open right now? Two independent facts have to
// hold: the organizer has the tournament in its signup phase, AND the field
// isn't full. `progress` is signupProgress() over the live roster.md (see
// js/config.js → loadTournamentState); it's optional, and with none computed
// yet capacity is assumed open.
export function isSignupOpen(config, progress) {
  if (currentPhase(config)?.kind !== 'signup') return false;
  return !(progress && progress.full);
}
