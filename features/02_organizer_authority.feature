@organizer @auth @critical
Feature: Organizer authority
  As a captain or spectator
  I want every change to the tournament to be the organizer's confirmed decision
  So that nothing moves on its own, and nothing moves that the organizer didn't see

  Automation only moves raw submissions into a private queue. Accepting is
  the organizer's private, reversible decision. Every public change, whether
  roster, results or stage, is a stage change the organizer confirms by
  fingerprint, executed by the stage workflow, which only people with write
  access can start.

  Rule: Nothing automatic touches config, the stage, acceptance, or the public record

    Scenario: What the automation may do
      Then intake may only create new files in the private inbox
      And batch may only rewrite the private queue files
      And neither may write tournament.md, roster.md, results.md, admitted.md or accepted.md

  Rule: A stage change publishes only the exact plan the organizer confirmed

    @critical
    Scenario: Confirming a stage change
      When the organizer runs a stage change (close, reopen, draw, advance, reset)
      Then the bar or CLI shows exactly what will be published and a fingerprint of that plan
      And nothing is published unless the organizer confirms the fingerprint
      When they do
      Then it dispatches the stage workflow with that fingerprint

    @critical
    Scenario: The plan changed after confirmation
      Given the organizer confirmed plan "X"
      And an acceptance lands before the stage workflow runs
      Then the workflow re-plans, gets a different fingerprint, and refuses
      And writes nothing

    Scenario: No fingerprint, no change
      When the stage workflow is dispatched without a fingerprint
      Then it refuses and writes nothing

    Scenario: A second confirmation inside GitHub
      Given the organizer added themselves as a required reviewer on the "publish" environment
      Then every stage change also waits for their Approve click in GitHub

    Scenario: Consistent at every instant
      When a stage change runs
      Then it writes results.md, then roster.md, then tournament.md last
      And a reader never sees a stage that the published files don't support yet

  Rule: The organizer's GitHub token is the credential; the bar acts with it

    Scenario: The organizer bar
      Given the organizer has set a PIN on this device and connected a fine-grained GitHub token
      Then the bar is available on every page, stays unlocked across the tab, and opens from #organizer
      And it reads and writes the private queue with the organizer's own token, compare-and-swap
      And private actions (admit, accept, reject, unlock) write directly to the tentative repo
      And stage changes (close, draw, advance, reset) dispatch the stage workflow after fingerprint confirmation
      And the PIN protects nothing: it is a view toggle, and the interface says so

    Scenario: Only the organizer's device shows the bar
      Given a device where no organizer PIN has been set
      Then no organizer button appears on any page
      And the bar can only be reached by opening #organizer

    @critical
    Scenario: One device at a time
      Given the bar is open on one device
      When it is opened on another device
      Then the second device is told the bar is in use, on what device and since when
      And it reads nothing from the private queue and can take no action
      And a device that lost the bar to another is refused before its next action writes anything

    Scenario: Releasing the bar
      When the organizer presses Close
      Then the bar is released and another device may open it
      Given a device holds the bar but has been idle for 15 minutes
      Then its hold lapses, so a lost or crashed device never locks the organizer out

    Scenario: Confirmations work in every browser
      Given a browser that suppresses confirmation dialogs
      Then every action that asks for confirmation still works, by asking for a second tap

    Scenario: Controls the organizer has
      Then the organizer can admit, un-admit and reject registrations
      And accept, take back, decide, or clear the scores of any open match
      And unlock a team or issue it a new PIN
      And force a batch, inspect the inbox and the batch's rejections
      And close, reopen, draw, advance and reset, each confirmed by fingerprint

    Scenario: Losing the organizer's device loses nothing
      Then the record and the queue live in git
      And another device picks up exactly where this one left off
