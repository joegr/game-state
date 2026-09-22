// game-state — tournament stage lookup.
//
// The stage is an explicit field the organizer sets: `activePhase` in
// config/tournament.json. Advancing the tournament means editing that field
// and pushing — a deploy, not a clock tick. Every visitor reads the same
// static config, so there is nothing to poll, no clock skew to worry about,
// and no ambiguity about whether a stage has "really" started.

// The single currently-active phase.
export function currentPhase(config) {
  return config.phases.find((p) => p.id === config.activePhase) || config.phases[0];
}

// Convenience: is registration open right now?
export function isSignupOpen(config) {
  return currentPhase(config)?.kind === 'signup';
}
