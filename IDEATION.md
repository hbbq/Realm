# Realm Ideation Guidance

## Purpose

Realm is a persistent environment for autonomous AI agents.

Ideation for this repository should explore ways to make the world more coherent, useful, interesting, persistent, and capable of supporting increasingly autonomous agents.

Prefer ideas that strengthen the underlying environment and emergent agent behavior over isolated novelty features.

## Areas worth exploring

Look for opportunities around:

* Agent autonomy and meaningful decision-making.
* Persistent agents, identity, memory, and continuity over time.
* World state and persistent consequences of agent actions.
* Agent-to-agent interaction, communication, cooperation, and conflict.
* Goals, needs, motivations, curiosity, and other drivers of agent behavior.
* Emergent behavior created by simple underlying systems.
* Ways agents can discover and understand their environment rather than being given perfect knowledge.
* Resources, locations, objects, events, or other world mechanics that create meaningful choices.
* Time and changes that occur independently of individual agents.
* Agent perception and differences between objective world state and what an agent knows.
* Learning from previous actions and experiences.
* Mechanisms that make long-running agents more interesting without requiring constant human intervention.
* Observability and tools for understanding what agents are doing and why.
* Interfaces that let humans inspect or occasionally interact with the world without becoming its primary driver.
* Efficient use of models, context, memory, and tools.
* Connections to physical or external systems when they meaningfully extend the concept of the Realm.

## Prefer

Prefer ideas that:

* Produce interesting behavior through reusable systems rather than scripted scenarios.
* Give agents meaningful choices or information to reason about.
* Allow actions to have persistent consequences.
* Strengthen continuity between agent runs.
* Let complexity emerge from relatively simple mechanics.
* Improve the distinction between what exists in the world and what individual agents know about it.
* Work naturally with autonomous agents rather than requiring constant orchestration.
* Can be introduced incrementally and observed experimentally.
* Help us learn something about persistent autonomous agents.

## Avoid

Avoid ideas that:

* Add content without adding meaningful interaction or consequences.
* Turn Realm primarily into a conventional game with scripted quests and predetermined solutions.
* Require complex simulation solely for realism.
* Give agents perfect knowledge when discovery or uncertainty would be more interesting.
* Add large systems before there is a concrete reason for them.
* Introduce abstractions for hypothetical future requirements.
* Depend on constant human input to keep the world functioning.
* Optimize for visual presentation at the expense of the underlying agent/world model.

## Sources of ideas

When ideating, inspect:

* Current repository documentation and architecture.
* Existing world and agent mechanics.
* Open issues and planned work.
* Observed behavior from actual Realm runs where available.
* Limitations, unexpected behavior, and interesting emergent behavior.
* Capabilities newly available through AgentController, models, tools, or connected systems.

Existing issues should be considered so that new ideas do not duplicate work already planned.

## Experimental mindset

Realm is also an experiment in persistent autonomous agents.

Ideas do not always need to make the system immediately more useful. An idea can be valuable because it lets us investigate a question about autonomy, memory, perception, cooperation, emergent behavior, or persistent AI environments.

When appropriate, prefer a small experiment that can answer such a question before proposing a large implementation.

Unexpected agent behavior can itself be a useful source of ideas.

## Scope

Realm should evolve from what is learned by running it.

Do not assume that every potentially interesting feature belongs in the system. Prefer additions that deepen existing mechanics or enable new emergent behavior.

It is valid to produce no idea when there is no sufficiently useful or interesting new proposal.
