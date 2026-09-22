@captain @organizer @scores @critical
Feature: Score reporting and confirmation
  As a captain
  I want a result to require my opponent's agreement as well as mine
  So that no single captain can invent a score, and the organizer can only confirm one

  A result takes three assents: both captains report the same score, and the
  organizer publishes it. The engine computes agreement; it never advances the
  bracket on its own. Only a confirmed result becomes part of the record.

  A report carries the captain's team code and their token. The organizer
  checks the token against the hash in roster.md, which proves the report came
  from whoever registered that team. This is a shared secret, not a signature —
  see 07_data_minimization for exactly what that does and does not prove.

  Background:
    Given a bracket has been drawn
    And both captains of a match hold their own score report key

  Rule: The reporting page offers only matches that are actually open

    The bound is exact: both sides known, no winner recorded, and this team is
    one of the two. Everything outside it is explained, not silently hidden.

    @smoke @critical
    Scenario: Reporting a score
      Given a captain pastes their key on the reporting page
      Then the key is checked against the hash published in roster.md
      And they are shown only their own open match
      When they enter their score and their opponent's
      Then they get a blob to send the organizer
      And it carries their code, their key, the match id and both scores

    @critical
    Scenario Outline: Having nothing to report is always explained
      Given a captain whose situation is "<situation>"
      When they open the reporting page
      Then no match is offered
      And they are told "<because>"

      Examples:
        | situation                | because                             |
        | entry not ingested yet   | you are not on the published roster |
        | the draw has not run     | there are no matches yet            |
        | opponent still undecided | waiting on your opponent            |
        | eliminated               | your run is over                    |
        | tournament complete      | no further results can be reported  |

    Scenario: A decided match stops being reportable immediately
      Given a match has a confirmed winner
      Then neither captain is offered it again

    Scenario: A match with one side filled is not offered
      Given a second-round match has only one side filled
      Then it is not offered to the team already in it
      And no consensus is computed for it

    @auth @critical
    Scenario: A key that does not match the roster is refused at the page
      Given a pasted key whose token does not hash to the published entry
      Then the captain is told so, and no match is offered
      # Caught here, rather than by the organizer an hour later.

    @auth @critical
    Scenario: A captain cannot report as another team
      Given someone pastes a key carrying another team's code
      Then the code is re-derived from the token, not taken from the text
      And they are offered their own matches, never the other team's
      And a forged report is discarded on ingest as unauthenticated
      # Their word counts for exactly one side of one result.

    @privacy
    Scenario: The page submits nothing anywhere
      When a captain creates a report
      Then the key never leaves their device
      And the report is a blob for them to send through their own channel

  Rule: Agreement is computed, never negotiated

    @consensus
    Scenario: Two mirrored reports agree
      Given both captains report the same match with mirrored scores
      When the organizer tallies
      Then the match is "agreed" with the higher scorer as winner
      And the exact command to publish it is printed

    @consensus
    Scenario: Conflicting reports are a dispute, not a result
      Given the two captains report scores that do not mirror
      Then the match is "disputed"
      And it does not advance
      And both claims are visible to the organizer

    @consensus
    Scenario: One report is not a result
      Given only one captain has reported
      Then the match is "awaiting" the other side
      And it does not advance

    @consensus
    Scenario: A captain who corrects themselves is taken at their latest word
      Given a captain reports twice for the same match
      Then their most recent report is the one counted

    @consensus
    Scenario: Pending reports are never published
      Given reports have been collected but no result confirmed
      Then nothing about them appears in any public file
      # Agreement is working state. Only a fact gets published.

  Rule: The organizer publishes the result, and that is the confirmation

    @critical
    Scenario: Confirming an agreed match
      Given a match is agreed with a winner and a score
      When the organizer publishes that result
      Then it is validated against the bracket rebuilt from the live record
      And appended to results.md in the roster repo via gh
      And the winner feeds forward into the correct slot of the next round

    Scenario: A result that does not fit the bracket is refused
      Given a result names a match or a winner that does not exist in the bracket
      Then it is refused with the reason
      And nothing is published

    @locking
    Scenario: A confirmed match refuses a second result
      Given a match has been confirmed
      When any further result is submitted for it
      Then it is refused and the bracket is unchanged

    @dispute @walkover
    Scenario: Disputes and no-shows are the same deliberate act
      Given a match is disputed, or nobody reported it at all
      When the organizer decides it
      Then they publish the result exactly as they would any other
      And the commit in results.md is the public record of that decision
      # There is no separate override path to take by accident. Deciding a
      # match always means an organizer choosing a winner, in public, by name.

  Rule: The final result completes the tournament

    @completion
    Scenario: Crowning a champion
      Given the final is the last undecided match
      When the organizer confirms it
      Then the tournament status becomes complete
      And the champion's code is shown on the public bracket
      And local pending reports are cleared

    @completion
    Scenario: A complete tournament accepts no further results
      Given the tournament is complete
      Then no match is offered for reporting or confirmation
