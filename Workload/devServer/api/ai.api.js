/**
 * Azure OpenAI API Router
 * 
 * Provides endpoints for AI-powered query explanation
 * Uses customer-hosted Azure OpenAI - all data stays in customer tenant
 */

const express = require('express');
const router = express.Router();
const { getAzureOpenAIService } = require('../services/AzureOpenAIService');

/**
 * POST /api/ai/explain-query
 * 
 * Explain a datasource query using Azure OpenAI
 * 
 * Request body:
 * {
 *   queryText: string,        // The query code to explain
 *   queryLanguage: string,    // Language: M, SQL, DAX, KQL
 *   context: {                // Optional context
 *     tableName?: string,
 *     columnName?: string,
 *     datasetName?: string
 *   },
 *   azureOpenAI?: {           // Optional Azure OpenAI config (overrides default)
 *     enabled: boolean,
 *     endpoint: string,
 *     apiKey: string,
 *     deploymentName: string,
 *     maxTokens?: number,
 *     temperature?: number
 *   }
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   explanation: string,      // AI-generated explanation
 *   error: string,           // Error message if failed
 *   metadata: {              // Usage metadata
 *     queryLanguage: string,
 *     tokensUsed: number,
 *     model: string,
 *     timestamp: string
 *   }
 * }
 */
router.post('/api/ai/explain-query', async (req, res) => {
  try {
    const { queryText, queryLanguage = 'M', context = {}, lineageContext, azureOpenAI = null } = req.body || {};

    const isLineageRequest = !!lineageContext && typeof lineageContext === 'object';

    if (!isLineageRequest && (!queryText || typeof queryText !== 'string')) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid queryText parameter',
        explanation: null
      });
    }

    console.log(isLineageRequest ? '[AI API] Lineage explanation requested via explain-query:' : '[AI API] Query explanation requested:', {
      queryLanguage,
      queryLength: typeof queryText === 'string' ? queryText.length : 0,
      hasContext: !!context,
      contextKeys: Object.keys(context),
      hasLineageContext: isLineageRequest,
      hasCustomConfig: !!azureOpenAI
    });

    // Create service instance with custom config if provided, otherwise use default
    const { AzureOpenAIService } = require('../services/AzureOpenAIService');
    const aiService = azureOpenAI 
      ? new AzureOpenAIService(azureOpenAI)
      : getAzureOpenAIService();

    const result = isLineageRequest
      ? await aiService.explainLineage(lineageContext)
      : await aiService.explainQuery(queryText, queryLanguage, context);

    if (!result.success) {
      console.warn(isLineageRequest ? '[AI API] Lineage explanation failed via explain-query:' : '[AI API] Explanation failed:', result.error);
      return res.status(result.error.includes('not configured') ? 503 : 500).json(result);
    }

    console.log(isLineageRequest ? '[AI API] Lineage explanation successful via explain-query:' : '[AI API] Explanation successful:', {
      explanationLength: result.explanation.length,
      tokensUsed: result.metadata?.tokensUsed
    });

    res.json(result);

  } catch (error) {
    console.error('[AI API] Exception in explain-query:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      explanation: null
    });
  }
});

/**
 * POST /api/ai/explain-lineage
 *
 * Explain lineage context using Azure OpenAI.
 *
 * Request body:
 * {
 *   lineageContext: object,  // Selected element, upstream/downstream nodes, edges and transformation evidence
 *   azureOpenAI?: object     // Optional runtime Azure OpenAI config override
 * }
 */
router.post('/api/ai/explain-lineage', async (req, res) => {
  try {
    const { lineageContext, azureOpenAI = null } = req.body || {};

    if (!lineageContext || typeof lineageContext !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid lineageContext parameter',
        explanation: null,
      });
    }

    console.log('[AI API] Lineage explanation requested:', {
      hasSelected: !!lineageContext.selected,
      upstreamCount: lineageContext?.counts?.upstream,
      downstreamCount: lineageContext?.counts?.downstream,
      hasCustomConfig: !!azureOpenAI,
    });

    const { AzureOpenAIService } = require('../services/AzureOpenAIService');
    const aiService = azureOpenAI
      ? new AzureOpenAIService(azureOpenAI)
      : getAzureOpenAIService();

    const result = await aiService.explainLineage(lineageContext);

    if (!result.success) {
      console.warn('[AI API] Lineage explanation failed:', result.error);
      return res.status(result.error.includes('not configured') ? 503 : 500).json(result);
    }

    console.log('[AI API] Lineage explanation successful:', {
      explanationLength: result.explanation.length,
      tokensUsed: result.metadata?.tokensUsed,
    });

    res.json(result);
  } catch (error) {
    console.error('[AI API] Exception in explain-lineage:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      explanation: null,
    });
  }
});

/**
 * GET /api/ai/status
 * 
 * Check if Azure OpenAI is configured and available
 * 
 * Response:
 * {
 *   configured: boolean,
 *   enabled: boolean,
 *   endpoint: string (masked),
 *   deploymentName: string
 * }
 */
router.get('/api/ai/status', (req, res) => {
  try {
    const aiService = getAzureOpenAIService();
    const config = aiService.config;
    const isOpenAICompatible = aiService.isOpenAICompatibleEndpoint();
    const isAzureAIFoundryProject = aiService.isAzureAIFoundry();

    // Mask sensitive information
    const maskedEndpoint = config.endpoint 
      ? config.endpoint.replace(/https:\/\/([^.]+)\./, 'https://***.')
      : '';

    // Only Azure AI Foundry Project format doesn't require deploymentName
    const deploymentDisplay = isAzureAIFoundryProject 
      ? (config.deploymentName || 'N/A (included in project)')
      : (config.deploymentName || 'Not configured');

    res.json({
      configured: aiService.isConfigured(),
      enabled: config.enabled,
      endpointType: aiService.getEndpointType(),
      endpoint: maskedEndpoint,
      deploymentName: deploymentDisplay,
      features: {
        queryExplanation: config.enabled
      }
    });

  } catch (error) {
    console.error('[AI API] Exception in status check:', error);
    res.status(500).json({
      configured: false,
      enabled: false,
      error: 'Failed to check AI service status'
    });
  }
});

/**
 * POST /api/ai/test-connection
 * 
 * Test the Azure OpenAI connection with a sample query
 * 
 * Response:
 * {
 *   success: boolean,
 *   message: string,
 *   error: string
 * }
 */
router.post('/api/ai/test-connection', async (req, res) => {
  try {
    const { azureOpenAI = null } = req.body || {};
    console.log('[AI API] Testing Azure OpenAI connection...');

    const { AzureOpenAIService } = require('../services/AzureOpenAIService');
    const aiService = azureOpenAI
      ? new AzureOpenAIService(azureOpenAI)
      : getAzureOpenAIService();
    const result = await aiService.testConnection();

    if (result.success) {
      console.log('[AI API] Connection test successful');
    } else {
      console.warn('[AI API] Connection test failed:', {
        error: result.error,
        diagnostics: result.diagnostics,
      });
    }

    res.json(result);

  } catch (error) {
    console.error('[AI API] Exception in test-connection:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: null
    });
  }
});

module.exports = { router };
