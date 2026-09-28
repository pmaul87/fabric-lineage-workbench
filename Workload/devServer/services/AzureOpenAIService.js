/**
 * Azure OpenAI Service for Query Explanation
 * 
 * This service provides AI-powered explanations for datasource queries (M, SQL, DAX, KQL).
 * Uses customer-hosted Azure OpenAI endpoint - all data stays within customer's tenant.
 * 
 * @module AzureOpenAIService
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  enabled: false,
  endpoint: '',
  apiKey: '',
  deploymentName: '',
  apiVersion: '2024-08-01-preview',
  maxTokens: 500,
  temperature: 0.3,
  timeout: 30000,
};

class AzureOpenAIService {
  constructor(customConfig = null) {
    this.config = this.normalizeConfig(customConfig || this.loadConfig());
  }

  normalizeConfig(config) {
    return {
      ...DEFAULT_CONFIG,
      ...(config || {}),
      endpoint: String(config?.endpoint ?? DEFAULT_CONFIG.endpoint).trim(),
      apiKey: String(config?.apiKey ?? DEFAULT_CONFIG.apiKey).trim(),
      deploymentName: String(config?.deploymentName ?? DEFAULT_CONFIG.deploymentName).trim(),
      apiVersion: String(config?.apiVersion ?? DEFAULT_CONFIG.apiVersion).trim(),
      maxTokens: Number.isFinite(Number(config?.maxTokens)) ? Number(config.maxTokens) : DEFAULT_CONFIG.maxTokens,
      temperature: Number.isFinite(Number(config?.temperature)) ? Number(config.temperature) : DEFAULT_CONFIG.temperature,
      timeout: Number.isFinite(Number(config?.timeout)) && Number(config.timeout) > 0
        ? Number(config.timeout)
        : DEFAULT_CONFIG.timeout,
    };
  }

  /**
   * Load Azure OpenAI configuration from config file (fallback)
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, '../config/azureOpenAI.config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Replace environment variable placeholders
      if (config.azureOpenAI && config.azureOpenAI.apiKey && config.azureOpenAI.apiKey.startsWith('${') && config.azureOpenAI.apiKey.endsWith('}')) {
        const envVarName = config.azureOpenAI.apiKey.slice(2, -1);
        config.azureOpenAI.apiKey = process.env[envVarName] || '';
      }
      
      return config.azureOpenAI;
    } catch (error) {
      console.error('[AzureOpenAI] Failed to load config:', error.message);
      return { ...DEFAULT_CONFIG };
    }
  }

  /**
   * Check if Azure OpenAI is configured and enabled
   */
  isConfigured() {
    const isAzureAIFoundryProject = this.isAzureAIFoundry();
    
    // OpenAI-Compatible requires deploymentName (used as "model" in request body)
    // Azure AI Foundry Project doesn't require deploymentName (model is in project config)
    // Classic Azure OpenAI requires deploymentName (used in URL path)
    const requiresDeploymentName = !isAzureAIFoundryProject;
    
    return this.config.enabled && 
           this.config.endpoint && 
           this.config.apiKey && 
           (!requiresDeploymentName || this.config.deploymentName);
  }

  getConfigurationDiagnostics() {
    const endpoint = String(this.config?.endpoint || '').trim();
    const apiKey = String(this.config?.apiKey || '').trim();
    const deploymentName = String(this.config?.deploymentName || '').trim();
    const endpointType = this.getEndpointType();
    const isAzureAIFoundryProject = this.isAzureAIFoundry();
    const requiresDeploymentName = !isAzureAIFoundryProject;
    const issues = [];

    if (!this.config?.enabled) {
      issues.push('Azure OpenAI is disabled.');
    }

    if (!endpoint) {
      issues.push('Endpoint is missing.');
    }

    if (!apiKey) {
      issues.push('API key is missing.');
    }

    if (requiresDeploymentName && !deploymentName) {
      issues.push(`Deployment name is required for ${endpointType} endpoints.`);
    }

    return {
      configured: issues.length === 0,
      endpointType,
      requiresDeploymentName,
      hasEndpoint: !!endpoint,
      hasApiKey: !!apiKey,
      hasDeploymentName: !!deploymentName,
      issues,
    };
  }

  /**
   * Detect if the endpoint uses OpenAI-compatible format (/openai/v1)
   */
  isOpenAICompatibleEndpoint() {
    return this.config.endpoint?.includes('/openai/v1');
  }

  /**
   * Detect if the endpoint is Azure AI Foundry project format
   */
  isAzureAIFoundry() {
    return this.config.endpoint?.includes('services.ai.azure.com/api/projects/');
  }

  /**
   * Get the endpoint type as a human-readable string
   */
  getEndpointType() {
    if (this.isOpenAICompatibleEndpoint()) {
      return 'OpenAI-Compatible (Azure AI Foundry)';
    } else if (this.isAzureAIFoundry()) {
      return 'Azure AI Foundry (Project)';
    } else {
      return 'Azure OpenAI Service';
    }
  }

  /**
   * Build the API URL based on endpoint type
   */
  buildApiUrl() {
    if (this.isOpenAICompatibleEndpoint()) {
      // OpenAI-compatible format: {endpoint}/chat/completions
      // Endpoint already includes /openai/v1, just append /chat/completions
      return `${this.config.endpoint}/chat/completions`;
    } else if (this.isAzureAIFoundry()) {
      // Azure AI Foundry project format: {endpoint}/chat/completions
      // API version and deployment are not needed in URL
      return `${this.config.endpoint}/chat/completions`;
    } else {
      // Classic Azure OpenAI format: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
      const apiVersionParam = this.config.apiVersion ? `?api-version=${this.config.apiVersion}` : '';
      return `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/chat/completions${apiVersionParam}`;
    }
  }

  /**
   * Build the system prompt for query explanation
   */
  buildSystemPrompt() {
    return `You are an expert data engineer helping business users understand datasource queries. 
Your goal is to explain technical queries in simple, non-technical language.

Guidelines:
1. Be concise - provide 1-2 short paragraphs maximum
2. Focus on WHAT data is being retrieved, not HOW the code works
3. When explaining column-level queries, specifically explain how that column is populated/calculated
4. Use business-friendly language, avoid technical jargon
5. Mention data sources, transformations, and filters in plain terms
6. If a column is mentioned, focus on what values it contains and where they come from

Format your response in clear, short paragraphs without markdown formatting.`;
  }

  /**
   * Build the user prompt with query context
   */
  buildUserPrompt(queryText, queryLanguage, context) {
    let prompt = `Explain the following ${queryLanguage} query in 1-2 short paragraphs:\n\n${queryText}\n\n`;
    
    if (context) {
      prompt += 'Context: ';
      if (context.tableName) {
        prompt += `This query is used for the table "${context.tableName}"`;
      }
      if (context.columnName) {
        prompt += ` in column "${context.columnName}"`;
      }
      if (context.datasetName) {
        prompt += ` within the semantic model "${context.datasetName}"`;
      }
      prompt += '.\n\n';
      
      // Add column-specific instruction
      if (context.columnName) {
        prompt += `Important: Explain specifically how the column "${context.columnName}" is populated by this query. What values does it contain and where do they come from?\n\n`;
      }
    }
    
    prompt += 'Provide a clear, concise, business-friendly explanation.';
    return prompt;
  }

  /**
   * Build the system prompt for lineage explanation.
   */
  buildLineageSystemPrompt() {
    return `You are an expert lineage analyst.
Your job is to summarize lineage facts provided by the caller.

Rules:
1. Use only facts present in the provided JSON context.
2. Do not invent sources, targets, or transformations.
3. If a detail is missing, explicitly say it is not available in the captured lineage.
4. Keep it concise and accurate.
5. Focus on selected element, upstream producers, downstream consumers, and key transformations.

Output format:
- 1 short paragraph: what the selected element is and where it sits in the flow.
- 1 short paragraph: upstream and downstream highlights (group similar elements).
- 1 short paragraph: transformations and edge evidence found.

No markdown tables. Plain text only.`;
  }

  /**
   * Build lineage explanation prompt from context payload.
   */
  buildLineageUserPrompt(lineageContext) {
    const contextJson = JSON.stringify(lineageContext, null, 2);
    return `Explain this lineage context in concise, factual language:\n\n${contextJson}\n\nReturn a compact summary that is true to the provided context.`;
  }

  /**
   * Call Azure OpenAI API to explain a query
   * 
   * @param {string} queryText - The query code to explain
   * @param {string} queryLanguage - Language of the query (M, SQL, DAX, KQL)
   * @param {Object} context - Additional context (tableName, columnName, datasetName)
   * @returns {Promise<Object>} Explanation result with text and metadata
   */
  async explainQuery(queryText, queryLanguage = 'M', context = {}) {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Azure OpenAI is not configured. Please configure your Azure OpenAI endpoint in the settings.',
        explanation: null
      };
    }

    if (!queryText || queryText.trim().length === 0) {
      return {
        success: false,
        error: 'Query text is empty',
        explanation: null
      };
    }

    try {
      const url = this.buildApiUrl();
      const isOpenAICompatible = this.isOpenAICompatibleEndpoint();
      const isAzureAIFoundry = this.isAzureAIFoundry();
      
      const requestBody = {
        messages: [
          {
            role: 'system',
            content: this.buildSystemPrompt()
          },
          {
            role: 'user',
            content: this.buildUserPrompt(queryText, queryLanguage, context)
          }
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        top_p: 0.95,
        frequency_penalty: 0,
        presence_penalty: 0
      };

      // For OpenAI-compatible and Azure AI Foundry endpoints, include model in request body
      if (isOpenAICompatible || isAzureAIFoundry) {
        if (this.config.deploymentName) {
          requestBody.model = this.config.deploymentName;
        }
      }

      console.log('[AzureOpenAI] Requesting explanation:', {
        endpointType: this.getEndpointType(),
        url: url,
        deployment: this.config.deploymentName || 'N/A',
        includesModelInBody: isOpenAICompatible || isAzureAIFoundry,
        queryLanguage,
        queryLength: queryText.length,
        context
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AzureOpenAI] API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        
        return {
          success: false,
          error: `Azure OpenAI API error: ${response.status} ${response.statusText}`,
          explanation: null
        };
      }

      const data = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        return {
          success: false,
          error: 'No response from Azure OpenAI',
          explanation: null
        };
      }

      const explanation = data.choices[0].message.content;
      const usage = data.usage;

      console.log('[AzureOpenAI] Explanation generated:', {
        explanationLength: explanation.length,
        tokensUsed: usage?.total_tokens,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens
      });

      return {
        success: true,
        error: null,
        explanation,
        metadata: {
          queryLanguage,
          tokensUsed: usage?.total_tokens,
          model: data.model,
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('[AzureOpenAI] Exception:', error);
      
      if (error.name === 'AbortError') {
        return {
          success: false,
            error: `Request timeout after ${this.config.timeout} ms - Azure OpenAI did not respond in time`,
          explanation: null
        };
      }

      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        explanation: null
      };
    }
  }

  /**
   * Explain lineage graph context.
   *
   * @param {Object} lineageContext - Selected node and relationship evidence
   * @returns {Promise<Object>} Explanation result with text and metadata
   */
  async explainLineage(lineageContext = {}) {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'Azure OpenAI is not configured. Please configure your Azure OpenAI endpoint in the settings.',
        explanation: null,
      };
    }

    if (!lineageContext || typeof lineageContext !== 'object') {
      return {
        success: false,
        error: 'Lineage context is missing or invalid',
        explanation: null,
      };
    }

    try {
      const url = this.buildApiUrl();
      const isOpenAICompatible = this.isOpenAICompatibleEndpoint();
      const isAzureAIFoundry = this.isAzureAIFoundry();

      const requestBody = {
        messages: [
          {
            role: 'system',
            content: this.buildLineageSystemPrompt(),
          },
          {
            role: 'user',
            content: this.buildLineageUserPrompt(lineageContext),
          },
        ],
        max_tokens: this.config.maxTokens,
        temperature: Math.min(this.config.temperature, 0.2),
        top_p: 0.95,
        frequency_penalty: 0,
        presence_penalty: 0,
      };

      if (isOpenAICompatible || isAzureAIFoundry) {
        if (this.config.deploymentName) {
          requestBody.model = this.config.deploymentName;
        }
      }

      console.log('[AzureOpenAI] Requesting lineage explanation:', {
        endpointType: this.getEndpointType(),
        url,
        deployment: this.config.deploymentName || 'N/A',
        includesModelInBody: isOpenAICompatible || isAzureAIFoundry,
        hasSelectedNode: !!lineageContext?.selected,
        upstreamCount: lineageContext?.counts?.upstream,
        downstreamCount: lineageContext?.counts?.downstream,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AzureOpenAI] API error in lineage explanation:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });

        return {
          success: false,
          error: `Azure OpenAI API error: ${response.status} ${response.statusText}`,
          explanation: null,
        };
      }

      const data = await response.json();
      if (!data.choices || data.choices.length === 0) {
        return {
          success: false,
          error: 'No response from Azure OpenAI',
          explanation: null,
        };
      }

      const explanation = data.choices[0].message.content;
      const usage = data.usage;

      return {
        success: true,
        error: null,
        explanation,
        metadata: {
          queryLanguage: 'LINEAGE',
          tokensUsed: usage?.total_tokens,
          model: data.model,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error('[AzureOpenAI] Exception in explainLineage:', error);

      if (error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timeout after ${this.config.timeout} ms - Azure OpenAI did not respond in time`,
          explanation: null,
        };
      }

      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        explanation: null,
      };
    }
  }

  /**
   * Test the Azure OpenAI connection
   * 
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection() {
    const diagnostics = this.getConfigurationDiagnostics();
    if (!diagnostics.configured) {
      return {
        success: false,
        error: `Azure OpenAI is not configured: ${diagnostics.issues.join(' ')}`,
        diagnostics,
      };
    }

    try {
      const result = await this.explainQuery(
        'SELECT TOP 10 * FROM Customers WHERE Country = \'USA\'',
        'SQL',
        { tableName: 'Customers' }
      );

      return {
        success: result.success,
        error: result.error,
        message: result.success ? `Azure OpenAI connection successful (${diagnostics.endpointType})` : result.error,
        diagnostics,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        diagnostics,
      };
    }
  }
}

// Singleton instance
let instance = null;

function getAzureOpenAIService() {
  if (!instance) {
    instance = new AzureOpenAIService();
  }
  return instance;
}

module.exports = {
  getAzureOpenAIService,
  AzureOpenAIService
};
