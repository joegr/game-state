@public @bracket @dashboard
Feature: Public bracket
  As a spectator
  I want an anonymized view of the whole tournament and its progress
  So that anyone can follow the competition without any access to it

  The public bracket is the spectator's primary screen: the live stage, a
  countdown, and the tree of four-character codes filling in as matches close.
  It is a static file; there is nothing to log in to and nothing to query.

  Background:
    Given a published tournament

  Rule: Before the draw, the public view is the roadmap

    @roadmap
    Scenario: Showing the schedule before any match exists
      Given the draw has not happened
      When a spectator opens the public bracket
      Then the phase roadmap is shown
      And each phase shows its label, its start time and its blurb
      And each phase is marked past, active or upcoming
      And no empty bracket is drawn

  Rule: After the draw, the public view is the bracket

    @smoke
    Scenario: The anonymized tree
      Given a 3-round bracket has been published
      When a spectator opens the public bracket
      Then they see one column per round
      And each match shows its two team codes
      And decided matches show the winner marked
      And losers are shown struck through

    @progress
    Scenario: Progress is quantified
      Given 12 of 31 matches have been decided
      Then the bracket reports "32 teams · 12/31 matches decided"
      And a progress bar reflects that proportion

    @progress
    Scenario: A bye is shown honestly
      Given a first-round match has only one team
      Then the empty slot is labelled "bye"
      And the team is shown as having advanced

    @audit
    Scenario: The seed is published alongside the bracket
      Given the bracket was drawn with seed "autumn-2026"
      Then the seed is displayed
      And it is described as a reproducible, seeded random draw

  Rule: The public view never carries identity

    @privacy @critical
    Scenario: Only codes are ever published
      When a spectator reads the entire published bracket file
      Then every participant is represented by a four-character code
      And no name, handle, email or public key appears
      And no captain's fixture blob can be opened

    @privacy
    Scenario: Codes are stable across the tournament
      Given team "88BD" appears in the first round
      When they advance to the final
      Then they are still shown as "88BD"
      And a spectator can follow one team's run through the tree

  Rule: Completion is presented as a result, not a state change

    @completion
    Scenario: Crowning the champion
      Given the final has been confirmed for "G1BI"
      When a spectator opens the public bracket
      Then the stage reads "Champion crowned"
      And the champion "G1BI" is shown prominently
      And no countdown is displayed

  Rule: The public view degrades gracefully

    @resilience
    Scenario: A missing published bracket does not break the page
      Given "public.json" cannot be loaded
      Then the page still renders the clock-driven stage and roadmap
      And no error is shown to the spectator

    @responsive
    Scenario: The bracket is usable on a phone
      Given a spectator on a 375px-wide screen
      Then the page does not scroll horizontally
      And the bracket itself scrolls within its own container
