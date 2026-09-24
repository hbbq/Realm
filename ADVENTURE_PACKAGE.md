# Adventure Package Vision

This document describes the direction for a portable Realm adventure package.
It is a **vision**, not the current package schema and not a commitment that
every construct in the example will be implemented.

The companion example is [`examples/greyfen.yaml`](examples/greyfen.yaml).

## Purpose

An adventure package should be able to describe enough starting material and
creative guidance to create a new playable game, while allowing the actual
world and story to emerge during play.

The format should support a spectrum from a loose AI-driven sandbox to a more
tightly prepared traditional adventure. Realm must not depend on D&D or any
other external ruleset. A future AI Adventure Adapter should instead be able to
translate source material into the closest useful representation supported by
Realm and Keeper.

A package is therefore not a save game and not a screenplay. Multiple games
may start from the same package and diverge permanently.

## Core model

The design intentionally separates three kinds of material:

1. **Established state** is true when the game starts. It is materialized into
   Realm and becomes authoritative world state.
2. **Prepared material** is available to Keeper but is not necessarily true or
   materialized yet. It may contain people, places, objects, facts, situations,
   or story seeds that Keeper can introduce when appropriate.
3. **Creative space** is everything Keeper is allowed to invent during play,
   constrained by the setting, package guidance, and existing Realm state.

This distinction enables lazy world growth. Mentioning a person in narration
does not require immediately creating that person and their surroundings in
Realm. When the person becomes relevant, Keeper can materialize the necessary
state. A more tightly prepared adventure can provide much more prepared
material without requiring all of it to exist in Realm from the beginning.

## Entity presentation and appearance

Prepared and established entities may provide an optional `appearance`.
This describes observable visual characteristics of the entity and is distinct
from both its canonical `description` and any player-projection description.

For authored/prepared entities, `appearance` is recommended whenever the
source material gives meaningful visual information. It should capture useful
visual identity rather than invent filler merely to populate the field.

Realm may use `appearance` as safe visual context for presentation features
such as entity illustrations. A canonical `description` may contain GM-only
facts or other non-visual information and should not be treated as a substitute
for `appearance`.

An entity may still be valid without an `appearance`. Emergent entities can
gain one later if their visual identity becomes established during play.

## Responsibilities

**Keeper** owns semantic interpretation, improvisation, adjudication, and
narration. It may decide that a nap took 30 minutes, that throwing Mara into a
cellar succeeds, or that an unprepared person or place is needed. Material
consequences must be persisted before Keeper treats them as established.

**Realm** owns authoritative state, persistence, deterministic invariants, and
mechanical world evolution that we explicitly choose to model. Realm records
the 30-minute advance, Mara's resulting location, observations, facts, and
other durable consequences. Realm should model invariants and consequences,
not enumerate every story action Keeper is allowed to imagine.

**Adventure/package guidance** constrains and supplies Keeper without becoming
authoritative state merely by existing in the file. It can describe tone,
world constraints, prepared elements, objectives, and how freely Keeper should
expand the world.

## Future world evolution

The package should eventually be able to express structured triggers,
conditions, schedules, and effects. Deterministic conditions should be
machine-evaluable, for example an entity entering a place or world time
reaching a threshold.

Effects may be hard Realm consequences or soft narrative situations. A soft
trigger can tell Keeper that a meaningful complication should occur without
pre-writing what that complication must be. Keeper resolves the semantics and
persists whatever becomes established.

Time follows the same boundary: Keeper may estimate unmodelled durations, while
Realm owns the resulting authoritative clock. Richer clock/day-cycle and
schedule semantics are future work.

## Completion and chapters

Finite adventures should be able to define completion. Some completion
conditions can be structured and deterministic; others are inherently
semantic and can be evaluated by Keeper. Completion may be public or hidden.

Completion should not necessarily freeze the game. It can mark a chapter or
adventure as complete while allowing an epilogue or continuation.

Campaigns may contain prepared chapters, AI-generated chapters, or both. A
future Story Architect can inspect the world produced by a completed chapter
and prepare the next situation, completion condition, and optional material.
It must build on the world that actually resulted from play rather than reset
it toward a planned plot.

## Traditional adventure adaptation

A future Adventure Adapter should be able to read traditional adventure
material and produce this same package representation. The goal is semantic
adaptation, not ruleset emulation.

For example, a source rule such as a particular skill-check difficulty might
be adapted into a hidden fact plus Keeper guidance about when discovery is
reasonable. Important locations, NPCs, and story beats may become prepared
material or chapter guidance. Unsupported mechanics should not cause Realm to
grow a copy of the source game's rules engine.

This is why prepared and emergent content must both be first-class concepts.

## Development approach

The vision example is deliberately ahead of the implementation. Development
should make useful subsets executable rather than implementing the entire file
at once.

A natural first vertical slice is:

`package metadata + Keeper guidance + initial state -> create a new playable game`

Later slices can add prepared material, completion, richer time, triggers,
schedules, chapters, Story Architect integration, and Adventure Adapter
integration as real gameplay demonstrates the need.

The design question for each slice is not "does Realm implement the whole
format?" but **"how much more of the same Greyfen package can the system now
meaningfully execute?"**
