# 🎲 game-state

**simple state-based tournaments**: a single-elimination tournament run
entirely on GitHub, with markdown files as the database and GitHub Actions as
the only backend.

- **Markdown is the record.** `config/tournament.md` (the spine), `roster.md`
  and `results.md` (the public record). No JSON is stored anywhere, and there's
  no server or database.
- **Captains need no account.** They register with a generated team code
  (public) and PIN (secret), and submit scores from the captain view.
- **Nothing reaches the public record without the organizer.** Submissions
  queue privately. The organizer accepts them, and they're published only at a
  stage change the organizer has seen and confirmed.
- **Hard, deterministic stage gates.** The stage is derived from the published
  files, and one table decides what each stage allows. A record that doesn't
  replay cleanly freezes everything.

---

## How it fits together

```
joegr/game-state                 PUBLIC — the site, the spine, the engine
├─ index.html / captain.html / bracket.html          (js/home.js, captain.js, tournament.js)
├─ config/tournament.md          ★ phases, Active phase, Draw seed, Round
├─ js/engine.js                  the pure engine: bracket, invariants, stage, gates
├─ js/pipeline.js                intake / batch / stage-change decisions (pure)
├─ tools/advance.mjs             the organizer CLI
├─ tools/{intake,batch,stage}.mjs    what the workflows run
├─ tentative/.github/workflows/  intake.yml + batch.yml, installed into the private repo
└─ .github/workflows/
   ├─ stage.yml                  ★ the ONLY writer of the public record (organizer-dispatched)
   ├─ deploy.yml                 publishes the site; injects the submit token
   └─ ci.yml                     tests + the live record must replay cleanly

joegr/game-state-roster          PUBLIC — the record everyone reads
├─ roster.md                     ★ the field (published at close and at the draw)
└─ results.md                    ★ results (published a whole round at a time)

joegr/game-state-tentative-scores   PRIVATE — the queue
├─ inbox/                        one file per submission (intake writes; batch consumes)
├─ signups.md scores.md attempts.md rejected.md     written only by batch
├─ admitted.md accepted.md       written only by the organizer's CLI
└─ .github/workflows/intake.yml batch.yml
```

★ = what the public sees. Pages reconstruct the bracket from these files on
every visit, using the same `reconstruct()` the workflows and CLI use.

## The pipeline — teams and scores travel the same road

```
 captain submits ──▶ INTAKE ──▶ BATCH ──▶ organizer ACCEPTS ──▶ organizer confirms a STAGE CHANGE ──▶ public
 (captain view)    intake.yml  batch.yml  admit / confirm       close · draw · advance              roster.md
                   1 run per   1 at a     (private,             (plan + fingerprint → stage.yml)    results.md
                   submission  time       reversible)
```

| Step | Who / what | Writes | Checks |
|---|---|---|---|
| Intake | `intake.yml`, one run per submission, in parallel | a new, uniquely named `inbox/` file | stage gate, PIN + lockout, admitted team, current-round open match |
| Batch | `batch.yml`, one at a time | `signups.md`, `scores.md`, `attempts.md`, `rejected.md` (one commit) | every gate again, **now**. Anything no longer valid is dropped and logged |
| Accept | you, `advance.mjs admit` / `confirm` / `result` | `admitted.md`, `accepted.md` (private) | gate, bracket validity, current round |
| Publish | `stage.yml`, dispatched by you after you confirm the plan | `results.md` → `roster.md` → `tournament.md` last | re-plans and refuses unless the plan fingerprint is the one you confirmed |

Concurrent submissions can't collide: intake only ever creates new files, and
the batch is the only writer of the queue files. Your queue changes (reject,
unlock, re-PIN) also go in as inbox entries, applied in order.

### Stages and gates

The stage is **derived** from the published files, never set directly:

| Stage | Meaning | Allowed |
|---|---|---|
| `registration` | no draw, phase is a signup phase | signup intake · admit/reject · close |
| `closed` | no draw, registration closed | admit/reject · reopen · draw |
| `round` *k* | drawn, `Round: k` | score intake (round *k* only) · accept/reject scores · advance (only when every round-*k* match is accepted) |
| `complete` | `Round: done`, final decided | nothing (reset to run another) |
| `invalid` | the record contradicts itself | **nothing** except look commands and `reset` |

`invalid` covers:

- results without a draw, or a draw seed without a round;
- a result for a match that doesn't exist, a winner who didn't play, a duplicate, or a non-decisive score;
- a result from a round not yet reached, or an earlier round left incomplete;
- duplicate or malformed team codes, or a roster over capacity.

`node tools/advance.mjs check` lists any of these. CI runs the same check on
every push.

---

## Set it up

1. **Repos.** `joegr/game-state` (this one, public) and
   `joegr/game-state-roster` (public) already exist. Create
   **`joegr/game-state-tentative-scores`** as a **private** repo, with no
   template and an empty `main`.
2. **Install the private workflows.** Run `gh auth refresh -s workflow`, then
   `node tools/advance.mjs install`. That pushes `intake.yml`, `batch.yml`,
   the empty queue files and a README into the private repo.
3. **Tokens.** All are fine-grained personal access tokens, owner `joegr`:

   | Name | Repositories | Permissions | Where it goes |
   |---|---|---|---|
   | `SUBMIT_TOKEN` | tentative only | **Actions: read & write**, nothing else | secret in `game-state`. deploy.yml writes it into the **public site**, so treat it as public |
   | `PUBLISH_TOKEN` | game-state, game-state-roster, tentative | **Contents: read & write** | secret in `game-state` |
   | organizer read token | tentative only | **Contents: read** | pasted into the organizer bar, stays in your browser |

   Your own `gh` login needs push access to all three repos.
4. **Optional GitHub-side approval.** Under *Settings → Environments →
   publish*, add yourself as a required reviewer. Every stage change then waits
   for your Approve click as well.
5. **Pages.** *Settings → Pages → Source = GitHub Actions*. Push to deploy.
6. **Smoke test.** Register two or three teams from the site, then run `admit`,
   `close`, `draw`, one match, and `advance`. See *Run a tournament* below.

---

## Run a tournament

The **⚙ Organizer** bar (every page, bottom right; `#organizer` opens it)
shows the queue with a copy button beside each command. Every command:

```bash
node tools/advance.mjs status            # stage, public vs private, what's allowed now
node tools/advance.mjs queue             # teams waiting · scores side by side · lockouts · inbox
node tools/advance.mjs check             # invariants of the record and the queue

# teams
node tools/advance.mjs admit AB12 CD34   # or --all        (private)
node tools/advance.mjs unadmit AB12      #                 (private)
node tools/advance.mjs reject-signup AB12 --note "duplicate"

# stage changes: each prints its plan + a fingerprint and publishes nothing until you type it back
node tools/advance.mjs close             # publishes the admitted roster, closes registration
node tools/advance.mjs reopen
node tools/advance.mjs draw              # publishes the frozen roster, seeds, opens round 1

# scores (current round only)
node tools/advance.mjs confirm r8-m1     # or --all: accept agreed results   (private)
node tools/advance.mjs unconfirm r8-m1
node tools/advance.mjs result r8-m2 AB12 3 1     # decide a dispute or walkover yourself
node tools/advance.mjs reject-score r8-m2        # clear the submissions so both resubmit
node tools/advance.mjs advance           # publishes the whole round, opens the next (or completes)

# PINs and plumbing
node tools/advance.mjs unlock AB12 | repin AB12
node tools/advance.mjs batch             # fold the inbox now
node tools/advance.mjs reset             # start over (also shows its plan first)
```

Add `--confirm <fingerprint>` to confirm a stage change non-interactively, and
`--wait` to watch the workflow. If anything changed between your confirmation
and the run, such as an acceptance landing, `stage.yml` refuses and writes
nothing. Re-run the command to see the new plan.

### The captain's side

- **Register** (`index.html`). Generate a team code, generate a PIN, then press
  Register. It goes through GitHub Actions, about 30 seconds. **Save the code and
  PIN.** The device stays signed in.
- **Submit scores** (`captain.html`). Only your match in the current round is
  offered. Submit your score and your opponent's. The organizer compares both
  captains' submissions, and the round is published when the organizer
  advances it.
- **On a new device**, sign in with the code and PIN. After 5 wrong PINs the
  team locks until the organizer unlocks it or issues a new PIN.

### Rehearse offline

Every file has a local override, so the whole pipeline runs against scratch
files with no way to touch a real repo:

```bash
export TOURNAMENT_FILE=/tmp/t/tournament.md ROSTER_FILE=/tmp/t/roster.md \
       RESULTS_FILE=/tmp/t/results.md TENTATIVE_DIR=/tmp/t/tentative
INPUT_KIND=signup INPUT_PAYLOAD="token=$(openssl rand -hex 16)&pin=1234" INPUT_RECEIPT=rehearsal01 \
  node tools/intake.mjs                  # what intake.yml does for one submission
node tools/advance.mjs batch             # runs the batch locally
node tools/advance.mjs admit --all && node tools/advance.mjs close
```

### Propagation

GitHub Pages caches the site for `max-age=600`, and `raw.githubusercontent.com`
caches the roster markdown for `max-age=300`, so a page can lag a stage change
by a few minutes. The workflows and CLI read through the GitHub API and are
authoritative. A stale page can offer something, but the gates refuse anything
invalid.

---

## Security & integrity model

**Who can change what**

- **Captains** can only start the intake workflow. Every submission is checked
  there, and nothing a captain does touches a public file.
- **Automation** (intake, batch) only moves raw submissions into the
  **private** queue. It never touches config, the stage, acceptance, or the
  public record.
- **The organizer** decides everything:
  - Acceptance is private and reversible.
  - Every public change is a stage change you confirm by fingerprint.
  - That change is executed by `stage.yml`, which only people with write access
    can dispatch. With the optional environment reviewer, it also waits for
    your approval inside GitHub.

**PINs.** The team code is public, so it only identifies; the PIN proves. PIN
hashes live only in the private repo, and a team locks after 5 wrong PINs.
Submissions travel in the dispatch request and are read from the event file,
never logged. (Several wrong guesses at the same instant can each see the old
count, so a lockout can be exceeded by a guess or two.)

**Risks you accept with a public submit token**

- **Anyone can copy it from the page source.** With it they can start intake
  runs (each is validated and rejected, but it burns private-repo Actions
  minutes: 2,000 a month free, and the hourly batch backstop alone uses about
  720). They can also cancel or disable workflow runs, and exhaust the token's
  5,000 requests an hour, which captains' polling shares.
- **It cannot read or write any file**, and it cannot publish anything.
- **Fine-grained tokens expire.** When `SUBMIT_TOKEN` does, submissions stop
  until you replace the secret and redeploy.

**What the record proves.** Every public change is a commit, attributed and
permanent, made by `stage.yml` from a plan you confirmed. The draw is a seeded
shuffle of the published roster, sorted by code, so anyone can reproduce the
bracket from the published seed.

## Roadmap

- **Elo module**: track ratings across tournaments and seed draws by rating.
