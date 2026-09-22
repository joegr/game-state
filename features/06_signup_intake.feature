@organizer @registration @inbox
Feature: Signup intake
  As an organizer
  I want to paste the sealed entries people sent me and have teams appear
  So that building the field is one action over whatever channel I already use

  The inbox is deliberately format-agnostic: the organizer pastes whatever they
  received — one blob, forty blobs, blobs wrapped in chat quoting — and the
  console finds and opens what it can.

  Background:
    Given the organizer console is unlocked
    And the roster is empty

  Rule: Blobs are auto-detected inside arbitrary pasted text

    @smoke @critical
    Scenario: Ingesting a batch of sealed entries
      When the organizer pastes 8 sealed entries into the inbox
      And processes them
      Then 8 teams are added to the roster
      And the console reports "Processed: +8 team(s), 0 score report(s)."
      And each team is identified only by its four-character code

    @parsing
    Scenario Outline: Blobs survive being pasted from a chat client
      When the organizer pastes an entry <wrapping>
      Then the entry is still detected and opened

      Examples:
        | wrapping                        |
        | on its own                      |
        | inside a fenced code block      |
        | surrounded by conversation text |
        | with several blobs on one line  |

    @parsing
    Scenario: Entries and score reports can be pasted together
      Given 3 sealed entries and 4 sealed score reports are pasted at once
      When they are processed
      Then 3 teams are added
      And 4 score reports are recorded
      And each blob is routed by its decrypted contents, not by how it was pasted

  Rule: Only the organizer's key can open the inbox

    @crypto @critical
    Scenario: Unreadable blobs are counted, never guessed at
      When the organizer pastes 5 valid entries and 2 blobs sealed to another key
      Then 5 teams are added
      And 2 blobs are reported as "unreadable/unknown"
      And no partial or inferred team is created from the unreadable blobs

    @crypto
    Scenario: Pasting noise is harmless
      When the organizer pastes text containing no blob at all
      Then no team is created
      And the console reports nothing was readable
      And the roster is unchanged

  Rule: The roster is a set, keyed by team code

    @dedupe
    Scenario: Re-pasting the same entry does not duplicate a team
      Given team "88BD" is already on the roster
      When the organizer pastes that same sealed entry again
      Then no new team is created
      And the console reports 1 duplicate
      And the roster still holds one "88BD"

    @dedupe
    Scenario: A captain who registers twice appears as two teams
      Given a captain registers on two devices
      Then two distinct keypairs exist
      And two distinct team codes are derived
      And the organizer sees two teams
      # The platform cannot tell these apart — there is no identity behind the
      # key to correlate. Resolving it is a human conversation.

    @spam
    Scenario: Anyone can produce a sealed entry
      Given the organizer public key is published
      When an unknown party seals 200 entries and sends them
      Then all 200 would be openable by the organizer
      And the organizer decides which to paste into the inbox
      # Sealing is open by design (that is what makes signup anonymous). The
      # gate is the out-of-band channel and the organizer's judgement.

  Rule: Intake reflects immediately in the organizer's dashboard

    @dashboard
    Scenario: Roster growth is visible at a glance
      Given 0 teams are on the roster
      When 12 entries are ingested
      Then the dashboard shows "12 team(s)"
      And the draw becomes available
      And the registration panel reports the field is ready

    @dashboard
    Scenario: The draw stays unavailable below the minimum field
      Given 1 team is on the roster
      Then the draw control is disabled
      And the console explains at least 2 teams are needed
