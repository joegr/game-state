@organizer @setup @config
Feature: Tournament setup
  As an organizer
  I want to stand up a tournament from static configuration and a single keypair
  So that a whole tournament runs with no server, no database and no accounts

  The organizer private key is the ONLY privileged credential in the system.
  Everything else — the schedule, the field size, the format — is static JSON
  that every visitor reads identically. "Deploying" is committing files.

  Background:
    Given a fresh deployment of the platform
    And the tournament config at "config/tournament.json"

  Rule: A tournament cannot accept entries before it has an organizer key

    @guard @critical
    Scenario: Every entry point fails safe when no key is configured
      Given "organizerPublicKey" is ""
      When a visitor opens <page>
      Then they see "<message>"
      And no control that would produce a sealed entry is offered

      Examples:
        | page                  | message                          |
        | the landing page      | Registration is not open yet.    |
        | the captain sign-up   | Registration not open yet        |
        | the organizer console | Organizer key not configured     |

    @guard @critical
    Scenario: A misconfigured key never silently swallows entries
      Given "organizerPublicKey" is ""
      When 20 visitors arrive during what should be registration
      Then zero sealed entries are produced
      And no captain is told they are registered
      # The failure mode being prevented: captains sealing entries to a key
      # whose private half nobody holds, discovering it only weeks later.

  Rule: The organizer keypair is generated off-platform and split by trust

    @crypto
    Scenario: Generating the organizer keypair
      When the organizer runs "node tools/keygen.mjs --json"
      Then a P-256 ECDH keypair is produced
      And the output contains exactly a "publicKey" and a "privateKey"
      And neither key is transmitted anywhere

    @crypto
    Scenario: The public half is published, the private half never is
      Given the organizer has generated a keypair
      When they paste the public key into "config/tournament.json"
      And they commit the repository
      Then the public key is served to every visitor
      And the private key appears in no committed file
      And "organizer.keys.json" is ignored by version control

    @crypto @critical
    Scenario: A private key that does not match the published public key is rejected
      Given the tournament publishes organizer public key "KEY_A"
      When the organizer tries to unlock the console with the private half of "KEY_B"
      Then the console refuses with "That private key does not match this tournament's organizer public key."
      And nothing is stored on the device

  Rule: The schedule is declared once, in UTC, as the tournament's spine

    @schedule
    Scenario: A complete phase schedule
      Given the config declares the phases
        | id            | kind     | label            |
        | signup        | signup   | Registration     |
        | r16           | knockout | Round of 16      |
        | quarterfinals | knockout | Quarter-finals   |
        | semifinals    | knockout | Semi-finals      |
        | final         | knockout | The Final        |
        | complete      | complete | Champion Crowned |
      And every phase carries an ISO-8601 UTC "start"
      Then the schedule is valid
      And every visitor derives the same stage from it

    @schedule @guard
    Scenario: Placeholder dates must be replaced before launch
      Given the shipped config carries placeholder phase dates
      When the organizer deploys without changing them
      Then the public bracket may show a stage that does not match reality
      # Guard rail: setup instructions state the dates are placeholders.
      # The clock is the source of truth, so a stale schedule is a live bug.

    @schedule @pending
    Scenario: The config declares no phase the engine cannot run
      Given the engine implements "single-elimination"
      When the config declares a phase of kind "group"
      Then setup validation fails with "no engine implements phase kind: group"
      # NOT YET IMPLEMENTED — today a group phase is silently absorbed as a
      # knockout round and inherits that round's start date.

  @smoke
  Scenario: A minimal tournament is ready to open
    Given the organizer has set "organizerPublicKey" to a real public key
    And has set "name", "teamCount" and "format"
    And has set future UTC starts on every phase
    And has enabled static hosting from the default branch
    When the clock passes the "signup" phase start
    Then registration opens with no further action from anyone
