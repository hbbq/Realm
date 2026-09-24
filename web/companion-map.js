// Build Mermaid source only from the state passed by the selected Companion view.
function realmMapSource(state) {
  const places = state.entities.filter(entity => entity.kind === 'place');
  const entities = new Map(state.entities.map((entity, index) => [entity.id, { ...entity, node: `entity_${index}` }]));
  const placeNodes = new Map(places.map((place, index) => [place.id, `place_${index}`]));
  const parent = new Map(state.containment.map(row => [row.child_entity_id, row.parent_entity_id]));
  const children = new Map();
  for (const entity of state.entities) {
    const parentId = parent.get(entity.id);
    if (parentId == null) continue;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(entity);
  }
  // Mermaid's decimal character references keep names out of diagram syntax.
  const label = value => [...String(value)].map(char => /[A-Za-z0-9 ]/.test(char)
    ? char : `#${char.codePointAt(0)};`).join('');
  const lines = ['flowchart LR'];

  for (const place of places) {
    lines.push(`    subgraph ${placeNodes.get(place.id)}["${label(place.name ?? '[unnamed]')}"]`);
    const contents = [];
    const links = [];
    const visited = new Set([place.id]);
    const visit = containerId => {
      for (const entity of children.get(containerId) ?? []) {
        if ((entity.kind !== 'creature' && entity.kind !== 'item') || visited.has(entity.id)) continue;
        visited.add(entity.id);
        contents.push(entity);
        if (containerId !== place.id) links.push([containerId, entity.id]);
        visit(entity.id);
      }
    };
    visit(place.id);
    for (const entity of contents) {
      lines.push(`        ${entities.get(entity.id).node}["${label(`${entity.kind}: ${entity.name ?? '[unnamed]'}`)}"]`);
    }
    if (!contents.length) {
      lines.push(`        empty_${placeNodes.get(place.id)}["[empty]"]`);
    }
    for (const [containerId, childId] of links) {
      lines.push(`        ${entities.get(containerId).node} --- ${entities.get(childId).node}`);
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
