/**
 * DevServer APIs index file
 * Exports manifest API, metadata API, and dev server components registration
 */

const manifestApi = require('./manifestApi');
const { router: metadataRouter, initializeMetadataApi } = require('./api/metadata.api');
const { router: semanticRouter, initializeSemanticApi } = require('./api/semantic.api');
const { router: lakehouseRouter, initializeLakehouseApi } = require('./api/lakehouse.api');
const { router: aiRouter } = require('./api/ai.api');

/**
 * Register dev server manifest APIs with an Express application
 * @param {object} app Express application
 * @param {object} fabricPlatformApiClient Optional Fabric Platform API client for metadata service
 */
function registerDevServerApis(app, fabricPlatformApiClient) {
  console.log('*** Mounting Manifest API ***');
  app.use('/', manifestApi);

  console.log('*** Mounting Metadata API ***');
  app.use('/', metadataRouter);

  console.log('*** Mounting Semantic API ***');
  app.use('/', semanticRouter);

  console.log('*** Mounting Lakehouse Analyzer API ***');
  app.use('/', lakehouseRouter);

  console.log('*** Mounting AI Query Explanation API ***');
  app.use('/', aiRouter);

  initializeMetadataApi(fabricPlatformApiClient);
  initializeSemanticApi(fabricPlatformApiClient);
  initializeLakehouseApi(fabricPlatformApiClient);
  
  const hasServicePrincipalConfig =
    !!process.env.TENANT_ID &&
    !!process.env.BACKEND_APPID &&
    !!process.env.BACKEND_CLIENT_SECRET;

  if (hasServicePrincipalConfig) {
    console.log('✅ Metadata API initialized with service principal credentials');
  } else {
    console.log('ℹ️  Metadata API initialized in fallback mode (set TENANT_ID, BACKEND_APPID, BACKEND_CLIENT_SECRET for live Fabric data)');
  }

  // SQL database persistence is intentionally disabled in zero-egress mode.
  // Report scanner operates without SQL storage.
  console.log('ℹ️  SQL report-scanner persistence is disabled in zero-egress mode.');
}

function registerDevServerComponents() {
  console.log("*********************************************************************");
  console.log('***                Mounting Dev Server Components                ***');

  // Log playground availability
  console.log('\x1b[32m🎮 Following playgrounds are enabled in development mode:\x1b[0m'); // Green
  const workloadName = process.env.WORKLOAD_NAME || 'unknown-workload';
  console.log(`\x1b[32m🌐 Client-SDK Playground:\x1b[0m \x1b[34mhttps://app.fabric.microsoft.com/workloads/${workloadName}/playground-client-sdk\x1b[0m`); // Blue
  console.log(`\x1b[32m🌐 Data Playground:\x1b[0m \x1b[34mhttps://app.fabric.microsoft.com/workloads/${workloadName}/playground-data\x1b[0m`); // Blue
  console.log("*********************************************************************");
}

module.exports = {
  manifestApi,
  metadataRouter,
  initializeMetadataApi,
  semanticRouter,
  initializeSemanticApi,
  lakehouseRouter,
  initializeLakehouseApi,
  registerDevServerApis,
  registerDevServerComponents
};
