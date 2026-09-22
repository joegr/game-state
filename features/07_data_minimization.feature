@privacy @integrity @cross-cutting
Feature: Data minimization and what it actually guarantees
  As a participant
  I want to know exactly what data exists, who can read it, and what it proves
  So that taking part costs me nothing beyond the fact that I took part

  This feature is the contract the rest of the suite is measured against. It
  states what exists, and — just as importantly — it states the limits of what
  the integrity model proves. Every other feature must be consistent with it.

  Rule: What exists, in full

    @inventory
    Scenario: The complete list of data in the system
      Then the app repo holds config/tournament.md: name, format, phases,
        active phase and draw seed
      And the roster repo holds roster.md: one row per team — a four-character
        code, a hash of that team's token, and a registration timestamp
      And the roster repo holds results.md: one row per confirmed match —
        match id, winning code, score and a confirmation timestamp
      And a captain's own browser holds their token, until they discard it
      And the organizer's own machine may hold pending score reports, locally
      And that is everything
      # No names. No emails. No accounts. No analytics. No third-party service.
      # No server-side storage, because there is no server.

    @privacy
    Scenario: What a stranger can learn from the public repos
      Then they learn how many teams entered and when each registered
      And every code, and every result
      And nothing that identifies any human being

    @privacy
    Scenario: A captain's token never becomes public
      Then the raw token appears in no published file
      And only its hash is published
      And the four-character code is derived from the token but does not reveal it

    @privacy
    Scenario: Nothing is collected that is not needed to run a bracket
      Then no field exists for a team name, a player list or a contact address
      And the interface never asks for one

  Rule: What the integrity model proves — and what it does not

    These scenarios exist so nobody mistakes this system for something
    stronger than it is.

    @honest
    Scenario: A score report proves a captain sent it
      Given a report carries a token matching the hash in roster.md
      Then it proves the sender holds the token registered for that team
      And one captain cannot forge the other captain's report

    @honest @limitation
    Scenario: The organizer holds every secret they verify against
      Given the organizer receives tokens in order to check them
      Then the organizer could, in principle, produce a report for any team
      # This is a shared-secret scheme, not a signature scheme. It stops
      # captains forging each other. It does not stop the organizer, because
      # the organizer is trusted by construction: they already publish every
      # result and could simply publish a false one directly.

    @honest
    Scenario: What actually constrains the organizer is publicity
      Then every result they publish is a commit in a public repository
      And attributed to their account, with a timestamp, permanently
      And the draw they ran is reproducible by anyone from published inputs
      # The defence is not cryptography. It is that everything they do is in
      # the open and checkable after the fact.

    @honest @limitation
    Scenario: Anonymity is against strangers, not against the organizer
      Given captains send their entries to the organizer over some channel
      Then the organizer sees whatever that channel reveals about them
      And the published files reveal none of it
      # "Anonymous" here means the public record carries no identities.

  Rule: Durability is git, not a backup

    @durability
    Scenario: There is nothing to back up
      Then the record is the commit history of two public repositories
      And it survives any browser, device or organizer machine being lost

    @durability
    Scenario: What a lost device actually costs
      Given the organizer loses the machine they were working on
      Then every confirmed result and every registered team is still published
      And only score reports not yet confirmed are lost
      And those captains can simply send their reports again

  Rule: The end of a tournament keeps the result, not the participants

    @completion
    Scenario: Pending working state is cleared on completion
      Given the tournament has completed
      Then local pending score reports are deleted
      And the published record keeps the codes, the bracket and the champion
      # A finished tournament keeps what happened, not who was reachable while
      # it was happening.
