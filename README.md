# 🎲 game-state

**simple state-based tournaments** — a lightweight, serverless tournament engine
that lives entirely as static files and JSON configuration on GitHub Pages.

No database. No backend. The tournament *is* a state machine whose transitions
are driven by the clock and by a handful of JSON files that GitHub Actions
rewrites as matches close.

- **Time-based state machine** — the current stage (registration → group stage →
  knockouts → final) is a *pure function of the current time* versus the phase
  boundaries in [`config/tournament.json`](config/tournament.json). Every visitor
  computes the same state from the same static config.
- **Anonymous, encrypted signups** — captains register from the served page. Each
  entry is sealed to the organizer's public key with WebCrypto (ECDH P-256 →
  HKDF → AES-GCM). No accounts, no email, no tracking; the public site never sees
  a team name.
- **Two views of the same tournament:**
  - **Captain view** (private) — a captain loads their key and decrypts *only
    their own* fixture: their next opponent, their stage, their match time. No
    captain can enumerate the field.
  - **Public spectator bracket** (anonymous) — everyone sees the whole bracket
    as opaque team IDs, updated as each match closes.
- **Cascade purge** — once the final is decided, the engine deletes every piece
  of stored data (signups, decrypted entries, per-captain encrypted blobs),
  leaving only the anonymized public bracket as the historical record.

> An Elo-tracking module is planned to sit alongside this; for now the focus is
> the time-based state machine and its GitHub Actions deployment.

---

## How it fits together

```
Browser (static, GitHub Pages)
├─ index.html   → the tournament: live stage (clock-driven), roadmap, anonymized bracket
└─ captain.html → Sign up (encrypt) · Captain view (decrypt your own fixture)

config/                        the state machine, as JSON
├─ tournament.json   schedule + phase boundaries + organizer PUBLIC key   (static)
├─ bracket.json      per-captain ENCRYPTED views                          (engine-written)
└─ public.json       anonymized full bracket, updated per match           (engine-written)

tools/  (organizer / CI)
├─ keygen.mjs          generate the organizer keypair
├─ collect-issues.mjs  pull signup issues → signups/
├─ decrypt-signups.mjs signups/ → state/teams.json  (anonymized: fp + pubkey only)
├─ advance.mjs         draw · result · sim · purge · status  (the bracket engine)
└─ lib.mjs, crypto.js  shared (crypto.js is the SAME module the browser uses)

.github/workflows/
├─ deploy.yml   publish the static site to GitHub Pages
└─ engine.yml   run the engine, commit updated JSON, cascade-purge on completion
```

The whole thing has **no build step** — vanilla ES modules, served as-is.

---

## Deploy it

1. **Create a repo** from these files and push to `main`. Name the repo
   **`game-state`** so the site publishes at `https://<user>.github.io/game-state/`
   with the public tournament view as the landing page. (All asset paths are
   relative, so any repo name / base path works — the name only sets the URL.)
2. **Enable Pages:** repo *Settings → Pages → Build and deployment → Source =
   GitHub Actions*.
3. **Generate the organizer keypair** locally:
   ```bash
   cd tools && node keygen.mjs
   ```
   - Paste the **public** key into `config/tournament.json → organizerPublicKey`.
   - Add the **private** key as a repo secret named `ORGANIZER_PRIVATE_KEY`
     (*Settings → Secrets and variables → Actions*). Never commit it.
4. **Configure the tournament** in `config/tournament.json`: `name`, `teamCount`,
   the `signup.repo` (`owner/name` used for the pre-filled issue link), and the
   `phases` with their UTC `start` times.
5. **Push.** The `deploy` workflow publishes the site. Registration opens
   automatically when the wall clock passes the `signup` phase's `start`.

---

## Run a tournament

Signups arrive as GitHub issues (the Sign-up page opens a pre-filled one). Drive
the engine from *Actions → “game-state engine” → Run workflow*:

| Action    | What it does |
|-----------|--------------|
| `collect` | Ingest signup issues → decrypt → `state/teams.json`. Runs on a schedule too. |
| `draw`    | Seeded random single-elimination draw. Writes the full bracket + views. |
| `result`  | Record one match: set `match_id` (e.g. `r8-m1`) and `winner_fp`. |
| `sim`     | Auto-play every remaining match (demo/testing). |
| `status`  | Print bracket progress and the pending matches. |
| `purge`   | Manually cascade-delete all stored data. |

Every mutation rewrites `config/bracket.json` and `config/public.json` and commits
them, which re-triggers the Pages deploy. When the final match is decided the
engine **auto-purges**: `signups/` and `state/` are deleted and `bracket.json` is
reduced to an anonymized champion record.

### Try it locally

```bash
cd tools
node keygen.mjs --json > organizer.keys.json      # gitignored
# put the printed publicKey into config/tournament.json, then:
node make-fake-signups.mjs 32                      # fake encrypted entries
node decrypt-signups.mjs
node advance.mjs draw --seed my-seed
node advance.mjs status
node advance.mjs sim                               # plays to a champion, then purges
```

Serve the site with any static server (e.g. `python3 -m http.server`) and open
`index.html` (tournament) / `captain.html` (sign-up + captain).

---

## Privacy model

- Signups are sealed to the organizer's public key — only the holder of
  `ORGANIZER_PRIVATE_KEY` can read them.
- The organizer stores **only** `{ fingerprint, captainPublicKey }` per team.
  Plaintext team names are decrypted, used, and discarded — never persisted.
- Teams are opaque fingerprints everywhere public.
- A captain's fixture is sealed to *their* public key; nobody else can decrypt it.
- On completion, all stored/encrypted data is cascade-deleted; only the
  anonymized public bracket remains.

The draw is a **seeded** random shuffle: publishing the seed lets anyone verify
the bracket was not rigged.

---

## Roadmap

- **Elo module** — track ratings across tournaments, seed draws by rating.
