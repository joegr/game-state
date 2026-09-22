@organizer @results @critical
Feature: Result confirmation
  As a captain
  I want the bracket to advance only after a human with the organizer key says so
  So that a result needs three independent assents, not one

  Triple confirmation: both captains agree, AND the organizer confirms. The
  engine computes and proposes; only the organizer commits. Every override of
  that rule is deliberate, named and visible.

  Background:
    Given the organizer console is unlocked
    And a bracket has been drawn

  Rule: Confirming an agreed match advances the bracket

    @smoke
    Scenario: Confirming a match
      Given match "r8-m1" is agreed with winner "88BD"
      When the organizer confirms and advances it
      Then "88BD" is recorded as the winner of "r8-m1"
      And "88BD" is fed into the correct slot of the next round
      And the match leaves the queue

    @confirmation
    Scenario: The organizer is asked to confirm before the bracket moves
      Given match "r8-m1" is agreed with winner "88BD"
      When the organizer initiates confirmation
      Then they are asked to confirm the winner and the advance
      And nothing changes until they agree

    @feed-forward
    Scenario: Winners feed forward into the correct side of the next match
      Given first-round matches 1 and 2 feed the same second-round match
      When match 1 is confirmed
      Then its winner occupies the first slot of that second-round match
      When match 2 is confirmed
      Then its winner occupies the second slot
      And that second-round match becomes playable

    @feed-forward
    Scenario: A match becomes reportable only once both sides are known
      Given a second-round match has one slot filled
      Then it is not offered for reporting
      And no consensus is computed for it

  Rule: Disputes are resolved explicitly, by a named override

    @dispute
    Scenario: Overriding a disputed match
      Given match "r8-m2" is disputed between "PTNO" and "RS4L"
      Then the organizer is shown both captains' claims
      And offered an explicit override for each side
      When the organizer overrides in favour of "PTNO"
      Then they must confirm the override
      And "PTNO" is recorded as the winner
      And the bracket advances

    @dispute
    Scenario: An override is visibly an override
      When the organizer resolves a dispute manually
      Then the action is labelled as an override, not a confirmation
      # The interface never lets an organizer resolve a dispute by accident or
      # mistake it for ordinary consensus.

  Rule: Walkovers exist for matches nobody reported

    @walkover
    Scenario: Awarding a walkover
      Given match "r8-m3" is playable but has no reports at all
      Then it appears only under the manual override section
      When the organizer awards the match to "53WT"
      Then they must confirm the walkover
      And "53WT" advances

    @walkover @guard
    Scenario: Walkovers are kept away from the routine flow
      Then the manual override section is collapsed by default
      And described as being for walkovers and no-shows
      # Using it skips consensus entirely, so it is never the path of least
      # resistance.

  Rule: Confirmation is final within the tournament

    @locking
    Scenario: A confirmed match refuses a second result
      Given match "r8-m1" was confirmed for "88BD"
      When any further result is submitted for "r8-m1"
      Then it is refused with "Match r8-m1 already decided (88BD)."
      And the bracket is unchanged

    @locking @pending
    Scenario: Reversing a mistaken confirmation
      Given match "r8-m1" was confirmed for the wrong team
      When the organizer reverses it with a stated reason
      Then the result is cleared
      And every downstream match fed by it is reset
      And the reversal is recorded in the published history
      # NOT YET IMPLEMENTED — today the only recovery is a full reset of the
      # tournament state, or restoring a backup taken before the mistake.

    @locking @workaround
    Scenario: Recovering from a mistake today
      Given match "r8-m1" was confirmed for the wrong team
      And the organizer holds a backup taken before the confirmation
      When they restore that backup
      Then the tournament returns to its pre-confirmation state
      And every correct confirmation made since must be redone

  Rule: The final result completes the tournament

    @completion
    Scenario: Crowning a champion
      Given the final is the last undecided match
      When the organizer confirms it
      Then the tournament status becomes complete
      And the winner is recorded as champion
      And the dashboard shows the champion

    @completion
    Scenario: A complete tournament accepts no further results
      Given the tournament is complete
      Then no match is offered for confirmation
      And the result queue is empty

    @completion @privacy
    Scenario: Completion cascades a purge of per-captain data
      Given the tournament has completed
      When the organizer runs the completion purge
      Then collected entries and score reports are deleted
      And per-captain sealed views are cleared
      And only the champion's code and the final bracket remain
      # Data minimisation extends past the end: a finished tournament keeps the
      # result, not the participants.
