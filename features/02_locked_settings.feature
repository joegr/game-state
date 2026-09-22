@organizer @settings @integrity
Feature: Locked settings
  As a captain or spectator
  I want the rules of the tournament to stop being editable once I have committed to them
  So that the organizer cannot quietly change the game underneath me

  Fairness in a system with one privileged role comes from settings that LOCK
  at defined moments. Each lock is irreversible for the life of the tournament.
  The lock ladder:

    | moment                  | what locks                                    |
    | first entry accepted    | organizer key, tournament name                |
    | draw executed           | field, team count, format, seed, round labels |
    | match confirmed         | that match's result and both its participants |
    | champion crowned        | everything; the tournament is read-only       |

  Background:
    Given a configured tournament
    And the organizer console is unlocked

  Rule: The organizer key locks the moment it has been used to accept an entry

    @critical
    Scenario: Rotating the organizer key after entries exist is refused
      Given 8 captains have registered against organizer public key "KEY_A"
      When the organizer publishes a different organizer public key
      Then the console warns "8 existing entries were sealed to the previous key"
      And the console refuses to open the tournament with the new key
      # Rotating the key orphans every entry already sealed: the blobs become
      # permanently unreadable. There is no migration, only invalidation.

    @critical
    Scenario: The tournament name is part of the captain's key store address
      Given captains have stored keys under tournament name "The Autumn Gauntlet"
      When the organizer renames the tournament
      Then every captain's device fails to find their stored key
      And the console refuses the rename after the first entry
      # Captain keys are stored per tournament name; renaming strands them.

  Rule: The draw locks the field permanently

    @draw @critical
    Scenario: The field cannot grow after the draw
      Given 8 teams have been drawn into a bracket
      When a 9th sealed entry arrives in the inbox
      Then the entry is accepted into the roster but not into the bracket
      And the console reports it as "late entry — field already locked"
      And the drawn bracket is unchanged

    @draw @critical
    Scenario: The draw cannot be re-run
      Given a bracket has been drawn with seed "autumn-2026"
      When the organizer attempts a second draw
      Then the console refuses with "The field is locked. Reset the tournament to draw again."
      And the existing bracket and seed are preserved

    @draw
    Scenario Outline: Structural settings freeze at the draw
      Given a bracket has been drawn
      When the organizer changes "<setting>"
      Then the change does not affect the live bracket
      And the published bracket still reflects the drawn structure

      Examples:
        | setting    |
        | teamCount  |
        | format     |
        | seed       |

    @draw @audit
    Scenario: The seed is published so the locked draw stays verifiable
      Given a bracket has been drawn with seed "autumn-2026"
      When the public bracket is published
      Then the seed "autumn-2026" appears on it
      And anyone can reproduce the identical bracket from the seed and the field
      # A locked setting the public can independently check is the point: the
      # organizer proves they did not rig the draw rather than asking for trust.

  Rule: A confirmed result locks that match

    @results @critical
    Scenario: A decided match refuses a second result
      Given match "r8-m1" has been confirmed with winner "88BD"
      When the organizer submits winner "WXS7" for "r8-m1"
      Then the console refuses with "Match r8-m1 already decided (88BD)."
      And the bracket is unchanged

    @results @pending
    Scenario: A mistaken confirmation can be reversed under an audit trail
      Given match "r8-m1" was confirmed for "88BD" in error
      When the organizer reverses the result within the same phase
      Then the reversal is recorded with a reason
      And the reversal appears in the published match history
      And every downstream match fed by "r8-m1" is reset
      # NOT YET IMPLEMENTED — today the ONLY recovery from a mis-click is a full
      # tournament reset. This is the highest-value gap in the lock ladder.

  Rule: Locks survive a device change

    @backup @critical
    Scenario: Restoring a backup does not unlock what was locked
      Given a bracket was drawn and 3 matches confirmed
      And the organizer restores that state on a new device
      Then the field is still locked
      And the 3 confirmed matches still refuse new results
      And the seed is unchanged

  @schedule
  Scenario: activePhase stays editable but never rewrites the bracket
    Given the tournament is in the "Round of 16" phase
    When the organizer pushes "activePhase" back to an earlier stage
    Then the change takes effect for every visitor at once
    But it changes no completed result in the bracket
    # activePhase drives presentation, never the bracket: results are facts
    # produced by applyResult/computeQueue; activePhase is just a label for
    # where things stand.
