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
      Then the CLI prints exactly what will be published and a fingerprint of that plan
      And nothing is published unless the organizer types the fingerprint back
      When they do
      Then the CLI dispatches the stage workflow with that fingerprint

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

  Rule: gh push access is the credential; the bar is a view

    Scenario: The organizer bar
      Given the organizer has set a PIN on this device
      Then the bar appears on every page, stays unlocked across the tab, and opens from #organizer
      And it reads the private queue with the organizer's own read-only token
      And every action in it is a command to copy, never a write
      And the PIN protects nothing: it is a view toggle, and the interface says so

    Scenario: Controls the organizer has
      Then the organizer can admit, un-admit and reject registrations
      And accept, take back, decide, or clear the scores of any open match
      And unlock a team or issue it a new PIN
      And force a batch, inspect the inbox and the batch's rejections
      And close, reopen, draw, advance and reset, each confirmed by fingerprint

    Scenario: Losing the organizer's device loses nothing
      Then the record and the queue live in git
      And another device picks up exactly where this one left off
