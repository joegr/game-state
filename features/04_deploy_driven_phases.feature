@public @schedule @state-machine
Feature: Deploy-driven phases
  As anyone looking at the tournament
  I want the current stage to be an explicit, committed fact
  So that the tournament only ever moves forward because the organizer said so

  The stage lives in one field — `activePhase` in config/tournament.json — and
  changes only when the organizer edits it and pushes. There is no clock
  anywhere in this picture: no `start` timestamps, no countdown, nothing that
  advances on its own. Every visitor reads the same static config, so there is
  nothing to poll and nothing that can drift out of sync between visitors.

  Background:
    Given a tournament with the phases
      | id            | label            |
      | signup        | Registration     |
      | r16           | Round of 16      |
      | quarterfinals | Quarter-finals   |
      | semifinals    | Semi-finals      |
      | final         | The Final        |
      | complete      | Champion Crowned |

  Rule: The active phase is exactly the one named by activePhase — nothing else

    Scenario Outline: The stage is read, never derived
      Given "activePhase" is "<id>"
      Then the current stage is "<phase>"
      And every phase before it in the list is "past"
      And every phase after it in the list is "upcoming"

      Examples:
        | id            | phase            |
        | signup        | Registration     |
        | r16           | Round of 16      |
        | quarterfinals | Quarter-finals   |
        | final         | The Final        |
        | complete      | Champion Crowned |

    Scenario: Phase order comes from declaration order, not from any field
      Given the phases are declared in a fixed list
      Then the roadmap's past/current/upcoming split follows that list order
      And nothing about a phase's position depends on a date

    Scenario: The stage never changes without a new deploy
      Given "activePhase" is "signup"
      When arbitrarily much real time passes with no commit to the repository
      Then the current stage is still "Registration"
      # This is the whole point: no clock, no timer, no drift. A stage change
      # is indistinguishable from a git push.

  Rule: Advancing the tournament means editing config and pushing

    @critical
    Scenario: The organizer advances the stage
      Given "activePhase" is "signup"
      When the organizer edits "activePhase" to "r16" in config/tournament.json
      And commits and pushes that change
      Then the deploy workflow republishes the site
      And every visitor now sees "Round of 16" as the current stage

    Scenario: A bad edit fails safe
      Given the organizer sets "activePhase" to an id that matches no phase
      Then the site falls back to the first declared phase
      And no visitor sees a broken or blank stage

  Rule: The clock gates nothing — only the organizer's actions do

    Scenario: Registration is offered based on the key, not the phase or the clock
      Given "organizerPublicKey" is set
      When a visitor opens the landing page or the captain sign-up
      Then registration is offered regardless of "activePhase"
      # Whether entries are actually accepted into the bracket is an organizer
      # decision made in the Inbox, not a gate enforced by a date.

    Scenario: The public "Register your team" call to action follows the phase
      Given "activePhase" is "signup"
      When a visitor opens the public bracket
      Then a "Register your team" call to action is shown
      When the organizer pushes "activePhase" as "r16"
      Then that call to action is absent for every subsequent visitor

  @resilience
  Scenario: A visitor with a skewed device clock sees the same stage as everyone else
    Given a visitor's device clock is wrong by any amount
    Then they still see the stage from the last committed config
    And the published bracket remains the authority on results
    # There is no clock read anywhere in this path, so clock skew cannot
    # produce a different answer for different visitors.
