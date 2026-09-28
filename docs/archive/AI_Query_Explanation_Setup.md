# AI-Powered Query Explanation Setup Guide

## Overview

The Lineage Workbench supports AI-powered query explanations for partition datasources (M, SQL, DAX, and KQL queries). This feature uses **customer-hosted Azure OpenAI** to provide business-friendly explanations of technical queries, helping users understand how data is sourced and transformed.

## Architecture & Data Privacy

- **Your Azure OpenAI Endpoint**: All AI processing happens in your own Azure OpenAI resource
- **Your Data Stays Private**: Query text never leaves your Azure tenant
- **Your Control**: You manage costs, model versions, and access controls
- **No Third-Party Data Sharing**: No data is sent to external services

## Prerequisites

1. **Azure Subscription** with permissions to create Azure OpenAI resources
2. **Azure OpenAI Service** access (requires application approval from Microsoft)
3. **Basic PowerShell or Azure CLI knowledge** for setup commands

## Step 1: Create Azure OpenAI Resource

### Option A: Using Azure Portal

1. Navigate to [Azure Portal](https://portal.azure.com/)
2. Click **Create a resource** → Search for **Azure OpenAI**
3. Fill in the form:
   - **Subscription**: Select your subscription
   - **Resource group**: Create new or select existing
   - **Region**: Choose a region (e.g., East US, West Europe)
   - **Name**: Enter a unique name (e.g., `lineage-openai`)
   - **Pricing tier**: Select Standard S0
4. Click **Review + Create** → **Create**
5. Wait for deployment to complete (2-3 minutes)

### Option B: Using Azure CLI

```bash
# Login to Azure
az login

# Create resource group
az group create --name lineage-rg --location eastus

# Create Azure OpenAI resource
az cognitiveservices account create \
  --name lineage-openai \
  --resource-group lineage-rg \
  --kind OpenAI \
  --sku S0 \
  --location eastus \
  --yes
```

## Step 2: Deploy GPT Model

### Option A: Using Azure OpenAI Studio

1. Navigate to [Azure OpenAI Studio](https://oai.azure.com/)
2. Select your Azure OpenAI resource
3. Go to **Deployments** → **Create new deployment**
4. Fill in deployment form:
   - **Model**: Select **gpt-4o** (recommended) or **gpt-4-turbo**
   - **Deployment name**: Enter `query-explainer` (must match config file)
   - **Model version**: Latest available
   - **Deployment type**: Standard
   - **Tokens per minute rate limit**: 10K (can be adjusted based on usage)
5. Click **Create**

### Option B: Using Azure CLI

```bash
# Deploy GPT-4o model
az cognitiveservices account deployment create \
  --name lineage-openai \
  --resource-group lineage-rg \
  --deployment-name query-explainer \
  --model-name gpt-4o \
  --model-version "2024-08-06" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name "Standard"
```

## Step 3: Get Azure OpenAI Credentials

### Using Azure Portal

1. Navigate to your Azure OpenAI resource in the portal
2. Go to **Keys and Endpoint** (in the left sidebar under Resource Management)
3. Copy the following values:
   - **Endpoint**: `https://<your-resource-name>.openai.azure.com/`
   - **Key 1**: This is your API key (keep it secure!)

### Using Azure CLI

```bash
# Get endpoint
az cognitiveservices account show \
  --name lineage-openai \
  --resource-group lineage-rg \
  --query "properties.endpoint" \
  --output tsv

# Get API key
az cognitiveservices account keys list \
  --name lineage-openai \
  --resource-group lineage-rg \
  --query "key1" \
  --output tsv
```

## Step 4: Configure Lineage Workbench

1. Open `Workload/devServer/config/azureOpenAI.config.json`
2. Update the configuration:

```json
{
  "azureOpenAI": {
    "enabled": true,
    "endpoint": "https://<your-resource-name>.openai.azure.com/",
    "apiKey": "<your-api-key-from-step-3>",
    "deploymentName": "query-explainer",
    "apiVersion": "2024-08-01-preview",
    "maxTokens": 1000,
    "temperature": 0.3,
    "timeout": 30000
  },
  "features": {
    "queryExplanation": {
      "enabled": true,
      "supportedLanguages": ["M", "SQL", "DAX", "KQL"]
    }
  }
}
```

3. Save the file

## Step 5: Secure Your Credentials (Production)

### Recommended: Use Azure Key Vault

For production environments, **never hardcode API keys**. Use Azure Key Vault:

1. **Create Key Vault**:
```bash
az keyvault create \
  --name lineage-keyvault \
  --resource-group lineage-rg \
  --location eastus
```

2. **Store API key in Key Vault**:
```bash
az keyvault secret set \
  --vault-name lineage-keyvault \
  --name "AzureOpenAI-ApiKey" \
  --value "<your-api-key>"
```

3. **Update your application** to read from Key Vault instead of config file:
```javascript
// Example: In AzureOpenAIService.js
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const credential = new DefaultAzureCredential();
const client = new SecretClient("https://lineage-keyvault.vault.azure.net/", credential);
const secret = await client.getSecret("AzureOpenAI-ApiKey");
const apiKey = secret.value;
```

### Additional Security Best Practices

- **Network Isolation**: Configure Azure OpenAI to accept requests only from your application's IP or VNet
- **Managed Identity**: Use Azure Managed Identity instead of API keys when deploying to Azure
- **Private Endpoints**: Use Private Endpoints for Azure OpenAI to keep traffic within Azure backbone
- **Key Rotation**: Regularly rotate API keys (Azure OpenAI provides 2 keys for zero-downtime rotation)

## Step 6: Test the Connection

1. Start the development server:
```powershell
cd Workload
npm run dev
```

2. Test the connection using the API:
```bash
# Windows PowerShell
Invoke-RestMethod -Uri "http://localhost:8080/api/ai/test-connection" -Method POST

# Linux/Mac
curl -X POST http://localhost:8080/api/ai/test-connection
```

Expected response:
```json
{
  "success": true,
  "message": "Azure OpenAI connection successful"
}
```

## Usage

1. Open the Lineage Workbench in Microsoft Fabric
2. Select a table or column with partition information
3. Expand the **Partitions** accordion section
4. For each partition with a query, click the **Explain** button (with sparkle icon ✨)
5. A dialog will appear with:
   - **Loading state**: Shows spinner while generating explanation
   - **Explanation**: Business-friendly explanation of the query
   - **Original query**: The technical query for reference

## Cost Estimation

Azure OpenAI pricing (as of January 2025):

### GPT-4o (Recommended)
- **Input**: $2.50 per 1M tokens (~$0.0025 per 1K tokens)
- **Output**: $10.00 per 1M tokens (~$0.01 per 1K tokens)

### Typical Query Explanation Costs
- Average query: ~500 input tokens + ~400 output tokens
- **Cost per explanation**: ~$0.0016 (less than 0.2 cents)
- **1,000 explanations**: ~$1.60
- **10,000 explanations per month**: ~$16

### Cost Control Recommendations
1. **Set rate limits**: Configure token-per-minute limits in Azure OpenAI deployment
2. **Monitor usage**: Use Azure Cost Management to track spending
3. **Budget alerts**: Set up budget alerts in Azure Portal
4. **Disable when not needed**: Set `enabled: false` in config during development/testing

## Troubleshooting

### Issue: "Azure OpenAI service is not configured"

**Solution**: Verify the configuration file:
- Check `enabled: true` in config
- Verify endpoint format: `https://<resource-name>.openai.azure.com/`
- Ensure no trailing slashes in endpoint
- Confirm API key is correct (64 characters)

### Issue: "Rate limit exceeded"

**Solution**: 
- Increase tokens-per-minute limit in Azure OpenAI deployment
- Add retry logic with exponential backoff
- Adjust `timeout` value in config (default: 30000ms)

### Issue: "Connection timeout"

**Solution**:
- Check network connectivity to Azure
- Verify firewall rules allow outbound HTTPS (443) traffic
- Increase `timeout` in config (e.g., 60000 for 60 seconds)
- Check Azure OpenAI resource status in Azure Portal

### Issue: "Deployment not found"

**Solution**:
- Verify `deploymentName` in config matches Azure OpenAI Studio
- Check deployment status (must be "Succeeded" state)
- Ensure model deployment is not paused or deleted

### Issue: "Authentication failed"

**Solution**:
- Regenerate API keys in Azure Portal → Azure OpenAI → Keys and Endpoint
- Update `apiKey` in config file
- Verify no extra spaces or line breaks in API key
- Check API key hasn't been rotated or revoked

## API Reference

### POST /api/ai/explain-query

**Request**:
```json
{
  "queryText": "let Source = Sql.Database(\"server\", \"db\") in Source",
  "queryLanguage": "M",
  "context": {
    "tableName": "Sales",
    "datasetName": "Sales Analysis",
    "partitionName": "Current Month"
  }
}
```

**Response**:
```json
{
  "success": true,
  "explanation": "This query connects to a SQL Server database...",
  "metadata": {
    "queryLanguage": "M",
    "tokensUsed": 450,
    "model": "gpt-4o",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

### GET /api/ai/status

**Response**:
```json
{
  "configured": true,
  "enabled": true,
  "endpoint": "https://***.openai.azure.com/",
  "deploymentName": "query-explainer",
  "features": {
    "queryExplanation": true
  }
}
```

### POST /api/ai/test-connection

**Response**:
```json
{
  "success": true,
  "message": "Azure OpenAI connection successful"
}
```

## Support & Resources

- **Azure OpenAI Documentation**: https://learn.microsoft.com/azure/ai-services/openai/
- **Pricing Calculator**: https://azure.microsoft.com/pricing/calculator/
- **Azure OpenAI Studio**: https://oai.azure.com/
- **Azure Portal**: https://portal.azure.com/

## FAQ

**Q: Can I use GPT-3.5 instead of GPT-4?**  
A: Yes, but GPT-4o provides significantly better explanations for technical queries. Update `model-name` to `gpt-35-turbo` in deployment.

**Q: Do I need to pay for Azure OpenAI separately?**  
A: Yes, Azure OpenAI is billed separately based on token usage. See cost estimation section above.

**Q: Can multiple users share the same Azure OpenAI resource?**  
A: Yes, Azure OpenAI supports multiple concurrent requests. Set appropriate rate limits to avoid throttling.

**Q: What happens if Azure OpenAI is down?**  
A: The Explain button will show an error message. The rest of the Lineage Workbench continues to function normally.

**Q: Can I customize the explanation prompts?**  
A: Yes, modify `buildSystemPrompt()` and `buildUserPrompt()` methods in `AzureOpenAIService.js`.

**Q: Is this feature required for the workload to function?**  
A: No, this is an optional enhancement. Set `enabled: false` to disable the feature completely.

---

**Last Updated**: 2025-01-15  
**Version**: 1.0  
**Maintainer**: Fabric Lineage Manager Team
