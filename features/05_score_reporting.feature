@captain @organizer @scores @critical
Feature: Scores — intake, queue, accept, publish a round
  As a captain
  I want a result to need my opponent's agreement and the organizer's acceptance
  So that no single person can invent a score, and the bracket can never be broken

  A score travels the same road as a registration. The captain submits,
  intake checks and queues it privately, the batch folds it in, the
  organizer accepts it privately, and the whole round is published when the
  organizer confirms "advance". Stages are rounds. Only the current round's
  matches take scores.

  Background:
    Given the stage is "round" with Round k

  Rule: Only the current round's open matches take scores

    @smoke
    Scenario: Submitting from the captain view
      Given a captain is signed in and their round-k match has both sides known
      When they enter both scores and submit
      Then the page dispatches the intake workflow with their code, PIN, match and scores
      And shows the intake's verdict when it comes back

    @critical
    Scenario Outline: What intake refuses
      When a submission arrives <situation>
      Then intake refuses it with a reason and queues nothing

      Examples:
        | situation                                                 |
        | for a match in a later round, even if both sides are known |
        | for a match this team is not in                           |
        | with a tie or a non-whole-number score                    |
        | for a match the organizer has already accepted            |
        | from a team not on the published roster                   |
        | while the stage is not "round"                            |

    Scenario: Wrong PIN
      When a submission carries the wrong PIN
      Then it is refused, a wrong-PIN attempt is recorded, and the captain is told how many remain
      And the captain view signs the device out so they re-enter the PIN
      And after 5 wrong PINs the team is locked, and a locked team's submissions write nothing

    Scenario: A correct PIN clears earlier mistakes
      Given a team has wrong-PIN attempts on record
      When it submits with the right PIN
      Then its attempts are cleared at the next batch

  Rule: The batch re-checks everything at batch time

    Scenario: The world moved between intake and batch
      Given a score was accepted at intake
      And its match was accepted or the round advanced before the batch ran
      Then the batch drops it and logs why in rejected.md

    Scenario: Resubmitting
      When a captain resubmits for the same match
      Then the later submission replaces the earlier one

  Rule: The organizer compares both sides and accepts privately

    Scenario: The acceptance queue
      Then the organizer sees every open match with both captains' submissions side by side
      And each is agreed, disputed, one in, or none in

    Scenario: Accepting
      When the organizer accepts an agreed match
      Then it is recorded in the private accepted list
      And nothing public changes
      And further submissions for that match are refused

    Scenario: Disputes, no-shows, corrections
      Then the organizer can clear a match's submissions so both captains resubmit
      And decide any open match themselves with a winner and a score
      And take back an acceptance until the round is published

  Rule: A round is published whole, and only when complete

    @critical
    Scenario: Advancing
      Given every open match in round k has an accepted result
      When the organizer confirms "advance"
      Then all of round k's results are published to results.md in one commit
      And Round becomes k+1, or "done" after the final
      And round k+1's matches open for scores

    Scenario: A partial round cannot be advanced
      Given any match in round k has no accepted result
      Then advance is refused, naming the missing matches

    Scenario: The winner logic cannot be broken
      Then every published result names a winner who played in that match with the higher score
      And every result is validated against the bracket as it stands after the ones before it
      And a result that fails any of this is never published
