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

## 3. Initial entity semantics

The fundamental entity kinds should remain deliberately thin. An entity does not need to carry every mechanical property it might someday require. Mechanical components can be materialized when play enters the relevant domain.

### Place

A Place represents somewhere entities can physically be located. Regions, settlements, buildings, rooms, roads, and wilderness areas can all be Places at different scales.

A Place should have stable identity and may be contained by another Place:

```yaml
id: blackmere_courtyard
type: place
name: Blackmere Courtyard
parent: blackmere_castle
```

Containment, connectivity, and travel are separate concepts. Two Places may be connected without one containing the other. A connection may optionally reference a stateful portal such as a door and may carry guidance such as typical travel time.

Stored travel information informs Keeper's ruling; the authoritative result is the actual movement and time advancement Keeper commits.

Places should not duplicate lists of their contents. Contents are derived from the containment relation.

### Physical containment

Physical location and possession should use one authoritative containment model rather than duplicating state as `location`, `inventory`, and `contents`.

Conceptually:

```text
blackmere_castle
└── courtyard
    ├── Elin
    │   └── backpack
    │       └── silver_key
    └── wooden_chest
        └── old_sword
```

A physical entity has at most one immediate containment parent. The parent may be a Place or another entity capable of containing it. Realm derives indirect physical location by following the containment chain.

Containment must not contain cycles.

Inventory is therefore a view over containment rather than independent state. Direct inventory consists of immediate children of a Creature; nested inventory includes descendants such as items inside a carried backpack.

Ownership is conceptually separate from physical possession. An item may be physically carried by one Creature while canonically belonging to another. Ownership does not need to become a hard mechanical relation until gameplay requires it.

Visibility and accessibility are also separate from containment. A key may physically be inside a backpack in the current room without being visible or immediately accessible to another actor.

**Principle:** every physical entity has at most one containment parent. Containment represents where it physically is, directly or indirectly. Ownership, knowledge, visibility, and mechanical use are separate concerns.

### Connections

Connections describe traversability or spatial relationships between Places.

A connection may contain information such as:

```yaml
from: blackmere_courtyard
to: western_tower
bidirectional: true
portal: western_tower_door
typical_travel_time: 1 minute
```

A physical portal can be its own entity when its state matters. For example, a door may have openable and lockable components. A forest path may connect two Places without any portal entity.

Connections must reference existing Places. Traversal through a stateful portal must respect the portal's authoritative state unless Keeper explicitly resolves an action that changes that state.

### Item

An Item is a persistent physical object. Its core representation can remain small:

```yaml
id: silver_key
type: item
name: Silver Key
contained_by: elin_backpack
quantity: 1
active: true
```

Items gain structured components only when recurring mechanics require them. Candidate early components include `container`, `openable`, `lockable`, and `weapon`.

For example:

```yaml
components:
  container: {}
  openable:
    open: false
  lockable:
    locked: true
    keys:
      - brass_key
```

The lock owns the authoritative compatibility relation rather than duplicating it on both lock and key.

An item does not enumerate every possible affordance. A chair does not require explicit `throwable`, `breakable`, `improvised_weapon`, or `firewood` components merely because Keeper might plausibly use it in those ways.

**Principle:** a recurring mechanic deserves a component. A one-off possibility can remain semantic until proven otherwise.

Fungible items may eventually support quantity and stack operations. Unique items simply have quantity one.

Destroying an Item should end its presence in the current world without erasing its stable historical identity or past events.

### Creature

A Creature represents a persistent actor or living/actor-like entity. Its core need not include a complete character sheet:

```yaml
id: elin
type: creature
name: Elin
contained_by: greenford_inn
description: A healer living in Greenford.
```

Health, stats, conditions, equipment, and similar mechanics should be optional components materialized when the game requires them. An innkeeper does not need combat statistics merely because the player could theoretically attack them.

The Game definition determines which mechanical components are expected and what they mean.

Equipment is separate mechanical state layered over containment. An equipped item must normally remain within the Creature's possession tree, but inventory itself is derived from containment rather than duplicated.

Life/death state should not be inferred blindly from health. Reaching zero health may mean death, unconsciousness, incapacitation, transformation, or something else according to the Game definition. If Realm stores an authoritative life state, the rules or Keeper decide when that state changes.

Knowledge does not belong inside the Creature as ordinary descriptive state. It is a relationship between an actor and world facts, allowing objective truth and actor belief to differ.

**Principle:** entities should not require mechanical state merely because they might someday participate in a mechanic. Required mechanics can be materialized when the entity enters that domain.

### Faction

A Faction is primarily a persistent group identity:

```yaml
id: blackmere_cult
type: faction
name: The Blackmere Cult
description: A secretive group operating around Blackmere.
```

Membership should be represented as a relationship rather than duplicated member lists:

```text
Varek ── member_of ──► Blackmere Cult
```

Metadata such as role, rank, or membership secrecy can be added if gameplay demonstrates a need.

Faction relationships such as hostility, cooperation, leadership, influence, or reputation may initially remain semantic canon. They should become structured mechanics only when Realm needs to enforce or query them reliably.

Goals and ongoing activities should not automatically be fields on Faction. A Faction can participate in multiple independent Situations.

### Situation

A Situation represents an unresolved or developing circumstance in the world whose future state may matter.

For example:

```yaml
id: cult_excavation
type: situation
name: The excavation beneath Blackmere
state: active
participants:
  - blackmere_cult
description: The Blackmere Cult is attempting to reach the sealed crypt.
```

A Situation may have optional structured state such as a stage, but should not require artificial numerical progress. Some developments naturally support progress measures; many do not.

A pressure or agenda can be treated as part of a Situation rather than requiring a separate fundamental entity kind:

```yaml
pressure:
  intent: Reach the sealed crypt.
  tendency: >
    Unless interfered with, the cult continues excavating and will
    eventually find an entrance.
```

Realm does not need to simulate such pressure continuously. When fictional time advances, Realm can surface relevant active Situations to Keeper. Keeper decides what has plausibly developed and commits the resulting state/canon changes.

A Situation should have a small lifecycle such as active/resolved/abandoned, while its detailed meaning can remain semantic.

This differs from a scheduled development. A schedule has a trigger Realm can evaluate deterministically; a Situation requires interpretation. A fuzzy Situation may later produce a precise schedule, for example when an ongoing cult excavation develops into a ritual planned for a known time.

Situations also avoid requiring a fundamental `Quest` entity. Player-facing quests or journal entries can be derived from situations, facts, and player knowledge without making the world organize itself around the player's objectives.

## 5. Current state and canon

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

## 5. Relations, facts, knowledge, and beliefs

Realm should not model every meaningful statement as a generic graph relation. Structure is justified where Realm needs to understand semantics, enforce invariants, or perform reliable queries and operations.

### Structured relations

A small set of relationships deserve first-class structure because Realm needs to reason about them. Initial examples include:

```text
contained_by(entity, container)
connected(place, place)
member_of(creature, faction)
```

Containment has invariants such as a single immediate physical parent and no cycles. Connections participate in traversal. Membership may be queried reliably without requiring Keeper to interpret prose.

Other relationships such as love, fear, debt, suspicion, family history, employment, or responsibility for an old event should normally begin as semantic canon unless gameplay demonstrates a need for Realm to understand them structurally.

**Principle:** a relation becomes structured when Realm needs to reason about or enforce its semantics. Otherwise, established meaning belongs in canon.

### Facts and canon

A Fact represents established semantic truth that is not already better represented by structured current state.

A useful initial form is deliberately hybrid:

```yaml
id: fact_42
text: Varek murdered the merchant.
subjects:
  - varek
  - merchant_aldren
tags:
  - murder
  - blackmere_mystery
```

The semantic proposition is authoritative. Optional entity references and tags improve retrieval and linking without requiring Realm to understand a complete subject/predicate/object ontology.

Realm should not duplicate structured state as facts. If a door entity already has:

```text
lockable.locked = true
```

Realm should not also need an authoritative Fact saying "the door is locked." That would create two competing representations of the same current state.

Historical or semantic truths remain appropriate facts:

```text
Varek locked the crypt door before leaving.
Varek murdered Aldren.
The crypt predates the castle.
Elin fears the king.
```

The first remains historically true even if the door is later unlocked.

This gives a useful distinction:

```text
CURRENT STATE
  How the world is now.
  → entities, components, structured relations

HISTORICAL / SEMANTIC CANON
  What happened or what is established as true.
  → events and facts
```

### Knowledge

Knowledge links an actor to established canon:

```text
knows(elin, fact_42)
knows(varek, fact_42)
```

Absence of a knowledge relation does not need to mean explicit ignorance; it simply means Realm has not established that the actor knows the Fact.

An operation such as `reveal_fact(fact, actor)` can establish knowledge and produce a durable event.

Secrecy is therefore not fundamentally a property of a Fact. The same truth may be known by many cultists, unknown to the player, and known only partially by another actor. What is secret emerges from the distribution of knowledge.

Realm should not maintain a complete per-actor replica of mutable world state. For example, if Elin last saw a door while it was locked and it was later opened off-screen, v1 does not need an automatic epistemic snapshot saying that Elin still believes `door.locked = true`.

Keeper can reason naturally from the circumstances. If a particular misunderstanding becomes narratively important, it can be persisted explicitly as a belief.

**Principle:** Realm tracks authoritative current state globally. Actor knowledge is persisted selectively for semantically important information, not as per-actor replicas of mutable world state.

### Beliefs

Belief is distinct from knowledge because an actor may hold a proposition that is false:

```yaml
holder: toren
text: Bandits murdered the merchant.
```

The canonical Fact may instead be:

```text
Varek murdered the merchant.
```

Beliefs should initially remain actor-scoped semantic propositions. Realm does not need a detailed psychological ontology of suspicion, doubt, confidence, denial, memory quality, or cognitive dissonance.

If such distinctions later become important to gameplay, they can be materialized then.

## 6. Lazy materialization

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

## 7. World time

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

## 8. Scheduled developments and pressures

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

## 9. Operations

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

## 10. Events and history

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

## 11. World patches and materialization

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

## 12. Game definition and evolving rules

Realm should separate authoritative world state from the game's rules and conventions.

A useful conceptual layering is:

```text
Realm engine
  └─ generic resolution/state primitives
     roll, check, damage, heal, conditions, time...

Game definition
  ├─ style / premise
  ├─ rules and guidelines
  ├─ world seed
  └─ initial player state

Game state
  └─ the concrete evolving world
```

The game definition does not need to be a complete formal ruleset. It may contain broad guidance such as:

```text
Low-fantasy.
Combat is dangerous.
Healing is slow.
Ordinary weapons have fairly stable effectiveness.
```

Keeper may make rulings within those guidelines. Realm records and enforces the resulting state changes.

### Exact state, resolution primitives, and game rules

Three layers should remain conceptually distinct:

1. **Exact state** — for example, Elin has 3/10 health and is bleeding.
2. **Resolution primitives** — dice rolls, checks, damage, healing, conditions, and other exact transitions.
3. **Game rules** — for example, how dangerous a fall is, what a sword normally does, or what happens at zero health.

Realm must own exact state and should provide deterministic resolution primitives. The amount of the game rules that Realm itself enforces can grow only where consistency requires it.

For example, Keeper might rule before a roll:

```text
This fall requires a Dexterity check against difficulty 13.
Failure: 1d6+2 damage and bleeding.
Success: 1d6 damage.
```

Realm can then perform the exact check, rolls, and resulting state transitions without needing a universal built-in falling rule.

### Rules can crystallize through play

A mechanic does not need to be formalized before it is first encountered.

A useful progression is:

```text
unspecified mechanic
        ↓
Keeper makes a ruling
        ↓
one-off consequence
        │
        └── if recurring or identity-defining
                    ↓
             established mechanic
                    ↓
          reused by future rulings
```

For example, the first time an iron sword matters, Keeper may establish that ordinary iron swords deal `1d8` slashing damage. If this should remain consistent, that mechanic can be persisted in the game definition or an appropriate entity/archetype definition.

The exact damage for each successful hit can still be resolved by Realm through a roll.

This is lazy materialization applied to rules: the game can begin with a small number of broad conventions and gradually acquire more precise mechanics as play demonstrates that they matter.

**Principle:** recurring mechanics deserve persistent rules; one-off rulings do not automatically require new engine mechanics.

### State does not imply a complete ruleset

Health, conditions, and similar state may be authoritative without Realm deciding all consequences automatically.

For example:

```text
health: 3 -> 0
```

does not inherently have to mean death. Depending on the game definition, Keeper may subsequently establish unconsciousness, death, incapacitation, transformation, or another consequence.

Likewise, a condition such as `bleeding` may initially be an authoritative persistent condition whose narrative/mechanical meaning is interpreted by Keeper. If it repeatedly has the same mechanical effect, that effect can later become an established rule.

This allows Realm to provide deterministic bookkeeping without prematurely becoming a complete RPG rules engine.

## 13. Game phases

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

## 14. What Realm deliberately does not model

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

## 15. Worked cases

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
