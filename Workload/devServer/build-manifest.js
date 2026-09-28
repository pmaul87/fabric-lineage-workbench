const fs = require("fs").promises;
const { execFile } = require("child_process");
const util = require("util");
const os = require("os");
const path = require("path");

const execFileAsync = util.promisify(execFile);

// Update path to point to scripts from project root
const buildManifestPackageScript = path.resolve(__dirname, "../../scripts/Build/BuildManifestPackage.ps1");

/**
 * Builds the manifest package using the PowerShell script
 * @returns {Promise<void>}
 */
async function buildManifestPackage() {
  try {
    // Run the PowerShell script to build the package manifest
    const powershellExecutable = os.platform() === "win32" ? "pwsh" : "pwsh";
    const { stdout, stderr } = await execFileAsync(
      powershellExecutable,
      ["-File", buildManifestPackageScript],
      { windowsHide: true }
    );
    if (stderr) {
        console.error(`⚠️ BuildManifestPackage error: ${stderr}`);
    } else {
        console.log(`✅ BuildManifestPackage completed successfully.`);
        console.log(`📦BuildManifestPackage: ${stdout}`);
    }
  }
  catch (error) {
    console.error(`❌ Error building the Package Manifest: ${error.message}`);
  }
}

// Export the function for use in other modules
module.exports = {
  buildManifestPackage
};

// Optional: Execute when run directly
if (require.main === module) {
  buildManifestPackage();
}