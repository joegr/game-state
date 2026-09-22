@organizer @setup @config
Feature: Tournament setup
  As an organizer
  I want to stand up a tournament from two repositories and one markdown file
  So that a whole tournament runs with no server, no database and no accounts

  There is no application state anywhere except markdown in git. The app repo
  holds the site and `config/tournament.md` — the organizer-owned spine. The
  roster repo holds `roster.md` and `results.md`, which are the database of
  record for who is playing and what happened. "Deploying" is committing a
  file; "the tournament" is what those files say.

  Background:
    Given an app repo containing the static site and config/tournament.md
    And a public roster repo containing roster.md and results.md
    And config/tournament.md names both repos

  Rule: tournament.md is the whole configuration

    @smoke
    Scenario: The spine is one readable file
      When the organizer opens config/tournament.md
      Then it contains the name, tagline, team count, group size and format
      And it names the app repo and the roster repo
      And it carries the current "Active phase" and the "Draw seed"
      And it lists the phases in order, as a markdown table
      And there is no JSON file anywhere in either repository

    Scenario: The file is meant to be edited by hand
      Given the organizer edits a field with inconsistent spacing or casing
      When the site or the CLI parses it
      Then the value is read correctly
      # Label matching is case-insensitive and whitespace-tolerant on purpose:
      # a hand edit through the GitHub web UI must not be able to break the
      # site over a stray space.

    Scenario: An unset draw seed reads as "(none)", never as a broken value
      Given no draw has been run
      Then "Draw seed" reads "(none)"
      And the site treats the tournament as pre-draw
      And registration, not a bracket, is what visitors see

  Rule: Some settings lock once people have relied on them

    The tournament has two irreversible moments. Both exist because changing
    the input would silently change facts that are already published.

    @critical @lock
    Scenario: The field locks at the draw
      Given the draw has run and "Draw seed" is set
      When anyone attempts to add a team to roster.md
      Then it is refused, and the reason names the draw
      # The bracket is never stored — it is rebuilt from the roster every time
      # it is read. One more team means a different bracket underneath results
      # that are already public.

    @critical @lock
    Scenario: The seed locks at the draw
      Given the draw has run and results have been published
      When anyone attempts to run the draw again
      Then it is refused, and the refusal names the results it would orphan
      And nothing is changed

    @lock
    Scenario: A draw with nothing published yet can still be redone
      Given the draw has run but results.md is empty
      When the organizer re-runs the draw with an explicit force
      Then the new seed is published and the bracket is redrawn
      # The only genuinely recoverable case: nobody has relied on it yet.

    @lock
    Scenario: The results ledger is append-only
      Given a match has been confirmed
      Then its row in results.md is never rewritten
      And a second result for the same match is refused

  Rule: Setup is finished when the site can be read by a stranger

    Scenario: A visitor arrives before anything has happened
      Given tournament.md exists and roster.md is empty
      When a stranger opens the site
      Then they see the tournament name and the phase roadmap
      And they are offered registration if the active phase is the signup phase
      And nothing is broken or blank
