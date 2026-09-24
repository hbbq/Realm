import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(join(process.cwd(), "web", "companion-map.js"), "utf8");
const realmMapSource = runInNewContext(`${source}\nrealmMapSource`) as (state: any) => string;

test("map groups direct and carried entities and uses place connections", () => {
  const diagram = realmMapSource({
    entities: [
      { id: "square", kind: "place", name: "Greyfen Square" },
      { id: "abbey", kind: "place", name: "Greyfen Abbey" },
      { id: "elin", kind: "creature", name: "Elin" },
      { id: "mara", kind: "creature", name: "Mara" },
      { id: "lantern", kind: "item", name: "Lantern" },
      { id: "scrap", kind: "item", name: "Torn Oilskin Scrap" }
    ],
    containment: [
      { child_entity_id: "elin", parent_entity_id: "abbey" },
      { child_entity_id: "mara", parent_entity_id: "abbey" },
      { child_entity_id: "lantern", parent_entity_id: "elin" },
      { child_entity_id: "scrap", parent_entity_id: "abbey" }
    ],
    connections: [
      { from_place_id: "square", to_place_id: "abbey", bidirectional: true, typical_travel_minutes: 25 },
      { from_place_id: "abbey", to_place_id: "square", bidirectional: false }
    ]
  });
  assert.match(diagram, /subgraph place_0\["Greyfen Square"\]\s+empty_place_0\["\[empty\]"\]/);
  assert.match(diagram, /subgraph place_1\["Greyfen Abbey"\]/);
  assert.match(diagram, /entity_2\["creature#58; Elin"\]/);
  assert.match(diagram, /entity_5\["item#58; Torn Oilskin Scrap"\]/);
  assert.match(diagram, /entity_2 --- entity_4/);
  assert.match(diagram, /place_0 ---\|"25 min"\| place_1/);
  assert.match(diagram, /place_1 --> place_0/);
});

test("map shows items nested inside other items at any depth", () => {
  const diagram = realmMapSource({
    entities: [
      { id: "room", kind: "place", name: "Room" },
      { id: "actor", kind: "creature", name: "Actor" },
      { id: "backpack", kind: "item", name: "Backpack" },
      { id: "pouch", kind: "item", name: "Pouch" },
      { id: "key", kind: "item", name: "Key" },
      { id: "chest", kind: "item", name: "Chest" },
      { id: "coin", kind: "item", name: "Coin" }
    ],
    containment: [
      { child_entity_id: "actor", parent_entity_id: "room" },
      { child_entity_id: "backpack", parent_entity_id: "actor" },
      { child_entity_id: "pouch", parent_entity_id: "backpack" },
      { child_entity_id: "key", parent_entity_id: "pouch" },
      { child_entity_id: "chest", parent_entity_id: "room" },
      { child_entity_id: "coin", parent_entity_id: "chest" }
    ],
    connections: []
  });
  assert.match(diagram, /entity_1 --- entity_2/);
  assert.match(diagram, /entity_2 --- entity_3/);
  assert.match(diagram, /entity_3 --- entity_4/);
  assert.match(diagram, /entity_5 --- entity_6/);
  assert.match(diagram, /entity_4\["item#58; Key"\]/);
  assert.doesNotMatch(diagram, /empty_place_0/);
});

test("map encodes names and uses only the selected projection", () => {
  const diagram = realmMapSource({
    entities: [
      { id: 'place"; evil --> x', kind: "place", name: 'Visible [<script>]&"\nend' },
      { id: "actor", kind: "creature", name: 'Elin "end"' },
      { id: "unnamed", kind: "item", name: null }
    ],
    containment: [
      { child_entity_id: "actor", parent_entity_id: 'place"; evil --> x' },
      { child_entity_id: "unnamed", parent_entity_id: 'place"; evil --> x' }
    ],
    connections: [{ from_place_id: 'place"; evil --> x', to_place_id: "unseen", typical_travel_minutes: 1 }]
  });
  assert.match(diagram, /Visible #91;#60;script#62;#93;#38;#34;#10;end/);
  assert.match(diagram, /creature#58; Elin #34;end#34;/);
  assert.match(diagram, /item#58; #91;unnamed#93;/);
  assert.doesNotMatch(diagram, /evil|unseen|--> x|place_0 -->/);
  assert.doesNotMatch(diagram, /empty_place_0/);
});
