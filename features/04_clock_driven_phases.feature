@public @schedule @state-machine
Feature: Clock-driven phases
  As anyone looking at the tournament
  I want the current stage to be a pure function of the clock
  So that nobody has to be online, trusted or polled for the tournament to progress

  The stage is derived, never stored: it is the last phase whose UTC start has
  passed. Every visitor computes the same answer from the same static config,
  which is why the platform needs no server to "advance" anything.

  Background:
    Given a tournament with the phases
      | id            | label            | start                |
      | signup        | Registration     | 2026-10-01T00:00:00Z |
      | r16           | Round of 16      | 2026-11-15T00:00:00Z |
      | quarterfinals | Quarter-finals   | 2026-11-22T00:00:00Z |
      | semifinals    | Semi-finals      | 2026-11-29T00:00:00Z |
      | final         | The Final        | 2026-12-06T00:00:00Z |
      | complete      | Champion Crowned | 2026-12-08T00:00:00Z |

  Rule: The active phase is the last one whose start has passed

    Scenario Outline: Deriving the stage from the clock
      Given the current time is "<now>"
      Then the active phase is "<phase>"
      And every phase before it is "past"
      And every phase after it is "upcoming"

      Examples:
        | now                  | phase            |
        | 2026-10-02T00:00:00Z | Registration     |
        | 2026-11-16T12:00:00Z | Round of 16      |
        | 2026-11-22T00:00:00Z | Quarter-finals   |
        | 2026-12-07T00:00:00Z | The Final        |
        | 2026-12-09T00:00:00Z | Champion Crowned |

    Scenario: Phases are ordered by start time, not by declaration order
      Given the phases are declared out of chronological order
      Then they are sorted by start before the stage is derived
      And the derived stage is unaffected by declaration order

    @edge
    Scenario: A phase boundary is inclusive of its own start
      Given the current time is exactly "2026-11-15T00:00:00Z"
      Then the active phase is "Round of 16"
      And it is not "Registration"

    @edge @pending
    Scenario: Before the first phase opens, nothing is presented as live
      Given the current time is "2026-09-01T00:00:00Z"
      Then the roadmap shows "Registration" as "upcoming"
      And the hero does NOT describe any stage as "LIVE"
      # NOT YET IMPLEMENTED — today the hero falls back to the first phase and
      # labels it LIVE, contradicting the roadmap directly beneath it.

  Rule: The countdown is live and derived from the same clock

    @countdown
    Scenario: Counting down to the next transition
      Given the active phase ends at "2026-11-15T00:00:00Z"
      And the current time is "2026-11-13T19:48:57Z"
      Then a countdown of "1d 4h 11m 03s" is displayed
      And it ticks down once per second

    @countdown
    Scenario: The final phase has no countdown
      Given the active phase is the last declared phase
      Then no countdown is shown
      And the stage is presented as terminal

  Rule: The clock gates what a visitor is allowed to do

    @gating @critical @pending
    Scenario: Registration is offered only while the signup phase is active
      Given the current time is "2026-11-16T00:00:00Z"
      When a visitor opens the landing page
      Then no "Create my anonymous team" control is offered
      And they are told registration has closed
      # NOT YET IMPLEMENTED — the landing page does not consult the clock, so it
      # offers registration in every phase. The public bracket DOES gate its own
      # call to action correctly, so the two pages currently disagree.

    @gating @critical @pending
    Scenario: The captain sign-up honours the same gate
      Given the current time is past the signup phase
      When a visitor opens the captain sign-up
      Then registration is refused for the same reason and in the same words

    @gating
    Scenario: The public call to action respects the gate today
      Given the current time is "2026-10-05T00:00:00Z"
      When a visitor opens the public bracket
      Then a "Register your team" call to action is shown
      When the current time is "2026-11-16T00:00:00Z"
      Then that call to action is absent

  @resilience
  Scenario: A visitor with a skewed clock sees a skewed stage
    Given a visitor's device clock is 3 days fast
    Then they may see the next phase early
    And no data is corrupted by this
    And the published bracket remains the authority on results
    # Accepted trade-off of a serverless design: presentation can drift,
    # facts cannot.
