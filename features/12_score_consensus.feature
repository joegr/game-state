@organizer @scores @consensus
Feature: Score consensus
  As a captain
  I want a result to require my opponent's agreement as well as mine
  So that no single captain and no single organizer decision can invent a score

  Consensus is computed, not negotiated. Two authenticated reports that mirror
  each other produce an "agreed" match; anything else is surfaced as a conflict
  for a human to resolve. The organizer confirms; the engine never auto-advances.

  Background:
    Given a bracket has been drawn
    And match "r8-m1" is between "88BD" and "WXS7"

  Rule: Two mirrored reports make a match agreed

    @smoke @critical
    Scenario: Both captains agree
      Given "88BD" reports 3 to 1
      And "WXS7" reports 1 to 3
      When the queue is computed
      Then match "r8-m1" has status "agreed"
      And the winner is "88BD"
      And the score is recorded as 3 to 1
      And it appears under "Ready to confirm"

    @critical
    Scenario: Mirroring is checked in both directions
      Given "88BD" reports 3 to 1
      And "WXS7" reports 3 to 1
      When the queue is computed
      Then the reports do not mirror
      And match "r8-m1" has status "disputed"
      # Both captains claiming the same scoreline from their own perspective is
      # a contradiction, not an agreement.

  Rule: Anything short of agreement is surfaced, never resolved silently

    @states
    Scenario Outline: Classifying a match from its reports
      Given the reports for "r8-m1" are <reports>
      When the queue is computed
      Then match "r8-m1" has status "<status>"

      Examples:
        | reports                                  | status    |
        | none                                     | absent    |
        | only "88BD" reporting 3 to 1             | awaiting  |
        | "88BD" 3-1 and "WXS7" 1-3                | agreed    |
        | "88BD" 3-1 and "WXS7" 2-3                | disputed  |
        | "88BD" 2-2 and "WXS7" 2-2                | tie       |

    @states
    Scenario: An awaiting match names who has already reported
      Given only "88BD" has reported for "r8-m1"
      Then the queue shows the match as awaiting
      And it records that "88BD" reported
      And the organizer can see who to chase

    @states
    Scenario: A disputed match shows both claims side by side
      Given "88BD" reported 2 to 0
      And "WXS7" reported 2 to 1
      Then the queue shows both claims
      And presents them for manual resolution
      And offers no automatic winner

    @states
    Scenario: A mirrored tie cannot advance a knockout match
      Given both captains report an identical drawn score
      Then the match is flagged as a tie
      And it is grouped with disputes for manual resolution

  Rule: Only reports that could legitimately count are considered

    @validation @critical
    Scenario: A report from a non-participant is ignored
      Given captain "QMMD" reports on match "r8-m1"
      And "QMMD" is in neither side of that match
      When the queue is computed
      Then the report is discarded
      And it does not affect the match's status

    @validation
    Scenario: A report for a match that cannot be played is ignored
      Given a match whose opponents are not yet both known
      When reports arrive for it
      Then they are not counted toward consensus
      And the match does not enter the queue

    @validation
    Scenario: A report for an already-decided match is ignored
      Given match "r8-m1" has been confirmed
      When a further report arrives for "r8-m1"
      Then it does not reopen the match
      And the queue no longer lists it

    @validation
    Scenario: Malformed scores are discarded
      Given a report carries a negative, fractional or non-numeric score
      Then it is discarded before consensus is computed

  Rule: The latest report from each captain wins

    @correction
    Scenario: A captain's newer report supersedes their older one
      Given "88BD" reported 3 to 1 at 10:00
      And "88BD" reported 4 to 1 at 11:00
      And "WXS7" reported 1 to 4 at 11:05
      When the queue is computed
      Then only the 11:00 report from "88BD" is considered
      And the match is agreed at 4 to 1

    @correction
    Scenario: A correction can turn agreement back into a dispute
      Given match "r8-m1" was agreed at 3 to 1 and not yet confirmed
      When "WXS7" submits a corrected, conflicting report
      Then the match returns to "disputed"
      And it leaves the "Ready to confirm" list
      # Consensus is recomputed from scratch every time, so it is never stale.
