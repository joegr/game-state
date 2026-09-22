@public @captain @dashboard
Feature: Public and captain views
  As a spectator or a captain
  I want the tournament rendered from the same public files everyone else reads
  So that there is no privileged version of the truth

  Every page rebuilds the tournament from tournament.md, roster.md and
  results.md with reconstruct(), the same function the workflows gate on. The
  public sees only what the organizer has published at a stage change.

  Rule: The public bracket follows the derived stage

    Scenario Outline: What the bracket page says
      Given the stage is "<stage>"
      Then the headline is "<headline>"

      Examples:
        | stage        | headline                                  |
        | registration | the registration phase, with a register button |
        | closed       | Registration closed — the draw is next    |
        | round        | Round k · <round label>                   |
        | complete     | Champion crowned, with the champion's code |
        | invalid      | Being corrected — everything is paused    |

    Scenario: Before the roster is published
      Given registration is open and no roster has been published
      Then the page shows the capacity, not a live count
      # Registrations are private until the organizer closes registration.

    Scenario: Nobody is named
      Then every team appears only as its four-character code

  Rule: The captain view offers exactly what the captain may do now

    Scenario: Signing in
      Given a device with no team
      Then the captain view asks for the team code and PIN, and nothing else
      And the PIN is proven by the first submission, not by the sign-in

    Scenario Outline: What the captain sees
      Given the stage is "<stage>" and the captain's team is <situation>
      Then they see <view>

      Examples:
        | stage        | situation                     | view                                     |
        | registration | registered                    | that the roster is published at close    |
        | round        | in an open match this round   | that match, with a score form            |
        | round        | through, waiting on the round | that their next match opens at the advance |
        | round        | eliminated                    | that their run is over                   |
        | complete     | the champion                  | that they won                            |
        | invalid      | anything                      | that scores are paused                   |

  Rule: Pages can lag; the gates cannot

    Scenario: Cached files
      Given GitHub caches the public files for a few minutes
      Then a page may briefly show an older stage
      But anything it offers is re-checked by intake and the batch against the live files
