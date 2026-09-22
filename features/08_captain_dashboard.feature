@captain @dashboard @privacy
Feature: Captain dashboard
  As a captain
  I want one screen that tells me where I stand and what to do next
  So that I never need to read the whole bracket or ask the organizer anything

  This is the captain's primary screen. It answers three questions and nothing
  else: who am I, how far have I got, and what is my next action. Everything on
  it is decrypted from a blob sealed to this captain alone.

  Background:
    Given a bracket has been drawn and published
    And the captain holds their key

  Rule: A captain decrypts exactly one view — their own

    @crypto @critical
    Scenario: Opening my own view
      Given the published bracket carries a sealed view for every team
      When captain "88BD" loads their key
      Then their view decrypts successfully
      And it describes only their own position

    @crypto @critical
    Scenario: A captain cannot read another captain's view
      Given the published bracket carries a sealed view for "WXS7"
      When captain "88BD" attempts to decrypt it
      Then decryption fails
      And nothing about "WXS7" is revealed

    @crypto @critical
    Scenario: No captain can enumerate the field
      When a captain inspects the published bracket file
      Then they see sealed blobs keyed by team code
      And they can open exactly one
      And the contents of every other blob remain opaque

    @errors
    Scenario: Loading the wrong key fails clearly
      When a captain loads a key that matches no published view
      Then they are told the key does not match the published fixture
      And they are prompted to load the correct captain key

  Rule: The dashboard states progress in one line

    @smoke
    Scenario Outline: The status a captain sees
      Given the captain's sealed view has status "<status>"
      When they open the dashboard
      Then the headline reads "<headline>"
      And the stage is shown as "<stage>"

      Examples:
        | status     | headline            | stage          |
        | scheduled  | Match scheduled     | Quarter-finals |
        | bye        | Bye — you advance   | Quarter-finals |
        | eliminated | Eliminated          | Eliminated     |
        | champion   | Champion            | Champion       |

    @fixture
    Scenario: A scheduled fixture shows the opponent and the time
      Given captain "88BD" is scheduled against "WXS7"
      When they open the dashboard
      Then they see their own code "88BD"
      And they see their opponent's code "WXS7"
      And they see the match start time in their local timezone
      And they see the match identifier for reporting

    @fixture
    Scenario: An undecided opponent is shown honestly
      Given the captain's next opponent has not been decided
      Then the dashboard shows the fixture without an opponent
      And tells the captain to wait
      And offers no score reporting for that fixture

    @fixture
    Scenario: Before the draw there is no fixture to show
      Given the draw has not happened
      When a registered captain opens the dashboard
      Then they are told their team is registered
      And they are told fixtures appear once the draw has run

  Rule: The dashboard offers exactly one action at a time

    @action
    Scenario: The only action on a live fixture is reporting the score
      Given the captain has a scheduled fixture with a known opponent
      Then the dashboard offers score reporting
      And it offers no other action

    @action
    Scenario: A finished run offers no action
      Given the captain has been eliminated
      Then no action is offered
      And their run is acknowledged

    @action
    Scenario: A champion sees the outcome, not a task
      Given the captain won the final
      Then the dashboard declares them champion
      And no further action is offered

  @privacy
  Scenario: The dashboard reveals nothing about the wider field
    When a captain reads their entire dashboard
    Then they learn their own code, their stage, and their next opponent's code
    And they learn nothing about any other match
    And they learn nothing about how many teams remain
    # Minimal disclosure: a captain's view is the smallest slice that still
    # lets them play their next match.
