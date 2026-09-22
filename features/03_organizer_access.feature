@organizer @auth @crypto
Feature: Organizer access
  As an organizer
  I want my private key to unlock the console on my own device and nowhere else
  So that there is no account, no token and no server that can be compromised

  There is no login service. "Being the organizer" means holding one private
  key. The console encrypts that key under a passphrase and keeps it in this
  browser only; the day-to-day "login" is the passphrase unlocking the vault.

  Background:
    Given a tournament configured with organizer public key "KEY_A"

  Rule: First use binds the key to one device under a passphrase

    @setup
    Scenario: Setting up the console on a new device
      Given the console has no stored vault
      When the organizer opens the console
      Then they are asked for the organizer private key and a passphrase
      When they supply the private half of "KEY_A" and passphrase "correct horse battery"
      Then the key is verified against the published public key
      And the key is encrypted under the passphrase using PBKDF2-SHA256 at 210000 iterations
      And the encrypted vault is stored only in this browser
      And the console unlocks

    @setup @validation
    Scenario Outline: Setup rejects weak or mismatched input
      When the organizer submits <input>
      Then setup is refused with "<message>"
      And no vault is stored

      Examples:
        | input                                | message                                      |
        | a passphrase of 5 characters         | Use a passphrase of at least 8 characters.   |
        | two passphrases that differ          | Passphrases do not match.                    |
        | the private half of a different key  | does not match this tournament               |
        | text that is not a key at all        | does not match this tournament               |

    @setup @convenience
    Scenario: The key can be supplied as a file or as raw text
      When the organizer uploads "organizer.keys.json"
      Then the "privateKey" field is extracted from it
      And setup proceeds identically to pasting the raw key string

  Rule: Returning is a single passphrase

    @unlock
    Scenario: Unlocking an existing vault
      Given a vault exists on this device
      When the organizer opens the console
      Then they are asked only for the passphrase
      When they enter the correct passphrase
      Then the vault decrypts and the console unlocks
      And the private key is held in memory only

    @unlock @guard
    Scenario: A wrong passphrase reveals nothing
      Given a vault exists on this device
      When the organizer enters the wrong passphrase
      Then the console refuses with "Wrong passphrase (or the key no longer matches this tournament)."
      And no detail distinguishes a bad passphrase from a bad key
      And the vault remains intact
      And nothing is sent off the device

    @unlock @critical
    Scenario: The unlocked key is re-verified against the live config
      Given a vault exists holding the private half of "KEY_A"
      And the tournament now publishes organizer public key "KEY_B"
      When the organizer unlocks with the correct passphrase
      Then the console still refuses to open
      # Prevents operating a console against a tournament it can no longer read.

  Rule: The device is the security boundary

    @routing
    Scenario: An organizer's own device routes them to the console
      Given a vault exists on this device
      When the visitor opens the landing page
      Then they are sent straight to the organizer console
      # Convenience only. The console is still gated by the passphrase, so this
      # routing leaks nothing an attacker could use.

    @routing
    Scenario: Every other device sees an ordinary visitor's site
      Given no vault exists on this device
      When the visitor opens the landing page
      Then they see the captain sign-up
      And no link to the console is presented

    @lock
    Scenario: Locking clears the key from memory
      Given the console is unlocked
      When the organizer chooses "Lock"
      Then the private key is dropped from memory
      And the passphrase screen is shown
      And the vault remains on the device

    @lock @privacy
    Scenario: Locking does not hide the working state
      Given the console is locked
      When someone with access to the device inspects browser storage
      Then they can read the roster, the reports and the bracket
      But they cannot read the organizer private key
      And they cannot decrypt any sealed blob
      # Stated plainly because the console's threat model is "my own device".
      # The vault protects the KEY; it does not protect the working data.

    @reset @destructive
    Scenario: Removing the key from a lost or shared device
      Given a vault exists on this device
      When the organizer chooses "Reset device" and confirms
      Then the vault is deleted from this browser
      And the console returns to first-time setup
      And the tournament itself is unaffected on other devices
