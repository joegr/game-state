@captain @scores @crypto
Feature: Score reporting
  As a captain
  I want to report my match result in a way nobody else could have forged
  So that my word counts for exactly one side of the result and no more

  A score report is an AUTHENTICATED box: encrypted to the organizer with the
  captain's own static key rather than an anonymous ephemeral one. The embedded
  sender key proves which captain produced it.

  Background:
    Given a bracket has been drawn and published
    And captain "88BD" is scheduled against "WXS7" in match "r8-m1"
    And captain "88BD" holds their key

  Rule: Reporting is offered only where it is meaningful

    @gating
    Scenario: A live fixture offers reporting
      Given the captain's view has status "scheduled" with a known opponent
      Then the dashboard offers score reporting for that match

    @gating
    Scenario Outline: Reporting is withheld everywhere else
      Given the captain's view has status "<status>"
      Then no score reporting is offered

      Examples:
        | status     |
        | bye        |
        | eliminated |
        | champion   |

    @gating
    Scenario: Reporting is withheld when the opponent is undecided
      Given the captain's next fixture has no opponent yet
      Then no score reporting is offered
      And the captain is told to wait

  Rule: A report is authenticated to exactly one captain

    @crypto @critical
    Scenario: Sealing a report
      When captain "88BD" reports 3 to 1 for match "r8-m1"
      Then the report is sealed to the organizer's public key
      And the captain's own public key is embedded as the sender
      And the organizer can determine the report came from "88BD"

    @crypto @critical
    Scenario: A captain cannot forge another captain's report
      Given captain "WXS7" wants to report on behalf of "88BD"
      When they attempt to produce a report embedding "88BD" as the sender
      Then they cannot, because they do not hold "88BD"'s private key
      And any such attempt fails authentication at the organizer

    @crypto
    Scenario: The report carries the minimum possible payload
      When a captain reports a score
      Then the sealed report decrypts to exactly
        | field    | meaning                        |
        | v        | payload version                |
        | matchId  | which match this concerns      |
        | myScore  | the reporter's score           |
        | oppScore | the opponent's score           |
        | ts       | when the report was created    |
      And it carries no identity beyond the embedded key

    @crypto @threat-model
    Scenario: The organizer could forge a captain's report
      Given the organizer holds the organizer private key
      Then they could construct a report indistinguishable from a captain's
      # Stated openly. Authentication binds captains against EACH OTHER, which
      # is what consensus needs. The organizer is already trusted to confirm
      # every result, so this grants them nothing they did not already have.

  Rule: Reports are validated before they are sealed

    @validation
    Scenario Outline: Rejecting scores that cannot decide a knockout match
      When the captain submits <entry>
      Then they are told "<message>"
      And no report is sealed

      Examples:
        | entry                     | message                                        |
        | an empty score            | Enter both scores.                             |
        | a non-numeric score       | Enter both scores.                             |
        | equal scores 2 and 2      | Ties cannot advance a single-elimination match |

    @validation
    Scenario: Scores must be whole and non-negative
      When the captain submits a negative or fractional score
      Then the report is refused
      And the captain is asked for a decisive whole score

  Rule: A captain can correct a report they already sent

    @correction
    Scenario: Re-reporting supersedes the earlier report
      Given captain "88BD" previously reported 3 to 1 for "r8-m1"
      When they report 4 to 1 for the same match
      Then a new sealed report is produced
      And the organizer treats the latest timestamp as authoritative
      And the earlier report is disregarded

    @correction @ux
    Scenario: The captain is reminded what they already reported
      Given captain "88BD" reported 3 to 1 on this device
      When they return to the fixture
      Then they are shown their previous report
      And told that re-submitting overrides it

  Rule: Delivery is out of band, like everything else

    @handoff
    Scenario: The captain sends the sealed report to the organizer
      When a report has been sealed
      Then the captain is shown the blob to copy
      And told to send it to the organizer through the tournament channel
      And told it advances the match only if their opponent reports the same
      And nothing is transmitted by the platform
