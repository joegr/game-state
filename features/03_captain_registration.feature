@captain @registration @pipeline
Feature: Registration — intake, queue, accept, publish
  As a captain
  I want to register without an account, and know my team is real only when the organizer says so
  So that I reveal nothing, and the field can't be padded or raced

  Registration travels the same road as a score. The captain submits, intake
  queues it privately, the batch folds it into the queue, the organizer admits
  it, and the roster is published only when the organizer closes registration
  or draws.

  Rule: Registering reveals a code and nothing else

    @smoke
    Scenario: Two generated fields
      Given registration is open
      When the captain generates a team code, then a PIN, then presses Register
      Then the page dispatches the intake workflow
      And shows progress until the intake's verdict comes back (about half a minute)
      And on acceptance the device stays signed in as that team
      And no name, email or account was asked for

    Scenario: The PIN never becomes public
      Then the private queue stores a salted hash of the PIN, never the PIN
      And the PIN never appears in any workflow log
      And nothing about the registration is public until the organizer publishes the roster

    Scenario: Registration closed
      Given the stage is not "registration"
      Then the page offers no registration form
      And an intake that arrives anyway is refused with the gate's reason

  Rule: Concurrent registrations cannot collide

    @critical
    Scenario: Fifty captains at once
      When many captains register in the same instant
      Then each intake run writes its own new, uniquely named inbox file
      And no registration overwrites another
      And the batch folds them all in one commit, in order

    Scenario: The same code twice
      Given a team code is already registered, admitted, or waiting in the inbox
      When another registration derives the same code
      Then it is refused and the captain is told to generate a new code

    Scenario: Registration closes between intake and batch
      Given a registration was accepted at intake
      And the organizer closed registration before the batch ran
      Then the batch drops it and logs why in rejected.md

  Rule: The organizer admits, privately; the roster is published at a stage change

    Scenario: Admitting
      When the organizer admits teams
      Then they are recorded in the private admitted list
      And the public roster does not change

    Scenario: Taking it back
      Given a team is admitted but the roster has not been frozen by the draw
      When the organizer un-admits it
      Then it returns to the waiting list

    Scenario: Rejecting
      When the organizer rejects a waiting registration
      Then it is removed by the next batch
      And an admitted team cannot be rejected until it is un-admitted

    @critical
    Scenario: Publishing the roster
      When the organizer confirms "close" or "draw"
      Then roster.md is published as exactly the admitted list, sorted by code
      And after the draw the roster is frozen — no team can be admitted or removed

    Scenario: Nobody left behind by accident
      Given registrations are still waiting
      When the organizer plans the draw
      Then it is refused, naming them, unless the organizer explicitly draws with --leave-pending
