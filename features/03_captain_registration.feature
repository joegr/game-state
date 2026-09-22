@captain @registration @privacy
Feature: Captain registration
  As a captain
  I want to enter a tournament without handing over a name, an email or an account
  So that the only thing I reveal is that some anonymous team exists

  Registration is two generated fields and two buttons. Nothing is typed: the
  browser mints a random token, the four-character team code is a hash of it,
  and the score report key is that same token with the code attached. One
  secret per team, shown twice because it does two different jobs — identifying
  the team in public, and proving the team in private.

  Background:
    Given a visitor opens the registration page
    And the active phase is the signup phase

  Rule: Registering reveals nothing but a code

    @smoke @critical
    Scenario: Field one — the team code
      When the captain presses the first button
      Then the browser generates a random token
      And the first field shows the four-character code derived from it
      And an entry blob is produced for the captain to send the organizer
      And no name, email, account or payment was asked for

    @critical
    Scenario: Field two — the score report key
      Given the captain has a team code
      When they press the second button
      Then the second field shows their score report key
      And they are warned to save it, because it cannot be recovered

    Scenario: The second field cannot be filled before the first
      Given the captain has not registered yet
      Then the second button is unavailable
      # The key is derived from the token, so there is nothing to derive yet.

    @critical
    Scenario: The entry the organizer receives is machine-readable
      Then the entry blob is a single unbroken run of at least sixty characters
      And the organizer's ingest finds it inside ordinary pasted chat text
      # A shorter or punctuated entry would be skipped by the scanner and the
      # captain would never appear on the roster — silently.

    @privacy
    Scenario: The code is all anyone else ever learns
      Then the published roster carries the code and a hash of the token
      And the raw token appears in no published file
      And the code cannot be turned back into the token

    @critical
    Scenario: Losing the key loses the team
      Given a captain discards their score report key
      Then they cannot report a score for their team
      And the interface warns them to save it before they leave the page
      # There is no account recovery, because there is no account.

    @critical @anti-forgery
    Scenario: A key cannot be made to claim another team
      Given someone edits a key to show a different team's code
      When that key is loaded
      Then the code is re-derived from the token, not read from the text
      And they are identified as their own team, never the other one

  Rule: Registration closes on capacity, not on a clock

    The field fills sequentially, `groupSize` at a time, up to `teamCount`.
    Whether signups are open is a fact about the roster right now.

    Scenario: Progress is visible while the field fills
      Given some teams are on the published roster
      When anyone opens the site
      Then they see how many of the available places are taken
      And how each group is filling

    Scenario: The last place closes registration
      Given every group is full
      When a visitor opens the registration page
      Then registration is not offered
      And they are told the field is full

    Scenario: The organizer can close registration early
      Given places remain
      When the organizer advances past the signup phase
      Then registration is not offered to any subsequent visitor
      # Two independent gates: the organizer's explicit phase, and capacity.
      # Either one closes it.

  Rule: Entries become teams only when the organizer publishes them

    @intake
    Scenario: Publishing collected entries
      Given the organizer has saved received blobs to a file
      When they run the ingest command
      Then each readable entry becomes a row in roster.md
      And roster.md is pushed to the roster repo via gh in one commit
      And unreadable text in the file is counted and ignored

    @intake
    Scenario: The inbox is format-agnostic
      Given the file contains blobs pasted out of chat, with quoting and noise
      Then the readable blobs are still found and ingested
      # The organizer should never have to clean up a paste by hand.

    @intake
    Scenario: The same entry twice is one team
      Given a captain sent their blob twice
      When both are ingested
      Then the roster gains one team
      And the duplicate is reported as such

    @intake @lock
    Scenario: A late entry is refused, loudly
      Given the draw has already run
      When a new entry is ingested
      Then it is not published to roster.md
      And the code of the late team is named in the output
      And the reason given is that the bracket is rebuilt from the roster
      # See 01_tournament_setup: the field locks at the draw.

  Rule: The published roster has one canonical order

    @critical @determinism
    Scenario: Rows are sorted by code, always
      Given teams registered in some arbitrary order
      When roster.md is published
      Then its rows are in code order
      And publishing the same field in a different order produces the same file
      # The draw is a shuffle of the roster array, so row order is part of the
      # bracket's input. One canonical order means one seed can only ever mean
      # one bracket. See 04_the_draw.
