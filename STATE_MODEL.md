# Realm State Model

> **Status:** Design draft. This document captures the current model and design hypotheses. It is intentionally not a database schema or stable API specification.

## Purpose

Realm stores the minimum authoritative structure required for a persistent, causal game world. The game master supplies interpretation, improvisation, narrative detail, and rulings; Realm owns state that must remain exact and consistent.

Not everything described by the game master needs to become structured state. Anything whose future behaviour depends on exact continuity should be represented by Realm.

The world may be incomplete without being inconsistent. Details can remain unresolved until they matter. Once a detail is established or becomes causally relevant, it can be materialized into authoritative canon.

## 1. State, operations, and events

Realm distinguishes three related concepts:

- **State** describes what is true now.
- **Operations** request authoritative changes to the world.
- **Events** record what actually happened as a result.

For example:

```text
operation: damage(elin, 7, piercing)

state:
  elin.health.current = 2

event:
  CreatureDamaged
    target: elin
    amount: 7
    damage_type: piercing
    resulting_hp: 2
```

Operations are not intended to model every verb available to the player. The game master interprets free-form actions and translates their consequences into a small set of Realm operations.

Structured mechanical state should be changed through validated domain operations rather than arbitrary writes. Free descriptive properties may be less constrained.

## 2. Entity model

The initial model should use a small number of broad entity kinds rather than a deep hierarchy.

Candidate fundamental kinds are:

- **Place** — somewhere entities can be located, including regions, settlements, buildings, rooms, wilderness areas, and similar spaces.
- **Creature** — player characters, NPCs, monsters, animals, and other actors.
- **Item** — persistent objects that can be located, owned, transferred, or used.
- **Faction** — persistent groups with identity, relationships, goals, or influence.
- **Situation** — an active world circumstance that may develop over time.

All entities should have a stable identity and may have a name, description, free-form properties, and structured components.

### Components rather than excessive specialization

Mechanical behaviour should preferably be expressed through composable components rather than a large class hierarchy.

For example, a door could be an entity with:

```yaml
components:
  portal:
    connects:
      - castle_hall
      - western_tower
  openable:
    open: false
  lockable:
    locked: true
    key: silver_key
```

An item may gain a weapon component:

```yaml
components:
  weapon:
    damage: 1d8
    damage_type: slashing
```

A building can remain a Place rather than requiring a separate fundamental type. A weapon can remain an Item. Species, appearance, profession, history, and similar descriptive details need not become structured mechanics unless the rules require them.

**Principle:** the AI may invent meaning; Realm must understand anything that must be enforced deterministically.

The exact set of required properties and components remains to be worked out per entity kind.

## 3. Current state and canon

Realm distinguishes mechanical/current state from semantic world truth.

Examples of current state:

```text
Elin.location = greenford_inn
Elin.hp = 7
crypt_door.locked = true
silver_key.owner = player
world.time = day 4 13:20
```

Examples of canon:

```text
Varek murdered the merchant.
The crypt was constructed before the castle.
Elin distrusts the mayor.
Something beneath Blackmere fears sunlight.
```

Canon should not be forced into numerical or highly structured properties merely because it could be. Semantic facts may remain relatively free-form while still becoming authoritative once established.

## 4. Hidden canon and knowledge

Objective world truth and actor knowledge are different things.

A fact may be true without being known by the player:

```text
WORLD TRUTH
  Varek leads the cult.
  Elin saw Varek near the mill.

PLAYER KNOWLEDGE
  Varek appears to be a local noble.
  Elin becomes nervous when the mill is mentioned.
```

Realm should eventually be able to answer both:

- What is true?
- What does this actor know?

The game master is a trusted DM and may receive hidden canon. Future NPC agents should receive only knowledge appropriate to that actor.

Knowledge is therefore not merely a presentation concern; it may become part of authoritative world state.

## 5. Lazy materialization

Realm does not require the entire world to be defined before play.

A remote castle might initially consist only of facts such as:

```text
Blackmere is an abandoned castle in the northern forest.
A small cult secretly occupies it.
A crypt lies beneath it.
The western tower is associated with a hidden entrance.
The cult is excavating toward the crypt.
```

Courtyards, rooms, individual cultists, objects, and exact connections need not exist yet.

When play approaches Blackmere, enough detail can be generated for the immediate situation. Persistent details that matter are then committed to Realm and become authoritative.

This applies to semantic truth as well as physical entities. The game master may initially establish only that an NPC appears to be hiding something. The exact secret does not necessarily need to exist yet. If the secret becomes important, it can be materialized and committed as hidden canon.

This gives a useful progression:

```text
unresolved implication
        ↓
materialized secret
        ↓
discovered by an actor
        ↓
understood / connected to other facts
```

Once materialized, later improvisation must respect the established fact.

## 6. World time

Realm owns an authoritative world clock.

The game master estimates how much fictional time an action consumes; Realm applies the resulting time advancement exactly.

Examples:

```text
look under the bed       ~1 minute
question an innkeeper   ~20 minutes
wait through dinner      ~4 hours
cross the forest         ~6 hours
sleep                    ~8 hours
```

Minute-perfect simulation is not the goal. Causal consistency is.

Advancing time may cause scheduled developments or active situations to become relevant.

## 7. Scheduled developments and pressures

Two different concepts are useful.

### Scheduled developments

These have a relatively concrete trigger:

```text
at Day 3 18:00
six hours from now
when the crypt is opened
when the player first enters Blackmere
two days after the king dies
```

Candidate operations include `schedule` and `cancel_schedule`.

### Pressures / agendas

These describe ongoing processes rather than exact future events:

```text
The cult is trying to reach the crypt.
Varek is gathering supporters.
The plague is spreading north.
```

A pressure can have a current state, intent, urgency, progress, and relevant participants without requiring Realm to simulate every off-screen action.

When sufficient time passes, the game master or a future world-simulation component may materialize consequences and commit them back to Realm.

This supports dramaturgical pressure without railroading: ignored situations continue to develop rather than forcing the player toward prepared content.

## 8. Operations

The initial operation vocabulary should remain deliberately small. Candidate primitives include:

```text
create / update / remove entity

move(entity, destination)
transfer(item, destination)

open(entity)
close(entity)
lock(entity)
unlock(entity, ...)

damage(entity, amount, type)
heal(entity, amount)
apply_condition(entity, condition)
remove_condition(entity, condition)
kill(entity)

roll(...)
check(...)

advance_time(...)

establish_fact(...)
reveal_fact(...)

schedule(...)
cancel_schedule(...)

start_combat(...)
combat_action(...)
end_turn(...)
end_combat(...)
```

These are Realm primitives, not a vocabulary for player commands.

For example:

> "I throw the chair through the window and jump after it."

may be interpreted by the game master into a check followed by operations such as damaging the character, moving the character, changing or destroying the window, and advancing time.

The exact operation set should emerge from worked gameplay cases rather than attempting to enumerate every possible interaction in advance.

## 9. Events and history

Successful state transitions should produce durable historical events.

Candidate examples include:

```text
EntityMoved
ItemTransferred
PortalUnlocked
CreatureDamaged
CreatureHealed
CreatureDied
ConditionApplied
FactEstablished
FactRevealed
TimeAdvanced
CombatStarted
CombatEnded
```

One operation may produce multiple events. Damage, for example, might also cause unconsciousness, death, or an item to be dropped.

The exact event taxonomy is not yet fixed. A smaller set of generic event forms with structured payloads may prove preferable to many event classes.

The important invariant is:

```text
operation requested
        ↓
Realm validates
        ↓
state transition
        ↓
durable history
```

This allows Realm to preserve both the current world and the sequence of changes that produced it.

## 10. World patches and materialization

Gameplay operations are small and precise. World construction can require many related changes at once.

Realm should therefore consider an atomic **WorldPatch** concept capable of proposing a coherent set of related changes, for example:

- new entities
- entity properties/components
- place connections
- canonical facts
- initial knowledge
- schedules
- situations or pressures

Realm validates the complete patch before committing it.

The producer of a WorldPatch is deliberately outside Realm's concern:

```text
Keeper ──────────────┐
                     │
World Builder AI ────┼──> WorldPatch ──> Realm
                     │
Scenario importer ───┤
                     │
Human editor ────────┘
```

Initially Keeper may produce such patches itself. A future specialized World Builder or simulator could perform materialization without changing Realm's authoritative model.

A scenario/world seed can likewise be treated conceptually as the initial large world patch at time zero.

## 11. Game phases

Not all play requires the same degree of mechanical rigidity.

Normal exploration and conversation should remain loose: the game master interprets actions and commits only persistent consequences that matter.

Some situations can enter a stricter sub-phase. Combat is the first clear example.

A combat phase may own structured state such as:

```text
participants
initiative / turn order
current turn
round
health
conditions
available mechanical actions
combat end conditions
```

The game master remains responsible for interpretation and narration while Realm owns dice, rules, exact state transitions, and invariants.

**Principle:** exploration can be loose; combat can be hard.

Other specialized phases may emerge later, but they should be introduced only when gameplay demonstrates a need.

## 12. What Realm deliberately does not model

Realm should not become a complete simulation of reality.

It does not need structured fields for every descriptive fact, a rule for every player verb, exact off-screen simulation of every NPC, a fully materialized map of the world, or a numerical representation of every relationship and emotion.

Free narrative memory remains useful for details whose exact mechanical interpretation is unimportant.

Structure is justified when Realm needs to:

- preserve exact continuity,
- enforce a rule or invariant,
- resolve a deterministic consequence,
- distinguish truth from knowledge,
- drive future causal developments, or
- expose reliable state to multiple clients or agents.

## 13. Worked cases

### Locked door

A crypt door connects two places and is currently locked. The player does not possess the required key and leaves the castle.

Six fictional hours pass. During that time an off-screen development causes Varek to pass through the door and leave it unlocked.

When the player returns, Realm authoritatively reports the door as unlocked. The game master explains the observable world from that state rather than reconstructing the door's status from conversational memory.

This case exercises persistent state, time, off-screen development, and causal continuity.

### Murder mystery

At some point it becomes established hidden canon that Varek murdered the merchant. Elin saw evidence relevant to the crime; another NPC may be innocent but suspicious.

The player may investigate through several independent routes. Discovering evidence changes player knowledge but does not change the underlying truth.

The hidden truth need not necessarily have existed from the first minute of the campaign. Keeper may begin with unresolved suspicious behaviour and materialize the underlying secret when it becomes causally relevant. Once established, however, the truth is authoritative and later clues must remain compatible with it.

This case exercises canon, hidden information, knowledge, lazy materialization, and consistency across multiple investigative paths.

### Combat

The player and two hostile creatures enter combat. Realm creates structured combat state and turn order.

The player says:

> "I try to knock the goblin's sword aside with my axe."

Realm does not need a bespoke `disarm_with_axe` operation. The game master interprets the attempt into appropriate checks or combat operations. Realm resolves the mechanical result and commits exact consequences.

If the goblin loses six hit points, those six hit points remain lost until another authoritative operation changes them.

This case exercises interpretation versus mechanics, dice/checks, deterministic state, and a stricter game phase.

## Open design questions

This document intentionally leaves several areas unresolved:

- Which properties are mandatory for each entity kind?
- Which components belong in the initial rules core?
- Should facts have a structured subject/predicate/object form, free text, or a hybrid?
- How should actor knowledge and partial/incorrect beliefs be represented?
- What is the minimal useful model for situations and pressures?
- What exactly may a WorldPatch change?
- How should scheduled triggers be represented and evaluated?
- How much combat machinery belongs in Realm v1?
- How generic should events be?
- When should an improvised detail be considered important enough to materialize?

These should be answered through concrete gameplay examples and experiments rather than by attempting to fully design the world model up front.
