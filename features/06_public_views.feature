@public @captain @dashboard
Feature: Public and captain views
  As a spectator or a captain
  I want the tournament rendered from the same public files everyone else reads
  So that there is no privileged version of the truth

  Every page — the public bracket, the captain's view, the organizer's own
  status screen — rebuilds the tournament in the browser from the same three
  files: `config/tournament.md`, `roster.md` and `results.md`. Same function,
  same inputs, same answer. There is nothing to log in to, nothing to query,
  and no per-viewer copy of anything.

  Background:
    Given config/tournament.md is published with the app
    And roster.md and results.md are published in the public roster repo

  Rule: The bracket is reconstructed, not stored

    @smoke @critical
    Scenario: A spectator opens the bracket
      When anyone opens the public bracket
      Then the page fetches the roster and the results at load time
      And rebuilds the bracket from the roster and the published seed
      And replays each confirmed result onto it
      And shows the current stage and the tree of four-character codes

    Scenario: There is no exported snapshot to go stale
      When a result is published to results.md
      Then the next visitor sees it
      And no separate file had to be regenerated for them to see it

    Scenario: The organizer's screen is the same reconstruction
      When the organizer opens their status view
      Then it shows what the public bracket shows
      # One algorithm, three consumers. A disagreement between the organizer's
      # screen and the public one is not possible.

  Rule: The public view carries codes and nothing else

    @privacy
    Scenario: Nobody is named
      Then every team appears as its four-character code
      And no name, handle, email or account appears anywhere on the page

    Scenario: Progress before the draw
      Given no draw has been run
      Then the page shows the phase roadmap and how the field is filling
      And it does not show an empty or invented bracket

    Scenario: The champion is shown when the tournament completes
      Given the final has been confirmed
      Then the champion's code is displayed
      And the bracket shows every confirmed result

  Rule: A captain sees their own position without extra access

    @captain
    Scenario: Finding yourself
      Given a captain knows their four-character code
      When they open the captain view
      Then they see their current status and their next match
      And the opponent's code, when the opponent is known

    @captain
    Scenario: Status reflects the record, not a stored per-captain file
      Then a captain is shown as scheduled, eliminated or champion
      And that status is derived from the same public results everyone reads

    @captain
    Scenario: Nothing extra is revealed to a captain
      Then a captain sees only what the public bracket already shows
      # Their view is a filter over public data, not a private channel.

  Rule: Failures are visible, not silent

    @resilience
    Scenario: The roster repo cannot be reached
      Given roster.md cannot be fetched
      Then the page still renders the tournament name and phase roadmap
      And it does not show a bracket built from nothing

    @resilience
    Scenario: A malformed or empty markdown file
      Given roster.md or results.md is empty or contains no usable rows
      Then it parses to an empty list
      And the page renders as though nothing has happened yet

    @resilience
    Scenario: A freshly published change reaches visitors on its own
      When a result is published
      Then visitors see it once the published-file caches expire
      And no visitor needs to do anything but reload
