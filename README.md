# 🎲 game-state

**simple state-based tournaments** — a tournament engine that lives entirely as
static files and **markdown** on GitHub Pages.

No database, no backend, no accounts, no server. The record *is* markdown in two
public repositories, and it only ever changes because the organizer pushed a
commit. The **organizer** is the only privileged role, and the only thing that
makes them the organizer is push access to those repositories.

- **Markdown is the database of record.** There is no JSON anywhere in this app.
  `config/tournament.md` holds the tournament's spine; `roster.md` and
  `results.md` — in a separate, public roster repo — hold the field and the
  results. That's the whole data model.
- **Nothing is stored that can be derived.** The bracket is never saved. It is
  rebuilt from `roster.md` + a published draw seed, then replayed through every
  row of `results.md`, freshly, every time anyone opens a page. Same function in
  the browser and in the CLI — one algorithm, three consumers.
- **Deploy-driven stage.** Registration → knockouts → final is an explicit
  `Active phase` field. Nothing advances on a timer; a stage change *is* a push.
- **Anonymous by code.** Captains register with one button. The browser mints a
  random token and derives a **four-character code** (`A–Z0–9`) from its hash.
  No name, no email, no account. The published roster carries the code and the
  token's hash — never the token.
- **`gh` is the authorization boundary.** `tools/advance.mjs` is the only thing
  that writes anything, and it only ever writes by shelling out to `gh`. So
  GitHub's own push permissions are the gate; this app does not implement one.
- **Three-assent results.** A match advances when **both captains** report
  matching scores **and** the organizer publishes the result.

---

## How it fits together

```
joegr/game-state ─ the app repo (static site, GitHub Pages)
├─ index.html        dispatcher → organizer's device to admin; everyone else
│                    gets a one-button anonymous sign-up          (js/home.js)
├─ bracket.html      public bracket + current stage + roadmap (js/tournament.js)
├─ captain.html      sign up · your fixture · report your score  (js/app.js …)
├─ admin.html        organizer STATUS view — read-only            (js/admin.js)
│
├─ config/tournament.md   ★ the organizer-owned spine: name, format, phases,
│                           Active phase, Draw seed
└─ js/
   ├─ engine.js      the PURE engine — draw, advance, consensus, markdown
   │                 parse/format. No DOM, no I/O. Runs in the browser AND Node.
   ├─ config.js      loadTournamentState() — the ONE reconstruction every page calls
   └─ identity.js    random token → hash → four-character code

joegr/game-state-roster ─ the roster repo (public, data only)
├─ roster.md         ★ confirmed teams: code · token hash · registered
└─ results.md        ★ confirmed results, append-only: match · winner · score

tools/   (organizer CLI — the ONLY writer, and it only writes via `gh`)
├─ advance.mjs       ingest · draw · tally · result · stage · purge · status
└─ lib.mjs           ghPutFile() — commits through the GitHub Contents API

test/                node:test suite (npm test) — the pure engine + identity
features/            Gherkin spec of the intended behavior — docs, not run by CI
.github/workflows/
├─ deploy.yml        publish the static site to Pages (on push)
└─ ci.yml            npm test + validate the live markdown record
```

★ = durable state. Everything else is derived or static.

No build step — vanilla ES modules, served as-is.

---

## Set it up

1. **Create two repos.** The app repo (name it `game-state` so the site
   publishes at `https://<user>.github.io/game-state/` — all paths are
   relative, so any name works) and a **public** roster repo for the data.
2. **Configure the tournament** in `config/tournament.md`: `Team count`,
   `Group size`, `Format`, `App repo`, `Roster repo`, and `Active phase`
   (start at `signup`). The `## Phases` table lists the stages in order; none
   of them carry dates, because nothing here runs on a clock. Leave
   `Draw seed` as `(none)` — the draw sets it.
3. **Authenticate the CLI:** `gh auth login`, with push access to both repos.
   That login *is* your organizer credential. There is no key to generate.
4. **Enable Pages:** *Settings → Pages → Source = GitHub Actions*, then push.
   Registration opens as soon as that deploy lands.

---

## Run a tournament

Everything the organizer does is a command in `tools/`. `admin.html` shows you
the live state and the exact command to run next, but it cannot change anything.

```bash
node tools/advance.mjs status              # where things stand
node tools/advance.mjs ingest entries.txt  # publish received signups to roster.md
node tools/advance.mjs stage groups        # close registration (a push)
node tools/advance.mjs draw                # publish the draw seed (a push)
node tools/advance.mjs ingest reports.txt  # collect score reports (stays local)
node tools/advance.mjs tally               # check two-captain agreement
node tools/advance.mjs result r16-m1 88BD 2 1   # publish a confirmed result
```

1. **Collect signups.** Captains send you their entry blob through whatever
   channel you already use. Save them to a file — quoting and noise are fine,
   the parser finds the blobs — and `ingest` it. New teams are published to
   `roster.md` in one commit.
2. **Close registration** with `stage <next-phase>`. That push is the only
   thing that closes signup; registration also closes on its own once every
   group is full.
3. **Draw.** `draw` publishes a seed to `config/tournament.md`. Anyone with
   `roster.md` and that seed can regenerate the identical bracket — that is the
   point of publishing it.

   > ⚠️ **The draw freezes the field.** The bracket is rebuilt from the roster
   > every time it is read, so after the draw, adding a team or changing the
   > seed would produce a *different* bracket underneath results that are
   > already public. Both are refused: `ingest` won't publish a late team, and
   > `draw` won't run twice over published results.

4. **Collect and tally scores.** Score reports `ingest` into a local `scores/`
   directory — they are working state, never published. `tally` checks for two
   mirrored reports and prints the ready-to-run `result` command for each
   agreed match.
5. **Publish results.** `result` validates against the live bracket and appends
   to `results.md`. That commit *is* the confirmation — there is no separate
   override path. A dispute or a no-show is decided the same way: you choose a
   winner, in public, under your own account.
6. **There is nothing to back up.** The record is the commit history of two
   public repos. Lose your laptop and you lose only unconfirmed score reports.

The captain's side (`captain.html`): register → **save your token** and your
4-char code → later, load your token to see your fixture and report your score,
which produces a blob you send the organizer. There is no account recovery,
because there is no account.

### Propagation

A published change is visible once caches expire: GitHub Pages serves the site
with `max-age=600`, and `raw.githubusercontent.com` serves the roster markdown
with `max-age=300` (and `access-control-allow-origin: *`, which is what makes
the runtime fetch work at all). A stage change also has to wait for the Pages
deploy. If you're testing and see something stale, hard-refresh.

### Try it locally

```bash
npm test
```

Serve the site with any static server (e.g. `python3 -m http.server`) and open
`index.html`.

To exercise the CLI without touching anything real, point all three files at
local scratch copies — no network, no `gh` writes:

```bash
TOURNAMENT_FILE=/tmp/t.md ROSTER_FILE=/tmp/roster.md RESULTS_FILE=/tmp/results.md node tools/advance.mjs status
```

---

## Privacy & integrity model

**What exists:** four-character codes, a hash of each team's token, timestamps,
and match results — all in public markdown. Nothing else. No names, no emails,
no accounts, no analytics, no third-party service.

**What a score report proves:** it carries the captain's token, which the
organizer checks against the hash published in `roster.md`. That proves the
report came from whoever registered that team, so **one captain cannot forge
the other's report** — which is what makes two-captain agreement mean anything.

**What it does not prove.** This is a shared-secret scheme, not a signature
scheme: the organizer necessarily sees the tokens they verify against, so they
*could* produce a report for any team. That is a real difference from an
earlier design of this app, which used per-captain keypairs. It is an accepted
trade-off, because the organizer is trusted by construction anyway — they
publish every result and could simply publish a false one directly.

**What actually constrains the organizer** is publicity, not cryptography:

- Every result is a commit in a public repo, attributed to their account, with
  a timestamp, permanently.
- The draw is a **seeded** shuffle of a **published** roster. Publish the seed
  and anyone can regenerate the bracket — so a rigged draw is a seed that
  doesn't produce the bracket that was published.
- `roster.md` is sorted by code, so one seed can only ever mean one bracket
  regardless of how the file was written.
- CI rebuilds the bracket from the live markdown on every push and fails if any
  published result no longer fits it.

**"Anonymous"** means the public record carries no identities. The organizer
still sees whatever the channel captains send their entries over reveals.

---

## Roadmap

- **Elo module** — track ratings across tournaments, seed draws by rating.
