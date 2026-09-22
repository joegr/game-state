@privacy @integrity @cross-cutting
Feature: Data minimization and what the system actually guarantees
  As a participant
  I want to know exactly what data exists, who can read it, and what it proves
  So that taking part costs me nothing beyond the fact that I took part

  Rule: What exists, in full

    @inventory
    Scenario: The complete list
      Then the public app repo holds tournament.md
      And the public roster repo holds roster.md (code, token hash, registration time) and results.md
      And the private tentative repo holds the queue: registrations with PIN hashes, submitted scores,
        wrong-PIN attempts, the batch's rejections, and the organizer's admitted and accepted lists
      And a captain's device holds their code and PIN
      And that is everything
      # No names, emails, accounts, analytics, third-party services or servers.

    Scenario: What stays private
      Then no PIN, PIN hash, submitted score or registration is public
      And submissions travel in the workflow dispatch and are read from the event file, never logged

  Rule: What the integrity model proves, and what it does not

    @honest
    Scenario: A score is one captain's word, checked
      Then a submission counts only with the PIN of the team it claims
      And a result needs both captains' submissions to agree, or the organizer to decide it openly

    @honest @limitation
    Scenario: The PIN is short
      Given a PIN has 10,000 possible values
      Then its hash is kept only in the private repo
      And a team locks after 5 wrong PINs
      But several guesses at the same instant can exceed the lockout by a guess or two

    @honest @limitation
    Scenario: The submit token is public
      Given the token that lets browsers start the intake workflow is in the published site
      Then anyone can use it to start intake runs, cancel runs or disable the workflow,
        and spend the private repo's Actions minutes
      But it cannot read or write any file or publish anything

    @honest
    Scenario: What constrains the organizer
      Then every public change is a commit, attributed and permanent, from a plan the organizer confirmed
      And the draw is reproducible by anyone from the published roster and seed
      # The organizer is trusted by construction. The defence is that everything they
      # publish is in the open and checkable.

  Rule: Durability is git

    Scenario: Nothing to back up
      Then the record and the queue are commit histories on GitHub
      And losing any device, including the organizer's, loses nothing
