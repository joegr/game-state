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
  HKDF → AES-GCM). No accounts, no email, no tracking. There are no chosen names:
  every team is a random **four-character code** (`A–Z0–9`) derived from its key.
- **Three views of the same tournament:**
  - **Public tournament view** (anonymous) — the landing page: live stage, roadmap,
    and the whole bracket as opaque team codes, updated as each match closes.
  - **Captain view** (private) — a captain loads their key and decrypts *only
    their own* fixture: their next opponent, stage, and match time, and reports
    their score. No captain can enumerate the field.
  - **Admin dashboard** (organizer) — a single passphrase-locked login that drives
    the engine: confirm results, run the draw, watch engine runs.
- **Triple-confirmation results** — a match only advances when **both captains**
  independently report **matching** scores (authenticated with their captain key,
  so neither can forge the other) **and** the admin confirms. Disagreements are
  flagged for manual resolution.
- **Event-driven engine** — no polling timer: opening a signup/score issue
  triggers ingestion; the admin dashboard dispatches draws and confirmations.
- **Cascade purge** — once the final is decided, the engine deletes every piece
  of stored data (signups, score reports, decrypted entries, per-captain blobs),
  leaving only the anonymized public bracket as the historical record.

> An Elo-tracking module is planned to sit alongside this; for now the focus is
> the time-based state machine and its GitHub Actions deployment.

---

## How it fits together

```
Browser (static, GitHub Pages)
├─ index.html   → the tournament: live stage (clock-driven), roadmap, anonymized bracket
├─ captain.html → Sign up (encrypt) · Captain view (decrypt fixture, report score)
└─ admin.html   → organizer dashboard: passphrase login, confirm results, drive the engine

config/                        the state machine, as JSON
├─ tournament.json   schedule + phase boundaries + organizer PUBLIC key   (static)
├─ bracket.json      per-captain ENCRYPTED views                          (engine-written)
├─ public.json       anonymized full bracket, updated per match           (engine-written)
└─ queue.json        result queue: agreed / disputed / awaiting per match (engine-written)

tools/  (organizer / CI)
├─ keygen.mjs          generate the organizer keypair
├─ collect-issues.mjs  pull signup / score issues (by title) → signups/ , scores/
├─ decrypt-signups.mjs signups/ → state/teams.json  (anonymized: code + pubkey only)
├─ advance.mjs         draw · result · tally · sim · purge · status  (the bracket engine)
└─ lib.mjs, crypto.js  shared (crypto.js is the SAME module the browser uses)

.github/workflows/
├─ deploy.yml   publish the static site to GitHub Pages
└─ engine.yml   event-driven: ingest on new issues; dispatch draw/result/… ; auto-purge
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

The organizer works from the **admin dashboard** at `admin.html`:

1. **First visit** — paste a fine-grained GitHub PAT scoped to this repo with
   **Actions: Read and write**, and choose a passphrase. The token is encrypted
   with the passphrase (PBKDF2 → AES-GCM) and stored **only in your browser** —
   never committed or sent anywhere except github.com. After that, the "login" is
   just the passphrase.
2. **Registration → draw** — as captains open signup issues the engine ingests
   them automatically. When registration closes, hit **Run the draw**.
3. **Confirm results** — captains report scores from their Captain view; when both
   agree, the match appears under **Ready to confirm**. Click **Confirm & advance**
   (the third confirmation) and the engine records it. Disputes get a manual
   override; no-shows get a walkover.

Under the hood the dashboard only ever `workflow_dispatch`es the engine — the
organizer **private key stays a CI secret and never enters the browser**. The
engine actions (also runnable from *Actions → “game-state engine”*):

| Action    | What it does |
|-----------|--------------|
| `collect` | Ingest signup + score issues → decrypt → refresh `state/` and the queue. Runs automatically when an issue is opened. |
| `draw`    | Seeded random single-elimination draw. Writes the full bracket + views. |
| `result`  | Record one match: `match_id` (e.g. `r8-m1`) + `winner_fp`. |
| `tally`   | Re-collect score reports and rebuild `config/queue.json`. |
| `sim`     | Auto-play every remaining match (demo/testing). |
| `status`  | Print bracket progress and the pending matches. |
| `purge`   | Manually cascade-delete all stored data. |

Every mutation rewrites the `config/*.json` and commits it, which re-triggers the
Pages deploy. When the final match is decided the engine **auto-purges**:
`signups/`, `scores/`, and `state/` are deleted and the public files are reduced
to an anonymized champion record.

### The triple-confirmation flow

```
Captain A ─ reports score ─┐
                           ├─ engine tally: scores agree? ─→ queue: "agreed"
Captain B ─ reports score ─┘                                        │
                                                    Admin: Confirm & advance
                                                                    │
                                          engine result → bracket advances → redeploy
```

Score reports are **authenticated** with each captain's key: the report embeds
the captain's public key and only decrypts correctly if produced with their
private key, so one captain cannot forge the other's agreement (even though the
public keys live in the repo).

### Try it locally

```bash
cd tools
node keygen.mjs --json > organizer.keys.json      # gitignored
# put the printed publicKey into config/tournament.json, then:
node make-fake-signups.mjs 32                      # fake encrypted entries
node decrypt-signups.mjs
node advance.mjs draw --seed my-seed
node make-fake-scores.mjs --dispute r16-m2         # fake authenticated score reports
node advance.mjs tally                             # build the queue (agreed/disputed)
node advance.mjs status
node advance.mjs sim                               # plays to a champion, then purges
```

Serve the site with any static server (e.g. `python3 -m http.server`) and open
`index.html` (tournament) / `captain.html` (sign-up + captain).

---

## Privacy model

- Signups are sealed to the organizer's public key — only the holder of
  `ORGANIZER_PRIVATE_KEY` can read them.
- There is no team name to leak: a team is a random four-character code derived
  from its key. The organizer stores **only** `{ code, captainPublicKey }`.
- Teams are opaque codes everywhere public.
- A captain's fixture is sealed to *their* public key; nobody else can decrypt it.
- Score reports are authenticated to the reporting captain, so results require
  genuine two-captain agreement (plus admin sign-off) to advance.
- The admin's GitHub token never leaves the browser (encrypted at rest under the
  passphrase); the organizer private key never enters the browser at all.
- On completion, all stored/encrypted data is cascade-deleted; only the
  anonymized public bracket remains.

The draw is a **seeded** random shuffle: publishing the seed lets anyone verify
the bracket was not rigged.

---

## Roadmap

- **Elo module** — track ratings across tournaments, seed draws by rating.
