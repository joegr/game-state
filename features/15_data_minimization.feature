@privacy @crypto @cross-cutting
Feature: Data minimization
  As a participant
  I want the platform to move the smallest possible amount of data between people
  So that taking part costs me nothing beyond the fact that I took part

  This feature is the contract the rest of the suite is measured against. It
  asserts what data exists, who can read it, and what crosses between people.
  Every other feature must be consistent with it.

  Rule: There is no account, no identifier and no contact detail anywhere

    @critical
    Scenario: What the platform knows about a participant
      When a captain has fully registered and played a match
      Then the platform holds a public key and a derived four-character code
      And it holds no name
      And it holds no email address or handle
      And it holds no password or account
      And it holds no IP address, device identifier or analytics record

    @critical
    Scenario: A team's identity is derived, never assigned
      Given a captain's keypair
      Then their team code is derived from a digest of their public key
      And no server or registry issues it
      And the same key always yields the same code

  Rule: Exactly four things ever pass between people

    @critical @handoff
    Scenario: The complete inventory of transferred data
      Then the only data moving between participants is
        | what                 | from      | to        | readable by      |
        | a sealed entry       | captain   | organizer | organizer only   |
        | a sealed score report| captain   | organizer | organizer only   |
        | a four-character code| anyone    | anyone     | everyone         |
        | the published JSON   | organizer | everyone   | see below        |
      And nothing else is transmitted by or through the platform

    @handoff
    Scenario: The platform itself transmits nothing
      When a captain produces a sealed entry or a score report
      Then the platform does not send it anywhere
      And the captain forwards it through a channel they already use
      And no third-party service is involved

    @handoff
    Scenario: The organizer sends nothing directly to any captain
      When the organizer publishes a new round
      Then captains read their own sealed view from the published files
      And the organizer contacts no captain individually
      And the organizer could not contact them if they wanted to

  Rule: Published files carry codes and ciphertext, never identity

    @critical
    Scenario Outline: What each published file discloses
      When anyone reads <file>
      Then it discloses <discloses>
      And it discloses no participant identity

      Examples:
        | file         | discloses                                         |
        | public.json  | the anonymized bracket, the seed and the progress  |
        | bracket.json | one opaque sealed view per team code               |
        | queue.json   | match statuses and reported scores by code         |

    @critical
    Scenario: A captain's fixture is sealed to that captain alone
      Given the published bracket carries a sealed view for every team
      When a captain opens the file
      Then they can decrypt exactly one view
      And every other view remains opaque to them
      And no captain can enumerate the field

  Rule: Each role sees the smallest slice that lets them act

    @minimal-disclosure
    Scenario Outline: The disclosure boundary per role
      Then <role> can see <visible>
      And cannot see <hidden>

      Examples:
        | role        | visible                                   | hidden                                |
        | a spectator | the anonymized bracket and its progress   | any sealed view or captain key        |
        | a captain   | their own code, stage and next opponent   | any other match or any other identity |
        | an organizer| every code, fixture and report            | any name, because none exists         |

    @minimal-disclosure
    Scenario: Even the organizer learns nothing personal
      Given the organizer has decrypted every entry and report
      Then they know a set of public keys, codes and scores
      And they cannot identify any captain from the platform's data alone
      # The organizer knows who they invited. The platform does not tell them.

  Rule: Data is destroyed when it stops being needed

    @retention
    Scenario: Completion purges per-captain data
      Given the tournament has completed
      When the completion purge runs
      Then collected entries and score reports are deleted
      And per-captain sealed views are cleared
      And only the champion's code and the final bracket survive

    @retention
    Scenario: A captain can erase themselves from their own device
      When a captain forgets their key on their device
      Then the key is gone and cannot be recovered
      And the platform retains nothing that could restore it

    @retention @operational
    Scenario: Working state is not published by accident
      Given the organizer runs the optional command-line engine
      Then the decrypted roster must not be committed to the published site
      And collected blobs must not be served from the published site
      # Sealed blobs are safe, but a public directory listing leaks the field
      # size and the team codes before the draw is announced.

  Rule: The threat model is stated, not implied

    @threat-model
    Scenario Outline: What each actor can and cannot do
      Then <actor> can <can>
      And cannot <cannot>

      Examples:
        | actor                    | can                                  | cannot                                |
        | a passive observer       | read the anonymized bracket          | learn who any team is                 |
        | a captain                | read their own fixture and report it | read or forge another captain's data  |
        | the organizer            | read every entry and report          | learn a participant's real identity   |
        | someone with the device  | read the organizer's working state   | open any sealed blob without the key  |
        | the hosting provider     | see that static files were requested | read anything sealed                  |
