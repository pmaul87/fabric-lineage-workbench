/**
 * SemanticAnalyzerCalculationEngine
 * Backend calculation engine for pre-computing all derived semantic analysis data.
 * 
 * Replaces frontend useMemo hooks with efficient backend computations:
 * - Entity type counts and aggregates
 * - Transitive dependency traversal (depends on / depended on by)
 * - Relationship filter context
 * - Entity statistics pre-aggregation
 * - Report usage analysis
 */

class SemanticAnalyzerCalculationEngine {
  /**
   * Calculate entity type counts and aggregates
   * @param {Array} entities - Semantic entities
   * @returns {Object} Aggregate counts by type
   */
  static calculateEntityAggregates(entities) {
    const aggregates = {
      Table: 0,
      Column: 0,
      Measure: 0,
      Relationship: 0,
    };

    const typeCounts = {
      Table: { total: 0, hidden: 0 },
      Column: { total: 0, hidden: 0 },
      Measure: { total: 0, hidden: 0 },
      Relationship: { total: 0, hidden: 0 },
    };

    for (const entity of entities) {
      if (!aggregates.hasOwnProperty(entity.type)) {
        aggregates[entity.type] = 0;
      }
      aggregates[entity.type] += 1;

      if (!typeCounts.hasOwnProperty(entity.type)) {
        typeCounts[entity.type] = { total: 0, hidden: 0 };
      }
      typeCounts[entity.type].total += 1;
      if (entity.isHidden) {
        typeCounts[entity.type].hidden += 1;
      }
    }

    return { counts: aggregates, details: typeCounts };
  }

  /**
   * Build entity lookup indices for efficient O(1) access
   * @param {Array} entities - Semantic entities
   * @returns {Object} Index maps
   */
  static buildEntityIndices(entities) {
    const entityById = {};
    const tableByName = {};
    const tableIdByEntityId = {};
    const entitiesByTableName = {};

    for (const entity of entities) {
      entityById[entity.id] = entity;

      if (entity.type === "Table") {
        tableByName[entity.name.toLowerCase()] = entity;
      }

      if (entity.tableName) {
        tableIdByEntityId[entity.id] = tableByName[entity.tableName.toLowerCase()]?.id;
        if (!entitiesByTableName[entity.tableName]) {
          entitiesByTableName[entity.tableName] = [];
        }
        entitiesByTableName[entity.tableName].push(entity);
      }
    }

    return {
      entityById,
      tableByName,
      tableIdByEntityId,
      entitiesByTableName,
    };
  }

  /**
   * Calculate transitive dependencies for each entity
   * Uses BFS to find all direct and indirect dependencies
   * @param {Array} entities - Semantic entities
   * @param {Array} dependencies - Dependency edges
   * @returns {Object} Pre-calculated relationships by entity ID
   */
  static calculateTransitiveDependencies(entities, dependencies) {
    const indices = this.buildEntityIndices(entities);
    const entityRelationships = {};

    // Initialize for all entities
    for (const entity of entities) {
      entityRelationships[entity.id] = {
        dependsOn: [],
        dependedOnBy: [],
      };
    }

    // Build edge map for efficient lookup
    const edgesBySource = new Map();
    const edgesByTarget = new Map();

    for (const edge of dependencies) {
      if (!["expression", "contains-column", "contains-measure"].includes(edge.dependencyType)) {
        continue;
      }

      // Build source map
      const existingSource = edgesBySource.get(edge.sourceId) || [];
      existingSource.push(edge);
      edgesBySource.set(edge.sourceId, existingSource);

      // Build target map
      const existingTarget = edgesByTarget.get(edge.targetId) || [];
      existingTarget.push(edge);
      edgesByTarget.set(edge.targetId, existingTarget);
    }

    // BFS from each entity to find transitive dependencies
    for (const entity of entities) {
      const allowedEntityTypes = new Set(["Column", "Table", "Measure"]);

      // Find all entities this entity depends on
      const dependsOnMap = new Map();
      const queue = [{ id: entity.id, depth: 0 }];
      const visited = new Set([entity.id]);

      while (queue.length > 0) {
        const current = queue.shift();
        const outgoing = edgesBySource.get(current.id) || [];

        for (const edge of outgoing) {
          if (!visited.has(edge.targetId)) {
            visited.add(edge.targetId);
            const targetEntity = indices.entityById[edge.targetId];
            if (targetEntity && allowedEntityTypes.has(targetEntity.type)) {
              dependsOnMap.set(edge.targetId, current.depth + 1);
              queue.push({ id: edge.targetId, depth: current.depth + 1 });
            }
          }
        }
      }

      // Find all entities that depend on this entity
      const dependedOnByMap = new Map();
      const queue2 = [{ id: entity.id, depth: 0 }];
      const visited2 = new Set([entity.id]);

      while (queue2.length > 0) {
        const current = queue2.shift();
        const incoming = edgesByTarget.get(current.id) || [];

        for (const edge of incoming) {
          if (!visited2.has(edge.sourceId)) {
            visited2.add(edge.sourceId);
            const sourceEntity = indices.entityById[edge.sourceId];
            if (sourceEntity && allowedEntityTypes.has(sourceEntity.type)) {
              dependedOnByMap.set(edge.sourceId, current.depth + 1);
              queue2.push({ id: edge.sourceId, depth: current.depth + 1 });
            }
          }
        }
      }

      // Convert to sorted arrays with depth info
      entityRelationships[entity.id].dependsOn = Array.from(dependsOnMap.entries())
        .map(([id, depth]) => ({ entityId: id, depth }))
        .sort((a, b) => a.depth - b.depth || a.entityId.localeCompare(b.entityId));

      entityRelationships[entity.id].dependedOnBy = Array.from(dependedOnByMap.entries())
        .map(([id, depth]) => ({ entityId: id, depth }))
        .sort((a, b) => a.depth - b.depth || a.entityId.localeCompare(b.entityId));
    }

    return entityRelationships;
  }

  /**
   * Calculate relationship filter context (which tables filter which tables)
   * @param {Array} entities - Semantic entities
   * @param {Array} dependencies - Dependency edges
   * @returns {Object} Relationship context by entity ID
   */
  static calculateRelationshipFilterContext(entities, dependencies) {
    const indices = this.buildEntityIndices(entities);
    const relationshipContext = {};

    // Build table-level relationship graph
    const forward = new Map(); // table -> set of tables it filters
    const reverse = new Map(); // table -> set of tables filtered by

    const addTableEdge = (sourceTableId, targetTableId) => {
      if (sourceTableId === targetTableId) {
        return;
      }

      forward.set(sourceTableId, forward.get(sourceTableId) || new Set());
      forward.get(sourceTableId).add(targetTableId);

      reverse.set(targetTableId, reverse.get(targetTableId) || new Set());
      reverse.get(targetTableId).add(sourceTableId);
    };

    // Process relationship edges
    const relationshipEntityEndpoints = new Map();
    for (const edge of dependencies) {
      if (edge.dependencyType === "relationship") {
        const sourceTableId = indices.tableIdByEntityId[edge.sourceId];
        const targetTableId = indices.tableIdByEntityId[edge.targetId];
        if (sourceTableId && targetTableId) {
          addTableEdge(sourceTableId, targetTableId);
        }
      }

      if (edge.dependencyType === "relationship-from" || edge.dependencyType === "relationship-to") {
        const relation = relationshipEntityEndpoints.get(edge.sourceId) || {};
        const tableId = indices.tableIdByEntityId[edge.targetId];
        if (tableId) {
          if (edge.dependencyType === "relationship-from") {
            relation.fromTableId = tableId;
          }
          if (edge.dependencyType === "relationship-to") {
            relation.toTableId = tableId;
          }
        }
        relationshipEntityEndpoints.set(edge.sourceId, relation);
      }
    }

    // Finalize table edges from relationship entities
    for (const endpoint of relationshipEntityEndpoints.values()) {
      if (endpoint.toTableId && endpoint.fromTableId) {
        addTableEdge(endpoint.toTableId, endpoint.fromTableId);
      }
    }

    // Calculate transitive closure per table
    const traverse = (adjacency, startTableIds) => {
      const resultMap = new Map();
      const queue = startTableIds.map((id) => ({ id, depth: 0 }));
      const bestDepth = new Map();

      for (const tableId of startTableIds) {
        bestDepth.set(tableId, 0);
      }

      while (queue.length > 0) {
        const current = queue.shift();
        const nextIds = adjacency.get(current.id) || new Set();

        for (const nextId of nextIds) {
          const nextDepth = current.depth + 1;
          const existingDepth = bestDepth.get(nextId);

          if (existingDepth === undefined || existingDepth > nextDepth) {
            bestDepth.set(nextId, nextDepth);
            queue.push({ id: nextId, depth: nextDepth });
          }
        }
      }

      for (const [tableId, depth] of bestDepth.entries()) {
        if (depth > 0) {
          resultMap.set(tableId, depth);
        }
      }

      return resultMap;
    };

    // For each entity, calculate filter context
    for (const entity of entities) {
      const tableId = indices.tableIdByEntityId[entity.id];
      const startTableIds = tableId ? [tableId] : [];

      const filters = traverse(forward, startTableIds);
      const filteredBy = traverse(reverse, startTableIds);

      relationshipContext[entity.id] = {
        filters: Array.from(filters.entries())
          .map(([tableId, depth]) => ({ tableId, depth }))
          .sort((a, b) => a.depth - b.depth),
        filteredBy: Array.from(filteredBy.entries())
          .map(([tableId, depth]) => ({ tableId, depth }))
          .sort((a, b) => a.depth - b.depth),
      };
    }

    return relationshipContext;
  }

  /**
   * Pre-calculate all metrics needed for filtering and display
   * @param {Array} entities - Semantic entities
   * @param {Array} dependencies - Dependency edges
   * @param {Object} reportUsageByEntityId - Pre-calculated report usage
   * @returns {Object} All pre-calculated metrics
   */
  static calculateAllMetrics(entities, dependencies, reportUsageByEntityId = {}) {
    console.log("[SemanticAnalyzerCalculationEngine] Starting comprehensive metric calculation...", {
      entityCount: entities.length,
      dependencyCount: dependencies.length,
    });

    const startTime = Date.now();

    // Calculate aggregates
    const aggregates = this.calculateEntityAggregates(entities);

    // Calculate transitive dependencies
    const transitiveDependencies = this.calculateTransitiveDependencies(entities, dependencies);

    // Calculate relationship filter context
    const relationshipContext = this.calculateRelationshipFilterContext(entities, dependencies);

    const endTime = Date.now();
    console.log("[SemanticAnalyzerCalculationEngine] Metrics calculation complete", {
      durationMs: endTime - startTime,
      aggregates: aggregates.counts,
    });

    return {
      aggregates: aggregates.counts,
      aggregateDetails: aggregates.details,
      transitiveDependencies,
      relationshipContext,
      reportUsageByEntityId,
    };
  }

  /**
   * Flatten relationship data to simple denormalized format for API response
   * @param {Object} relationships - Relationship map
   * @returns {Object} Flattened for API
   */
  static flattenRelationships(relationships) {
    const flattened = {};
    for (const [entityId, rel] of Object.entries(relationships)) {
      flattened[entityId] = {
        dependsOn: rel.dependsOn.map((d) => d.entityId),
        dependedOnBy: rel.dependedOnBy.map((d) => d.entityId),
      };
    }
    return flattened;
  }
}

module.exports = SemanticAnalyzerCalculationEngine;
