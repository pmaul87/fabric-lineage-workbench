const fs = require('fs');
const path = require('path');
const assert = require('assert');

const fixturesDir = path.join(__dirname, 'fixtures');
const fixtureFiles = [
  'valid-lineage.json',
  'orphan-semantic-model.json',
];

function loadFixture(fileName) {
  const filePath = path.join(fixturesDir, fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildProjection(fixture) {
  const nodes = Array.isArray(fixture.nodes) ? fixture.nodes : [];
  const edges = Array.isArray(fixture.edges) ? fixture.edges : [];
  const selectedNodeId = fixture.selectedNodeId;
  const graphScope = fixture.expectations?.graphScope || 'focused';
  const graphDisplayMode = fixture.expectations?.graphDisplayMode || 'filter';
  const graphNodeLimit = fixture.expectations?.graphNodeLimit || 25;

  const filteredNodes = nodes.slice();
  const filteredEdges = edges.filter((edge) => filteredNodes.some((node) => node.nodeId === edge.fromNodeId) && filteredNodes.some((node) => node.nodeId === edge.toNodeId));

  if (graphScope === 'full') {
    return {
      graphNodes: filteredNodes.slice(0, graphNodeLimit),
      graphEdges: filteredEdges,
      hiddenNodeCount: Math.max(0, filteredNodes.length - Math.min(filteredNodes.length, graphNodeLimit)),
      hiddenEdgeCount: 0,
      requiresSelection: false,
      focusWarning: undefined,
    };
  }

  if (!selectedNodeId || !filteredNodes.some((node) => node.nodeId === selectedNodeId)) {
    return {
      graphNodes: [],
      graphEdges: [],
      hiddenNodeCount: filteredNodes.length,
      hiddenEdgeCount: filteredEdges.length,
      requiresSelection: true,
      focusWarning: undefined,
    };
  }

  const upstreamMap = new Map();
  const downstreamMap = new Map();
  for (const edge of edges) {
    if (!upstreamMap.has(edge.toNodeId)) upstreamMap.set(edge.toNodeId, []);
    upstreamMap.get(edge.toNodeId).push(edge.fromNodeId);
    if (!downstreamMap.has(edge.fromNodeId)) downstreamMap.set(edge.fromNodeId, []);
    downstreamMap.get(edge.fromNodeId).push(edge.toNodeId);
  }

  const visited = new Set([selectedNodeId]);
  const queue = [selectedNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of upstreamMap.get(current) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    for (const neighbor of downstreamMap.get(current) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  let graphNodes = nodes.filter((node) => visited.has(node.nodeId));
  const parentIdsToAdd = new Set();
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
  for (const node of graphNodes) {
    if (node.parentNodeId && !visited.has(node.parentNodeId) && nodeMap.has(node.parentNodeId)) {
      parentIdsToAdd.add(node.parentNodeId);
    }
  }
  for (const parentId of parentIdsToAdd) {
    visited.add(parentId);
    const parentNode = nodeMap.get(parentId);
    if (parentNode) graphNodes.push(parentNode);
  }

  const graphEdges = edges.filter((edge) => visited.has(edge.fromNodeId) && visited.has(edge.toNodeId));
  const focusWarning = graphEdges.length === 0 ? 'Selected node is isolated (no lineage edges available).' : undefined;

  if (graphNodes.length === 0 && selectedNodeId) {
    const selectedNode = nodeMap.get(selectedNodeId);
    if (selectedNode) {
      return {
        graphNodes: [selectedNode],
        graphEdges: [],
        hiddenNodeCount: Math.max(0, nodes.length - 1),
        hiddenEdgeCount: edges.length,
        requiresSelection: false,
        focusWarning: 'Selected node has no connected lineage edges in current data.',
      };
    }
  }

  return {
    graphNodes,
    graphEdges,
    hiddenNodeCount: Math.max(0, nodes.length - graphNodes.length),
    hiddenEdgeCount: Math.max(0, edges.length - graphEdges.length),
    requiresSelection: false,
    focusWarning,
  };
}

function runFixture(fileName) {
  const fixture = loadFixture(fileName);
  const projection = buildProjection(fixture);
  const expected = fixture.expectations || {};

  assert.strictEqual(projection.graphNodes.length, expected.graphNodes, `${fileName}: graphNodes mismatch`);
  assert.strictEqual(projection.graphEdges.length, expected.graphEdges, `${fileName}: graphEdges mismatch`);
  assert.strictEqual(projection.requiresSelection, expected.requiresSelection, `${fileName}: requiresSelection mismatch`);
  assert.strictEqual(Boolean(projection.focusWarning), Boolean(expected.focusWarning), `${fileName}: focusWarning mismatch`);

  console.log(`[smoke] ${fileName} passed`);
}

function main() {
  for (const fileName of fixtureFiles) {
    runFixture(fileName);
  }
  console.log('[smoke] lineage fixtures passed');
}

main();
