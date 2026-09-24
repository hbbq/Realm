// Build Mermaid source only from the state passed by the selected Companion view.
function realmMapSource(state) {
  const places = state.entities.filter(entity => entity.kind === 'place');
  const entities = new Map(state.entities.map((entity, index) => [entity.id, { ...entity, node: `entity_${index}` }]));
  const placeNodes = new Map(places.map((place, index) => [place.id, `place_${index}`]));
  const parent = new Map(state.containment.map(row => [row.child_entity_id, row.parent_entity_id]));
  // Mermaid's decimal character references keep names out of diagram syntax.
  const label = value => [...String(value)].map(char => /[A-Za-z0-9 ]/.test(char)
    ? char : `#${char.codePointAt(0)};`).join('');
  const lines = ['flowchart LR'];

  for (const place of places) {
    lines.push(`    subgraph ${placeNodes.get(place.id)}["${label(place.name ?? '[unnamed]')}"]`);
    const creatures = state.entities.filter(entity => entity.kind === 'creature' && parent.get(entity.id) === place.id);
    const directItems = state.entities.filter(entity => entity.kind === 'item' && parent.get(entity.id) === place.id);
    const carriedItems = creatures.flatMap(creature => state.entities.filter(entity => entity.kind === 'item' && parent.get(entity.id) === creature.id));
    for (const entity of [...creatures, ...directItems, ...carriedItems]) {
      lines.push(`        ${entities.get(entity.id).node}["${label(`${entity.kind}: ${entity.name ?? '[unnamed]'}`)}"]`);
    }
    if (!creatures.length && !directItems.length && !carriedItems.length) {
      lines.push(`        empty_${placeNodes.get(place.id)}["[empty]"]`);
    }
    for (const creature of creatures) {
      for (const item of carriedItems.filter(entity => parent.get(entity.id) === creature.id)) {
        lines.push(`        ${entities.get(creature.id).node} --- ${entities.get(item.id).node}`);
      }
    }
    lines.push('    end');
  }
  for (const connection of state.connections) {
    const from = placeNodes.get(connection.from_place_id);
    const to = placeNodes.get(connection.to_place_id);
    if (!from || !to) continue;
    const arrow = connection.bidirectional === false ? '-->' : '---';
    const minutes = connection.typical_travel_minutes;
    const edgeLabel = minutes == null ? '' : `|"${label(`${minutes} min`)}"|`;
    lines.push(`    ${from} ${arrow}${edgeLabel} ${to}`);
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined') module.exports = { realmMapSource };
