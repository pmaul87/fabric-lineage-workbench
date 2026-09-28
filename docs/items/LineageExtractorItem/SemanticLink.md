# Semantic Link Integration Guide

Phase 0: Scaffolding - Semantic link usage documentation

## Overview

This guide explains how to use **semantic-link** and **semantic-link-labs** (Microsoft official libraries) for extracting granular metadata from Semantic Models in Fabric.

## Why Semantic Link?

**semantic-link** is the **official Microsoft approach** for accessing Semantic Model metadata programmatically. It provides:

- **Granular Access**: Columns, measures, relationships, DAX expressions
- **Python Integration**: Works seamlessly with Fabric notebooks
- **Official Support**: Maintained by Microsoft
- **Labs Extensions**: Advanced features in semantic-link-labs

## Installation (Phase 1)

In Fabric notebook:

```python
%pip install semantic-link semantic-link-labs
```

## Key Functions from semantic-link-labs

### list_measures()
Extract all measures from a Semantic Model:

```python
from sempy_labs import list_measures

measures = list_measures(
    dataset="your-semantic-model-name",
    workspace="your-workspace-name"
)
```

Returns DataFrame with:
- Measure Name
- DAX Expression
- Table Name
- Display Folder
- Description

### list_columns()
Extract all columns:

```python
from sempy_labs import list_columns

columns = list_columns(
    dataset="your-semantic-model-name",
    workspace="your-workspace-name"
)
```

Returns DataFrame with:
- Column Name
- Table Name
- Data Type
- Source Column
- Description

### list_relationships()
Extract relationships between tables:

```python
from sempy_labs import list_relationships

relationships = list_relationships(
    dataset="your-semantic-model-name",
    workspace="your-workspace-name"
)
```

Returns DataFrame with:
- From Table
- From Column
- To Table
- To Column
- Cardinality
- Cross Filter Direction

### list_functions()
Extract calculated columns and other functions:

```python
from sempy_labs import list_functions

functions = list_functions(
    dataset="your-semantic-model-name",
    workspace="your-workspace-name"
)
```

## Usage Pattern (Phase 1 Implementation)

### Step 1: Connect to Workspace
```python
import sempy.fabric as fabric

# Get workspace ID
workspace_id = "your-workspace-id"
workspace = fabric.resolve_workspace_name(workspace_id)
```

### Step 2: List Semantic Models
```python
# Get all semantic models in workspace
models = fabric.list_datasets(workspace=workspace)

for model in models:
    print(f"Model: {model['name']}, ID: {model['id']}")
```

### Step 3: Extract Metadata
```python
from sempy_labs import list_measures, list_columns, list_relationships

model_name = "Sales Model"

# Extract all metadata
measures = list_measures(dataset=model_name, workspace=workspace)
columns = list_columns(dataset=model_name, workspace=workspace)
relationships = list_relationships(dataset=model_name, workspace=workspace)

print(f"Measures: {len(measures)}")
print(f"Columns: {len(columns)}")
print(f"Relationships: {len(relationships)}")
```

### Step 4: Save to Lakehouse
```python
import json

# Prepare output
result = {
    "modelId": model_id,
    "modelName": model_name,
    "extractedAt": datetime.now().isoformat(),
    "measures": measures.to_dict(orient='records'),
    "columns": columns.to_dict(orient='records'),
    "relationships": relationships.to_dict(orient='records')
}

# Save to lakehouse
output_path = f"/lakehouse/default/Files/lineage/raw/semantic_models/{model_id}.json"
with open(output_path, 'w') as f:
    json.dump(result, f, indent=2)

print(f"Saved to: {output_path}")
```

## Integration with LineageExtractor (Phase 1)

### Architecture
1. **Frontend**: LineageExtractor item UI triggers extraction
2. **Spark Livy**: Creates session and runs semantic link notebook
3. **Notebook**: Uses semantic-link-labs to extract metadata
4. **Lakehouse**: Stores results in Files/lineage/raw/semantic_models/
5. **Frontend**: Retrieves results and updates status

### Spark Livy Integration
```typescript
// In SemanticLinkClient.ts
async executeNotebookExtraction(
  workspaceId: string,
  lakehouseId: string,
  semanticModelId: string
): Promise<string> {
  // Create Spark Livy session
  const session = await this.sparkLivyClient.createSession(
    workspaceId,
    lakehouseId,
    {
      name: "Semantic Link Extraction",
      kind: "pyspark"
    }
  );

  // Submit extraction code
  const code = `
from sempy_labs import list_measures, list_columns, list_relationships
import json

measures = list_measures(dataset="${semanticModelId}", workspace="${workspaceId}")
columns = list_columns(dataset="${semanticModelId}", workspace="${workspaceId}")
relationships = list_relationships(dataset="${semanticModelId}", workspace="${workspaceId}")

result = {
    "modelId": "${semanticModelId}",
    "measures": measures.to_dict(orient='records'),
    "columns": columns.to_dict(orient='records'),
    "relationships": relationships.to_dict(orient='records')
}

output_path = f"/lakehouse/default/Files/lineage/raw/semantic_models/${semanticModelId}.json"
with open(output_path, 'w') as f:
    json.dump(result, f, indent=2)
`;

  const statement = await this.sparkLivyClient.submitStatement(
    workspaceId,
    lakehouseId,
    session.id,
    { code }
  );

  return statement.id;
}
```

## Best Practices

### 1. Error Handling
Always wrap semantic-link calls in try/except:

```python
try:
    measures = list_measures(dataset=model_name, workspace=workspace)
except Exception as e:
    print(f"Failed to extract measures: {e}")
    measures = pd.DataFrame()  # Empty DataFrame as fallback
```

### 2. Batch Processing
Process multiple models efficiently:

```python
models = ["Sales Model", "Marketing Model", "Finance Model"]

for model in models:
    try:
        extract_and_save(model, workspace)
        print(f"✓ {model}")
    except Exception as e:
        print(f"✗ {model}: {e}")
```

### 3. Progress Tracking
Add progress indicators for long-running extractions:

```python
from tqdm import tqdm

for i, model in enumerate(tqdm(models)):
    extract_and_save(model, workspace)
```

### 4. Data Validation
Validate extracted data before saving:

```python
def validate_extraction(measures, columns, relationships):
    if measures.empty and columns.empty:
        raise ValueError("No data extracted")
    
    if not all(col in columns.columns for col in ['Column Name', 'Table Name']):
        raise ValueError("Missing required columns")
    
    return True
```

## Limitations

1. **Workspace Access**: User must have at least Read permission on workspace
2. **Semantic Model Access**: Model must be accessible to user
3. **API Rate Limits**: May encounter throttling with large numbers of models
4. **Lakehouse Required**: Notebook must be attached to lakehouse for file writes

## Troubleshooting

### Issue: "Module not found: sempy_labs"
**Solution**: Install semantic-link-labs package
```python
%pip install semantic-link-labs
```

### Issue: "Cannot connect to workspace"
**Solution**: Verify workspace ID and permissions
```python
import sempy.fabric as fabric
workspaces = fabric.list_workspaces()
print(workspaces)
```

### Issue: "Permission denied writing to lakehouse"
**Solution**: Ensure notebook is attached to lakehouse with write permissions

## References

- [semantic-link on PyPI](https://pypi.org/project/semantic-link/)
- [semantic-link-labs on PyPI](https://pypi.org/project/semantic-link-labs/)
- [Fabric Python API Documentation](https://learn.microsoft.com/fabric/data-engineering/semantic-link)
- [SemPy Documentation](https://learn.microsoft.com/python/api/overview/fabric/semantic-link)

## TODO Phase 1

- [ ] Create production-ready extraction notebook
- [ ] Add comprehensive error handling
- [ ] Implement retry logic for API failures
- [ ] Add extraction progress tracking
- [ ] Create unit tests for extraction functions
- [ ] Document API rate limit handling
- [ ] Add example notebooks for common scenarios
