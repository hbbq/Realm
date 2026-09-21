# Realm — Vision

## Purpose

Realm is a standalone game-world system intended to be used by an AI game master, initially a Resident instance.

Realm owns the authoritative, persistent state of a role-playing game. The AI game master owns narration, improvisation, interpretation, pacing, and rulings where the rules do not already define an exact answer.

The central principle is:

> The game master may invent new canon, but once something becomes established, Realm owns it exactly.

Realm is not part of Resident. It is its own system with its own database, API, rules/domain layer, and companion web application. Resident is one client of Realm.

The first campaign may well be *Quest for the Holy IR Beacon*.

## System boundary

The intended high-level architecture is:

```text
                    +------------------+
                    |      Realm       |
                    |                  |
                    |  API / Rules     |
                    |       |          |
                    |    Database      |
                    +--------+---------+
                             |
                            API
                    +--------+---------+
                    |                  |
              Companion Web      Resident
                                   |
                              DM instance
```

All clients use the Realm API. The companion web application does not bypass the API to read or mutate the database directly.

Resident should integrate with Realm through capabilities backed by the Realm API. RPG-specific domain logic should remain in Realm rather than becoming part of Resident.

## Responsibilities

### Realm

Realm is authoritative for things that must remain exact and deterministic, including:

- games and campaigns
- player characters
- NPCs and other entities
- stats, HP, conditions, death and healing
- inventory and equipment
- item definitions and mechanical effects
- dice and deterministic resolution rules
- established world state
- persistent facts and secrets
- event/history data used to reconstruct what happened

Realm validates mutations and enforces invariants. An AI game master should not manipulate Realm's database directly.

### AI game master

The AI game master is responsible for:

- narration
- role-playing NPCs
- improvising locations, people, objects and events
- deciding how unspecified actions should be resolved
- selecting difficulty and consequences
- pacing and story structure
- interpreting adventure material
- maintaining the feel and tone of the game

The game master does not need a complete predefined ruleset for everything a player might attempt.

For an improvised action, the game master should decide the rule, difficulty and consequences before the random result is known. Realm then performs or records the mechanical resolution.

For example, if a player wants to cut a chandelier rope so it falls onto an enemy, the game master might establish a Dexterity check against difficulty 15, with 2d6 damage and a prone condition on success. Realm resolves the check and applies the established consequences.

This separation lets the AI improvise freely without making exact game state dependent on model memory.

## Established canon

Anything not yet established may be invented by the game master.

Once an invented fact has mechanical or continuity significance, it can become persistent Realm state.

For example, the game master may invent a magical bow during play. Once established, Realm stores its identity and exact effects. Later turns retrieve that definition rather than relying on the model to remember approximately what the bow did.

The same principle applies to world facts. If a door has been established as locked, an NPC has died, or an NPC is currently in a particular location, those facts should survive model context changes.

Realm should support both player-visible facts and DM-only facts/secrets. A secret established by the game master must remain consistent without becoming visible to the player.

This allows mysteries and foreshadowing to depend on facts that were decided before their reveal rather than being retroactively invented.

## Minimal rules core

Realm is deliberately not intended to begin as a large fixed RPG rules engine.

The initial rules should cover only the mechanics that benefit from exact, deterministic handling. A possible minimal core includes:

- a small set of character stats
- HP and maximum HP
- damage, healing and death
- defense
- checks and difficulty values
- dice/random resolution
- combat turns and basic attacks
- items, equipment and item effects
- entities/NPCs
- conditions

A simple initial resolution model could be based on:

```text
d20 + stat + modifier >= difficulty
```

Exact details are implementation decisions rather than commitments of this vision.

Mechanics such as encumbrance, hunger, sleep, ammunition tracking, crafting, detailed economies, exact movement distances, skill trees and spell-slot systems should not be added merely because traditional RPG systems contain them. They can be introduced later if a game actually needs them.

## Games and campaigns

Realm should support multiple games in its data model from the beginning.

A Resident DM instance may initially be bound to exactly one game through configuration, for example:

```yaml
gamestate:
  game_id: quest-for-the-holy-ir-beacon
```

Dynamic game selection and participation in multiple games are not required initially.

A game/campaign is separate from the identity of the DM Resident. Starting a new game must not require resetting or recreating the Resident.

Conceptually:

```text
DM Resident
 +-- persistent DM/player preferences
 +-- Game A
 |    +-- character
 |    +-- world
 |    +-- campaign state
 |    +-- campaign-specific memory
 +-- Game B
      +-- character
      +-- world
      +-- campaign state
      +-- campaign-specific memory
```

Campaign state must not accidentally leak between games.

## Campaign initialization

Starting a game should have an explicit initialization phase rather than immediately entering the normal game loop.

Initialization may establish:

- player character and initial stats
- starting equipment
- genre/theme
- approximate intended length
- tone
- balance between exploration, combat, social play, puzzles and narrative
- sandbox versus directed-story preference
- danger/lethality expectations
- a short premise or story seed
- optional adventure/source material

The player should be able to describe a character naturally. The game master can translate that description into the mechanical representation, which becomes authoritative once accepted.

Campaign length may range from a short one-shot to a multi-session adventure or an open-ended campaign. The intended length should influence pacing rather than impose a hard turn count.

### Adventure material

A campaign may optionally be initialized from external material.

Material may serve different roles, such as:

- **Premise** — an initial setup from which the game master invents freely.
- **Inspiration** — material whose ideas may be reused or adapted.
- **Adventure** — established scenario material whose facts, secrets and structure should be respected where applicable.

Imported adventure material may contain information that only the game master is allowed to know.

Initialization may produce a small internal campaign bible containing the premise, tone, important places and characters, established secrets, and possible story beats. It is guidance and established background, not necessarily a fixed script.

## In-character, out-of-character and control

Interaction should distinguish between three conceptual kinds of input.

**In-character (IC)** interaction represents speech and actions inside the game world.

**Out-of-character (OOC)** interaction lets the player ask the game master about rules, inventory, current HP, previous events, or other game information without the question itself becoming a world event.

**Control** operations manage the campaign itself, such as creating, loading, pausing or ending games.

Natural language should be sufficient for normal play. Explicit commands or an OOC marker may later be useful for ambiguity, but the game should not require command-driven interaction.

## Companion web application

Realm should expose a companion web application backed by the same Realm API used by other clients.

The web application provides direct access to exact state that does not require an AI conversation, initially including things such as:

- character sheet and stats
- HP and conditions
- inventory and equipment
- campaign information
- a human-readable journal

The companion web application is intended to eventually become the primary player interface, combining conversation with the game master and direct access to exact game state. The player should be able to remain in one interface while talking to the DM, inspecting the character, inventory and journal, and responding to future interactive game requests.

During initial development, DM conversation may use Resident's existing Telegram transport through a dedicated bot. This provides a working player-to-DM channel without making messaging a prerequisite for Realm itself. The companion web application can initially focus on state and game management, then later take over the conversation experience.

Telegram and other messaging transports belong to Resident rather than Realm. Realm should not need Telegram-specific knowledge.

The journal is a human-readable representation derived from authoritative state/events. It is not itself the source of truth.

### Visual game material

The companion web application may later act as a visual window into the game world as well as a state and conversation interface.

A DM Resident may be able to generate visual representations of established characters, locations, items or scenes. Realm can associate those assets with the relevant game and domain entities so the companion UI can present them during play and reuse established representations later.

Generated images are representations of canonical state, not authoritative state by themselves. Important facts shown or implied by an image should still be represented explicitly in Realm when they matter to mechanics or continuity.

Visual generation, asset management and presentation are future features rather than requirements for the initial version.

## Resident integration

A Resident instance acting as DM consumes Realm through capabilities.

The exact capability surface should be discovered during implementation, but conceptually it may include operations such as:

```text
get_character
get_inventory
get_entity
get_world_state
roll
check
apply_damage
heal
give_item
create_item
set_condition
set_fact
start_combat
end_turn
```

Capabilities should expose validated domain operations rather than arbitrary database access.

Realm is also intended to act as a real consumer that drives a more general Resident feature: support for capabilities provided by external applications. Resident should not gain Realm-specific RPG logic merely to support this project.

## Future possibilities

The architecture should avoid unnecessarily preventing these features, but they are not initial requirements:

- player-triggered dice rolls in the companion UI
- a DM requesting a roll and waiting for the result as a later event
- multiple human players
- multiple Resident participants in one game
- selected NPCs represented by their own Resident instances
- NPC-specific private knowledge and memory
- AI-generated portraits, locations, items, scene images and other visual game material
- persistent per-game assets associated with Realm entities
- DM conversation integrated directly into the companion web application
- dynamically selecting games rather than configuring one GameId
- additional or campaign-specific rule modules

A future player-roll flow could look like:

```text
DM -> request roll -> Companion UI -> player rolls -> Realm records result
   -> result event -> DM continues
```

The initial implementation may simply let Realm perform all random resolution.

## Initial scope

The first useful version of Realm should stay small:

1. persistent multi-game data model
2. thin deterministic rules/domain layer
3. API as the only supported application boundary
4. enough GameState operations for one Resident DM to run a simple game
5. one configured GameId per DM Resident
6. simple companion web UI for inspecting exact state

The goal is not to reproduce D&D or another large RPG system.

The goal is to provide a small authoritative world beneath an AI game master: enough structure that important facts and mechanics remain real and consistent, while leaving the AI free to improvise everything that does not need to be exact.
