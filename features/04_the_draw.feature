@organizer @draw @integrity
Feature: The draw
  As a captain or spectator
  I want the bracket generated from a published seed and a published roster
  So that anyone can verify the organizer did not arrange the field

  The draw is a seeded shuffle of the published roster, sorted by team code.
  Both inputs are public, so anyone can regenerate the identical bracket.
  Nothing about the bracket is stored: every page, workflow and the CLI
  rebuild it from those inputs and replay results.md.

  Rule: The draw is one confirmed stage change

    @smoke
    Scenario: Drawing
      Given the stage is "closed" and at least 2 teams are admitted
      When the organizer confirms "draw"
      Then roster.md is published as the admitted list
      And tournament.md gets the draw seed and Round 1
      And round 1's matches open for scores

    Scenario: The plan shows the bracket
      When the organizer plans the draw
      Then the plan lists every round-1 pairing and bye before anything is published

    Scenario: The draw happens exactly once
      Given the stage is anything but "closed"
      Then the draw is refused
      # Registration must be closed first; after the draw the only way back is a confirmed reset.

    Scenario: Too few teams
      Given fewer than 2 teams are admitted
      Then the draw is refused

  Rule: Anyone can reproduce the bracket

    @critical @verifiable
    Scenario: A sceptic checks the organizer's work
      Given a spectator has roster.md and the published seed
      When they run the same shuffle
      Then they get the identical bracket, match for match

    @critical @determinism
    Scenario: Row order cannot change the bracket
      Given the same teams written into roster.md in different orders
      Then the files are byte-identical, because rows are sorted by code
      And the bracket is identical

    Scenario: Byes
      Given a field that is not a power of two
      Then the bracket pads to the next power of two
      And no match has two empty sides
      And a team drawn against an empty side goes through without playing
