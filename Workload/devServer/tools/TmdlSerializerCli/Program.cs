using System.Collections;
using JsonSerializer = System.Text.Json.JsonSerializer;
using System.Text.RegularExpressions;
using Microsoft.AnalysisServices;
using Microsoft.AnalysisServices.Tabular;
using TabularServer = Microsoft.AnalysisServices.Tabular.Server;
using TabularDatabase = Microsoft.AnalysisServices.Tabular.Database;
using TabularTmdlSerializer = Microsoft.AnalysisServices.Tabular.TmdlSerializer;

if (args.Length < 5)
{
    Console.Error.WriteLine("Usage: TmdlSerializerCli <mode: analyze|tmdl> <workspaceName> <datasetId> <datasetName> <accessToken>");
    Environment.Exit(2);
}

var mode = args[0];
var workspaceName = args[1];
var datasetId = args[2];
var datasetName = args[3];
var accessToken = args[4];

var server = new TabularServer();

try
{
    var database = ConnectAndResolveDatabase(server, workspaceName, datasetId, datasetName, accessToken);

    switch (mode.ToLowerInvariant())
    {
        case "tmdl":
            Console.Write(TabularTmdlSerializer.SerializeDatabase(database));
            break;
        case "analyze":
            Console.Write(BuildAnalyzerJson(database, datasetId));
            break;
        default:
            throw new InvalidOperationException($"Unsupported mode '{mode}'. Expected 'analyze' or 'tmdl'.");
    }
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.ToString());
    Environment.Exit(1);
}
finally
{
    if (server.Connected)
    {
        server.Disconnect();
    }
    server.Dispose();
}

static TabularDatabase ConnectAndResolveDatabase(
    TabularServer server,
    string workspaceName,
    string datasetId,
    string datasetName,
    string accessToken)
{
    var dataSource = $"powerbi://api.powerbi.com/v1.0/myorg/{workspaceName}";
    var connectionString = $"DataSource={dataSource};";

    server.AccessToken = new AccessToken(accessToken, DateTimeOffset.UtcNow.AddMinutes(30), null);
    server.Connect(connectionString);

    TabularDatabase? database = null;

    if (!string.IsNullOrWhiteSpace(datasetId))
    {
        database = server.Databases.Cast<TabularDatabase>().FirstOrDefault(db =>
            string.Equals(db.ID, datasetId, StringComparison.OrdinalIgnoreCase));
    }

    if (database is null && !string.IsNullOrWhiteSpace(datasetName))
    {
        database = server.Databases.FindByName(datasetName);
    }

    if (database is null)
    {
        throw new InvalidOperationException($"Dataset not found. DatasetId='{datasetId}', DatasetName='{datasetName}'");
    }

    return database;
}

static string BuildAnalyzerJson(TabularDatabase database, string datasetId)
{
    var model = database.Model;
    var entities = new List<Dictionary<string, object?>>();
    var dependencies = new List<Dictionary<string, object?>>();
    var dependencyIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    var tableIdByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var columnIdByQualifiedName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var measureIdByQualifiedName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var entityById = new Dictionary<string, Dictionary<string, object?>>(StringComparer.OrdinalIgnoreCase);

    var measureIdsByName = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
    var columnIdsByName = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
    var expressionSources = new List<(string EntityId, string TableName, string Expression)>();

    void AddEntity(Dictionary<string, object?> entity)
    {
        entities.Add(entity);
        entityById[(string)entity["id"]!] = entity;
    }

    void AddDependency(string? sourceId, string? targetId, string dependencyType)
    {
        if (string.IsNullOrWhiteSpace(sourceId) || string.IsNullOrWhiteSpace(targetId) || sourceId == targetId)
        {
            return;
        }

        if (!entityById.TryGetValue(sourceId, out var source) || !entityById.TryGetValue(targetId, out var target))
        {
            return;
        }

        var id = $"{sourceId}->{targetId}:{dependencyType}";
        if (!dependencyIds.Add(id))
        {
            return;
        }

        dependencies.Add(new Dictionary<string, object?>
        {
            ["id"] = id,
            ["sourceId"] = sourceId,
            ["sourceName"] = source["name"],
            ["targetId"] = targetId,
            ["targetName"] = target["name"],
            ["dependencyType"] = dependencyType,
        });
    }

    void AddNameIndex(Dictionary<string, List<string>> index, string key, string id)
    {
        if (!index.TryGetValue(key, out var current))
        {
            current = new List<string>();
            index[key] = current;
        }

        current.Add(id);
    }

    string? ResolveTokenTargetId(string currentTableName, string token)
    {
        var withQuotedTable = Regex.Match(token, "^'([^']+)'\\[([^\\]]+)\\]$");
        if (withQuotedTable.Success)
        {
            var tableName = withQuotedTable.Groups[1].Value;
            var name = withQuotedTable.Groups[2].Value;

            if (columnIdByQualifiedName.TryGetValue($"{tableName}|{name}", out var quotedColumnId))
            {
                return quotedColumnId;
            }

            if (measureIdByQualifiedName.TryGetValue($"{tableName}|{name}", out var quotedMeasureId))
            {
                return quotedMeasureId;
            }

            return null;
        }

        var withUnquotedTable = Regex.Match(token, "^([^\\[\\]'\\s][^\\[\\]']*)\\[([^\\]]+)\\]$");
        if (withUnquotedTable.Success)
        {
            var tableName = withUnquotedTable.Groups[1].Value.Trim();
            var name = withUnquotedTable.Groups[2].Value;

            if (columnIdByQualifiedName.TryGetValue($"{tableName}|{name}", out var unquotedColumnId))
            {
                return unquotedColumnId;
            }

            if (measureIdByQualifiedName.TryGetValue($"{tableName}|{name}", out var unquotedMeasureId))
            {
                return unquotedMeasureId;
            }

            return null;
        }

        var bare = Regex.Match(token, "^\\[([^\\]]+)\\]$");
        if (!bare.Success)
        {
            return null;
        }

        var tokenName = bare.Groups[1].Value;

        if (measureIdByQualifiedName.TryGetValue($"{currentTableName}|{tokenName}", out var localMeasureId))
        {
            return localMeasureId;
        }

        if (columnIdByQualifiedName.TryGetValue($"{currentTableName}|{tokenName}", out var localColumnId))
        {
            return localColumnId;
        }

        if (measureIdsByName.TryGetValue(tokenName, out var namedMeasures) && namedMeasures.Count == 1)
        {
            return namedMeasures[0];
        }

        if (columnIdsByName.TryGetValue(tokenName, out var namedColumns) && namedColumns.Count == 1)
        {
            return namedColumns[0];
        }

        return null;
    }

    foreach (var table in model.Tables)
    {
        var tableId = $"{datasetId}:table:{table.Name}";
        tableIdByName[table.Name] = tableId;
        AddEntity(new Dictionary<string, object?>
        {
            ["id"] = tableId,
            ["name"] = table.Name,
            ["type"] = "Table",
            ["isHidden"] = table.IsHidden,
            ["details"] = string.IsNullOrWhiteSpace(table.Description) ? null : table.Description,
        });
    }

    foreach (var table in model.Tables)
    {
        var tableId = tableIdByName[table.Name];

        foreach (var column in table.Columns)
        {
            var columnId = $"{datasetId}:table:{table.Name}:column:{column.Name}";
            string? expression = column is CalculatedColumn calculatedColumn ? calculatedColumn.Expression : null;

            AddEntity(new Dictionary<string, object?>
            {
                ["id"] = columnId,
                ["name"] = column.Name,
                ["type"] = "Column",
                ["isHidden"] = column.IsHidden,
                ["tableName"] = table.Name,
                ["dataType"] = column.DataType.ToString(),
                ["format"] = string.IsNullOrWhiteSpace(column.FormatString) ? null : column.FormatString,
                ["expression"] = string.IsNullOrWhiteSpace(expression) ? null : expression,
                ["details"] = string.IsNullOrWhiteSpace(column.Description) ? null : column.Description,
            });

            columnIdByQualifiedName[$"{table.Name}|{column.Name}"] = columnId;
            AddDependency(columnId, tableId, "contains-column");
            AddNameIndex(columnIdsByName, column.Name, columnId);

            if (!string.IsNullOrWhiteSpace(expression))
            {
                expressionSources.Add((columnId, table.Name, expression));
            }
        }

        foreach (var measure in table.Measures)
        {
            var measureId = $"{datasetId}:table:{table.Name}:measure:{measure.Name}";
            AddEntity(new Dictionary<string, object?>
            {
                ["id"] = measureId,
                ["name"] = measure.Name,
                ["type"] = "Measure",
                ["isHidden"] = measure.IsHidden,
                ["tableName"] = table.Name,
                ["format"] = string.IsNullOrWhiteSpace(measure.FormatString) ? null : measure.FormatString,
                ["expression"] = string.IsNullOrWhiteSpace(measure.Expression) ? null : measure.Expression,
                ["details"] = string.IsNullOrWhiteSpace(measure.Description) ? null : measure.Description,
            });

            measureIdByQualifiedName[$"{table.Name}|{measure.Name}"] = measureId;
            AddDependency(measureId, tableId, "contains-measure");
            AddNameIndex(measureIdsByName, measure.Name, measureId);

            if (!string.IsNullOrWhiteSpace(measure.Expression))
            {
                expressionSources.Add((measureId, table.Name, measure.Expression));
            }
        }
    }

    foreach (var relationshipBase in model.Relationships)
    {
        if (relationshipBase is not SingleColumnRelationship relationship)
        {
            continue;
        }

        var fromTable = relationship.FromTable?.Name;
        var toTable = relationship.ToTable?.Name;
        var fromColumn = relationship.FromColumn?.Name;
        var toColumn = relationship.ToColumn?.Name;

        if (string.IsNullOrWhiteSpace(fromTable) || string.IsNullOrWhiteSpace(toTable))
        {
            continue;
        }

        var relationshipName = $"{fromTable}.{fromColumn ?? "?"} → {toTable}.{toColumn ?? "?"}";
        var relationshipId = $"{datasetId}:relationship:{relationshipName}";

        AddEntity(new Dictionary<string, object?>
        {
            ["id"] = relationshipId,
            ["name"] = relationshipName,
            ["type"] = "Relationship",
            ["tableName"] = fromTable,
            ["details"] = relationship.CrossFilteringBehavior.ToString(),
        });

        columnIdByQualifiedName.TryGetValue($"{fromTable}|{fromColumn}", out var fromColumnId);
        columnIdByQualifiedName.TryGetValue($"{toTable}|{toColumn}", out var toColumnId);
        tableIdByName.TryGetValue(fromTable, out var fromTableId);
        tableIdByName.TryGetValue(toTable, out var toTableId);

        if (!string.IsNullOrWhiteSpace(fromColumnId) && !string.IsNullOrWhiteSpace(toColumnId))
        {
            AddDependency(toColumnId, fromColumnId, "relationship");
        }
        else if (!string.IsNullOrWhiteSpace(fromTableId) && !string.IsNullOrWhiteSpace(toTableId))
        {
            AddDependency(toTableId, fromTableId, "relationship");
        }

        AddDependency(relationshipId, fromTableId, "relationship-from");
        AddDependency(relationshipId, toTableId, "relationship-to");
    }

    foreach (var source in expressionSources)
    {
        foreach (Match match in Regex.Matches(source.Expression, @"'[^']+'\[[^\]]+\]|[^\[\]'\s][^\[\]']*\[[^\]]+\]|\[[^\]]+\]"))
        {
            var targetId = ResolveTokenTargetId(source.TableName, match.Value);
            if (string.IsNullOrWhiteSpace(targetId) || targetId == source.EntityId)
            {
                continue;
            }

            AddDependency(source.EntityId, targetId, "expression");
        }
    }

    var sortedEntities = entities
        .OrderBy(entity => entity["type"]?.ToString())
        .ThenBy(entity => entity.TryGetValue("tableName", out var tableName) ? tableName?.ToString() : string.Empty)
        .ThenBy(entity => entity["name"]?.ToString())
        .ToList();

    var sortedDependencies = dependencies
        .OrderBy(dependency => dependency["sourceName"]?.ToString())
        .ThenBy(dependency => dependency["targetName"]?.ToString())
        .ThenBy(dependency => dependency["dependencyType"]?.ToString())
        .ToList();

    return JsonSerializer.Serialize(
        new Dictionary<string, object?>
        {
            ["entities"] = sortedEntities,
            ["dependencies"] = sortedDependencies,
        },
        new System.Text.Json.JsonSerializerOptions
        {
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
            WriteIndented = false,
        });
}
