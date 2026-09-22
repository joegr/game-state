@organizer @auth @state-machine
Feature: Organizer authority
  As a captain or spectator
  I want exactly one person to be able to change the tournament, by a means I can audit
  So that there is no hidden account, no shared secret and no silent edit

  Being the organizer means one thing: holding a GitHub login with push access
  to the app repo and the roster repo. There is no key file, no password, no
  session and no service to compromise. Every change to the record is a commit
  by a named account, visible in a public repository's history forever.

  `tools/advance.mjs` is the only thing in this codebase that writes anything,
  and it only ever writes by shelling out to `gh`. So GitHub's own
  authorization is the gate — the app does not implement one.

  Background:
    Given the app repo and the roster repo are both public
    And every published change is a commit in one of them

  Rule: gh push access is the only credential

    @critical
    Scenario: Someone without push access cannot change anything
      Given a person can read both repositories
      When they attempt to publish a roster entry, a result or a phase change
      Then GitHub refuses the push
      And the published tournament is unchanged
      # There is nothing to bypass in the app, because the app never writes.

    @critical
    Scenario: The CLI refuses to act unauthenticated
      Given `gh` is not logged in
      When the organizer runs any publishing command
      Then it stops with a message telling them to run `gh auth login`
      And nothing is written

    @audit
    Scenario: Every change is attributable
      When the organizer advances a phase or confirms a result
      Then a commit appears in the public repository
      And it names the account that made it, the file and the exact change
      And anyone can read that history without permission

  Rule: The phase changes only by a push

    The stage lives in one field — "Active phase" in config/tournament.md —
    and changes only when the organizer publishes a new value. There is no
    clock anywhere in this picture: no start timestamps, no countdown, nothing
    that advances on its own.

    Scenario Outline: The stage is read, never derived
      Given "Active phase" is "<id>"
      Then the current stage is "<phase>"
      And every phase before it in the list is "past"
      And every phase after it in the list is "upcoming"

      Examples:
        | id            | phase            |
        | signup        | Registration     |
        | r16           | Round of 16      |
        | quarterfinals | Quarter-finals   |
        | complete      | Champion Crowned |

    @critical
    Scenario: The organizer advances the stage
      Given "Active phase" is "signup"
      When the organizer runs the stage command for "r16"
      Then config/tournament.md is pushed to the app repo via gh
      And Pages redeploys
      And every visitor now sees "Round of 16" as the current stage

    Scenario: The stage never changes without a push
      Given "Active phase" is "signup"
      When arbitrarily much real time passes with no commit
      Then the current stage is still "Registration"
      # No clock, no timer, no drift. A stage change is indistinguishable from
      # a git push, because that is exactly what it is.

    Scenario: A bad phase id is refused before it is published
      When the organizer names a phase that is not in the table
      Then the CLI lists the valid ids and stops
      And nothing is pushed

    @resilience
    Scenario: A visitor with a wrong device clock sees what everyone sees
      Given a visitor's device clock is wrong by any amount
      Then they see the stage from the last published config
      # There is no clock read anywhere in this path, so skew cannot produce a
      # different answer for different visitors.

  Rule: The organizer's own screen is a status view, not a console

    admin.html shows the organizer the same public data as everyone else, plus
    a dry-run inbox and the exact commands to run next. It cannot write.

    Scenario: The organizer sees what to do next
      When the organizer opens admin.html
      Then they see the live phase, the confirmed roster count and the bracket
      And a list of the exact `advance.mjs` commands appropriate to that state

    @dry-run
    Scenario: Pasting blobs into the browser changes nothing
      When the organizer pastes signup entries and score reports into the inbox
      Then each is classified and checked against the live roster
      And the result of that check is displayed
      And nothing is stored, published or remembered
      # To actually publish, the same text goes through `advance.mjs ingest`.

    @not-a-credential
    Scenario: The PIN is a view toggle, not a security boundary
      Given the organizer has set a PIN on this device
      Then it only switches this browser to the organizer-flavored view
      And it protects nothing, because there is nothing sensitive behind it
      And the interface says so in as many words

    @durability
    Scenario: Losing the browser loses nothing
      Given the organizer clears site data, or switches to another machine
      When they open admin.html again
      Then the full tournament is still there, refetched from the two repos
      And the only thing lost is unpublished score reports on the old machine
      # There is no backup to take. The record is git history; durability is
      # GitHub's problem, not the organizer's.
