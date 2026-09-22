@organizer @setup @config
Feature: Tournament setup and stages
  As an organizer
  I want the tournament's stage to be derived from published files and gated by one table
  So that nothing can happen out of order, and a broken record can never be "sort of" used

  Three repositories. The public app repo holds the site and
  config/tournament.md, the spine. The public roster repo holds roster.md
  and results.md, the record everyone reads. The private tentative repo holds
  the queue. The stage is derived from the public files by one function,
  reconstruct(), used by every page, every workflow and the CLI.

  Rule: The stage is derived, never set directly

    Scenario Outline: Deriving the stage
      Given tournament.md has phase kind "<phase>", draw seed "<seed>" and Round "<round>"
      And the published results replay cleanly
      Then the stage is "<stage>"

      Examples:
        | phase    | seed | round | stage        |
        | signup   | none | none  | registration |
        | knockout | none | none  | closed       |
        | knockout | set  | 1     | round        |
        | complete | set  | done  | complete     |

  Rule: One gate table decides what each stage allows

    Scenario Outline: The gates
      Given the stage is "<stage>"
      Then "<action>" is <allowed>

      Examples:
        | stage        | action         | allowed     |
        | registration | signup intake  | allowed     |
        | registration | score intake   | refused     |
        | registration | draw           | refused     |
        | closed       | admit          | allowed     |
        | closed       | draw           | allowed     |
        | closed       | signup intake  | refused     |
        | round        | score intake   | allowed     |
        | round        | admit          | refused     |
        | round        | draw           | refused     |
        | complete     | score intake   | refused     |

    @critical
    Scenario: Every consumer asks the same gate
      Then the captain pages, the intake workflow, the batch workflow, the stage workflow and the CLI
        all refuse the same action in the same stage, with the same reason

  Rule: A record that contradicts itself freezes everything

    @critical
    Scenario Outline: What makes the record invalid
      Given <problem>
      Then the stage is "invalid"
      And every intake, acceptance and stage change is refused until it is fixed
      And only look commands and a confirmed reset still run

      Examples:
        | problem                                                        |
        | results.md has a result but there is no draw seed              |
        | there is a draw seed but no Round                              |
        | a result names a winner who did not play in that match         |
        | a match appears twice in results.md                            |
        | a result's winner does not have the higher score               |
        | a result is for a round that has not been reached              |
        | Round k is current but an earlier round still has an open match |
        | roster.md lists a team twice, or exceeds capacity              |

    Scenario: CI watches the live record
      When anything is pushed to the app repo
      Then CI reconstructs the live public record with the same function
      And fails if it does not replay cleanly

  Rule: tournament.md is edited only by confirmed stage changes

    Scenario: The spine
      Then tournament.md holds the name, team count, group size, format, the three repos,
        the active phase, the draw seed, the round, and the phase table
      And there is no JSON file anywhere in any repository

    Scenario: Hand edits are tolerated but not trusted
      Given someone edits tournament.md by hand with odd spacing or casing
      Then it still parses
      But a hand edit that breaks an invariant makes the stage "invalid"
