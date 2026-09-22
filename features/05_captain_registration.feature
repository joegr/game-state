@captain @registration @privacy
Feature: Captain registration
  As a captain
  I want to enter a tournament without handing over a name, an email or an account
  So that the only thing I reveal is that some anonymous team exists

  Registration is one button. The browser mints a keypair, derives a four-character
  team code from it, and seals an entry to the organizer. The captain's identity
  IS the key; there is nothing else to leak.

  Background:
    Given a tournament with a configured organizer public key
    And registration is open

  Rule: One button produces an identity, a code and a sealed entry

    @smoke @critical
    Scenario: Registering a team
      When the captain chooses "Create my anonymous team"
      Then a P-256 keypair is generated in their browser
      And a four-character team code is derived from the public key
      And the code uses only the alphabet "A-Z0-9"
      And an entry is sealed to the organizer's public key
      And the captain is shown their code and their sealed entry

    @crypto
    Scenario: The sealed entry carries the minimum possible payload
      When a captain registers
      Then the sealed entry decrypts to exactly
        | field             | meaning                        |
        | v                 | payload version                |
        | captainPublicKey  | the captain's public key       |
        | ts                | when the entry was created     |
      And it carries no name, no email, no handle and no device identifier

    @crypto @critical
    Scenario: The entry is readable only by the organizer
      Given a captain has produced a sealed entry
      When anyone other than the organizer attempts to open it
      Then decryption fails
      And nothing about the captain is revealed
      And the sender is anonymous even to the organizer until it is opened

    @identity
    Scenario: The team code is stable and derived, not assigned
      Given a captain holds a keypair
      When the team code is derived from the public key
      Then the same key always yields the same code
      And the code is derived from a SHA-256 digest of the public key
      And no registry or server assigns it

  Rule: The captain key is the only way back in

    @critical @ux
    Scenario: The captain is pushed hard to save their key
      When a captain completes registration
      Then they are warned the key is the ONLY way to view their progress
      And they are warned it cannot be recovered
      And they can download the key as a JSON file
      And they can copy the key to the clipboard

    @recovery
    Scenario: A lost captain key cannot be recovered by anyone
      Given a captain has lost their key
      When they ask the organizer for help
      Then the organizer cannot regenerate or reset it
      And the organizer can only see that the team code still exists
      # There is no reset flow by construction. The honest remedy is a walkover
      # or a fresh registration while the field is still open.

    @device
    Scenario: The key is remembered on the device that created it
      Given a captain registered on this device
      When they return to the site
      Then they are greeted with their team code
      And they can open the captain dashboard without re-loading their key

    @device
    Scenario: Moving to another device requires the saved key
      Given a captain registered on device A
      When they open the site on device B
      Then they are offered the sign-up flow, not their team
      And loading their saved key file restores their team on device B

    @device @destructive
    Scenario: Forgetting a key on a device is deliberate and confirmed
      Given a captain key is stored on this device
      When the captain chooses to forget it
      Then they must confirm they cannot recover it
      And only then is it removed from this device

  Rule: Delivery of the entry is out of band and human

    @handoff
    Scenario: The captain sends the sealed entry through their own channel
      When a captain has a sealed entry
      Then they are told to send it to the organizer through the tournament channel
      And no third-party service is involved
      And nothing is posted publicly
      # The platform never transmits anything. A blob moves between two humans
      # over whatever channel they already use.

  Rule: Collisions are detected rather than assumed away

    @edge
    Scenario: Two keys deriving the same team code
      Given the code space is 36^4 combinations
      And a collision across a 32-team field is roughly 0.03 percent likely
      When two distinct keys derive the same code
      Then the organizer is warned about the collision
      And one captain is asked to re-register for a fresh code

  @gating
  Scenario: Registration is an organizer decision, not a phase gate
    Given "activePhase" has moved past "signup"
    When a visitor opens the landing page
    Then a registration control is still offered, because it is keyed only on
      "organizerPublicKey" being set
    # By design — see 04_deploy_driven_phases.feature. The organizer decides
    # which entries actually count when reviewing the Inbox; a late sealed
    # entry is harmless because nothing accepts it into the bracket
    # automatically.
