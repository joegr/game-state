@organizer @dashboard
Feature: Organizer dashboard
  As an organizer
  I want one screen that shows tournament progress and what needs me right now
  So that running a tournament is a short list of decisions, not an investigation

  This is the organizer's primary screen. The ordering is deliberate: state of
  the tournament, then what has arrived, then what is blocked on my decision,
  then publishing, then the things I should rarely touch.

  Background:
    Given the organizer console is unlocked

  Rule: The dashboard leads with the state of the tournament

    @smoke
    Scenario: The status panel summarises everything at a glance
      Given 8 teams are on the roster
      And 4 score reports have been received
      And the bracket has been drawn with seed "autumn-2026"
      When the organizer opens the console
      Then the panel shows the tournament name
      And it shows the current stage
      And it shows "8 team(s) · 4 score report(s) · seed autumn-2026"

    @smoke
    Scenario Outline: The state badge
      Given the tournament is <state>
      Then the badge reads "<badge>"
      And the headline reads "<headline>"

      Examples:
        | state                     | badge    | headline          |
        | accepting entries         | OPEN     | Registration      |
        | drawn and in progress     | LIVE     | <current round>   |
        | finished                  | COMPLETE | Champion crowned  |

    @completion
    Scenario: A finished tournament shows its champion
      Given the final has been confirmed
      Then the dashboard shows the champion's team code prominently
      And the stage reads "Champion crowned"

  Rule: The dashboard surfaces work in priority order

    @triage @critical
    Scenario: Matches ready to confirm come first
      Given 3 matches have two-captain agreement
      And 2 matches are disputed
      And 1 match awaits a second captain
      When the organizer opens the result queue
      Then "Ready to confirm (3)" is presented first
      And "Disputed (2)" is presented next
      And "Awaiting a captain (1)" is presented after that

    @triage
    Scenario: Matches with no reports are tucked away
      Given 4 playable matches have received no reports at all
      Then they are collapsed under a manual override section
      And that section is described as being for walkovers and no-shows
      # Kept out of the main flow because using it bypasses consensus entirely.

    @triage
    Scenario: An empty queue says so plainly
      Given no score reports have been received
      Then the queue explains there is nothing to confirm yet
      And points the organizer at the inbox

  Rule: Before the draw, the dashboard is about building the field

    @registration
    Scenario: The registration panel replaces the queue before the draw
      Given the bracket has not been drawn
      Then the dashboard shows the registration panel
      And it shows the current roster size
      And it offers the draw once at least 2 teams exist
      And no result queue is shown

  Rule: Publishing is a first-class step on the dashboard

    @publishing @critical
    Scenario: Preparing the exports
      Given the bracket has been drawn
      When the organizer prepares the exports
      Then three files are generated
        | file         | contents                                  |
        | public.json  | the anonymized bracket and its progress    |
        | bracket.json | one sealed view per captain               |
        | queue.json   | the current score-consensus queue         |
      And each can be downloaded or copied

    @publishing
    Scenario: Publishing is committing
      Given the exports have been generated
      When the organizer replaces the files under "config/" and pushes
      Then the site redeploys
      And the public bracket reflects the new state
      And every captain's view reflects the new state
      And no token or server credential was involved

    @publishing
    Scenario: The dashboard states the publish loop explicitly
      When the organizer views the console
      Then it explains that publishing means committing the exported JSON
      # The most common operator error is confirming results and never pushing,
      # leaving the public bracket stale. The instruction stays on screen.

    @publishing @pending
    Scenario: The dashboard warns when confirmed results are unpublished
      Given 3 matches have been confirmed since the last export
      Then the dashboard warns that the published bracket is behind
      And it highlights the export step
      # NOT YET IMPLEMENTED — nothing currently tracks published-vs-local state.

  Rule: Destructive controls are separated and double-guarded

    @destructive
    Scenario: The danger zone is collapsed by default
      Then reset controls are not presented alongside routine actions
      And they sit behind a section labelled as dangerous

    @destructive @critical
    Scenario: Resetting the tournament requires two confirmations
      When the organizer chooses to reset the tournament state
      Then they must confirm they want to discard teams, reports and bracket
      And they must confirm again that there is no other copy
      And they are reminded to download a backup first
      And only then is the working state cleared
      And their organizer key is retained
