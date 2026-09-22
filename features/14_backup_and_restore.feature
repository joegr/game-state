@organizer @durability @critical
Feature: Backup and restore
  As an organizer
  I want a portable copy of the tournament that only I can open
  So that losing a browser profile does not end the tournament

  The console's working state lives only in one browser, and the captains'
  public keys exist nowhere else — without them no future round can be sealed.
  The backup is itself a sealed box to the organizer's OWN public key: safe to
  store anywhere, openable only with the organizer private key.

  Background:
    Given the organizer console is unlocked
    And the working state holds the roster, the score reports and the bracket

  Rule: A backup captures everything the tournament cannot be rebuilt without

    @smoke @critical
    Scenario: Taking a backup
      Given 8 teams, 4 score reports and a drawn bracket
      When the organizer downloads a backup
      Then the backup contains the roster including every captain public key
      And it contains every score report received
      And it contains the bracket and its seed
      And it records when it was taken

    @crypto @critical
    Scenario: The backup is readable only by the organizer
      Given a backup has been taken
      When anyone without the organizer private key opens the file
      Then they see only an opaque sealed blob
      And the roster, the reports and the bracket are unreadable
      And the file is therefore safe to keep in a repository or a chat

    @rationale
    Scenario: Why the roster is the irreplaceable part
      Given the published files carry only team codes and sealed views
      When the working state is lost without a backup
      Then the captains' public keys are gone
      And no future round can be sealed to any captain
      And the tournament cannot continue
      # The bracket could be reconstructed by hand; the keys could not.

  Rule: Restoring reproduces the tournament exactly

    @smoke @critical
    Scenario: Restoring after a total loss
      Given a backup was taken with 8 teams and a drawn bracket
      And the working state has been cleared entirely
      When the organizer restores from that backup
      Then the roster, the reports, the bracket and the seed are restored exactly
      And the console returns to the same stage it was in
      And the result queue shows the same agreed and disputed matches

    @migration
    Scenario: Moving the tournament to a new device
      Given the organizer sets up the console on a second device with their key
      When they restore a backup taken on the first device
      Then they can continue running the tournament from the second device
      And the first device is no longer required

    @confirmation
    Scenario: Restoring is confirmed because it replaces everything
      When the organizer restores a backup
      Then they are told how many teams and reports it holds
      And when it was taken
      And they must confirm before the current state is replaced

  Rule: A bad restore never damages the current state

    @validation @critical
    Scenario Outline: Rejecting input that is not a usable backup
      When the organizer attempts to restore <input>
      Then they are told "<message>"
      And the current working state is untouched

      Examples:
        | input                                      | message                                            |
        | text containing no blob                    | No backup blob found in that text.                 |
        | a blob sealed to a different key           | not readable with this organizer key               |
        | a sealed blob that is not a backup         | That is not a game-state backup.                   |
        | a backup missing its roster                | That is not a game-state backup.                   |

    @validation
    Scenario: A failed restore leaves no partial state
      Given a restore fails validation
      Then no team, report or bracket from the attempted file is applied
      And the tournament continues unchanged

  Rule: Backups are part of the routine, not an emergency measure

    @ux @critical
    Scenario: The console explains the risk in plain terms
      When the organizer views the backup panel
      Then it states this browser is the only copy
      And advises taking a backup after every session

    @ux @critical
    Scenario: Destructive actions point at the backup first
      When the organizer attempts to reset the tournament state
      Then they are reminded to download a backup first
      And must confirm twice before anything is cleared

    @pending
    Scenario: The console prompts for a backup after significant changes
      Given 10 results have been confirmed since the last backup
      Then the console prompts the organizer to take a fresh backup
      # NOT YET IMPLEMENTED — backups are currently entirely manual.
