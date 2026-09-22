// game-state — phase lookup, for the public roadmap.
//
// `Active phase` in config/tournament.md names where the tournament is in its
// phase table. It only changes through a stage change the organizer confirms
// (tools/stage.mjs). What is ALLOWED at any moment is decided elsewhere, by
// the derived stage and the gate table (js/engine.js → reconstruct, gate),
// not by this lookup.

// The single currently-active phase.
export function currentPhase(config) {
  return config.phases.find((p) => p.id === config.activePhase) || config.phases[0];
}
