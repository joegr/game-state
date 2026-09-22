# game-state — tentative scores (PRIVATE)

The private queue for [game-state](https://github.com/joegr/game-state).
Nothing here is public, and nothing here is the record. The public record is
`roster.md` and `results.md` in the roster repo, written only by the app repo's
`stage.yml` when the organizer confirms a stage change.

| File | Written by | What it is |
|---|---|---|
| `inbox/*.md` | `intake.yml` (and the organizer's CLI, for rejects, unlocks and re-PINs) | one file per submission, waiting for the next batch |
| `signups.md` | `batch.yml` only | every registration: code, token hash, **PIN hash** |
| `scores.md` | `batch.yml` only | submitted scores for the current round |
| `attempts.md` | `batch.yml` only | wrong-PIN attempts (a team locks at 5) |
| `rejected.md` | `batch.yml` only | what the batch refused, and why |
| `admitted.md` | the organizer's CLI only | teams accepted, published at close and at the draw |
| `accepted.md` | the organizer's CLI only | results accepted, published a whole round at a time |

**Don't edit these files by hand.** The batch is the only writer of the queue
files, and that single writer is what makes concurrent submissions safe. Use
`node tools/advance.mjs` from the app repo for every change.

Workflows here are installed by `node tools/advance.mjs install`. Re-run it
after the app repo's `tentative/.github/workflows/` templates change.
