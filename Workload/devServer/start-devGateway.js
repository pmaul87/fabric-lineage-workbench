const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

// Update path to point to scripts from project root
const startDevGatewayScript = path.resolve(__dirname, "../../scripts/Run/StartDevGateway.ps1");

/**
 * Starts the Dev Gateway using the PowerShell script
 * @param {boolean} interactiveLogin - Whether to use interactive login (default: true)
 * @returns {Promise<void>}
 */
async function startDevGateway(interactiveLogin = true) {
  try {
    console.log("🚀 Starting Fabric Dev Gateway...");

    const powershellExecutable = os.platform() === "win32" ? "pwsh" : "pwsh";
    const powershellArgs = ["-File", startDevGatewayScript];
    if (!interactiveLogin) {
      powershellArgs.push("-InteractiveLogin:$false");
    }

    console.log(`🔧 Executing: ${powershellExecutable} ${powershellArgs.join(" ")}`);

    // Keep this as a long-running child process
    const childProcess = spawn(powershellExecutable, powershellArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: false,
      shell: false,
    });
    
    // Pipe the output to console in real-time
    childProcess.stdout.on('data', (data) => {
      process.stdout.write(data);
    });
    
    childProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });
    
    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log("✅ Dev Gateway process completed successfully.");
      } else {
        console.error(`❌ Dev Gateway process exited with code ${code}`);
        process.exit(code);
      }
    });
    
    childProcess.on('error', (error) => {
      console.error(`❌ Error starting Dev Gateway: ${error.message}`);
      process.exit(1);
    });
    
    // Handle process termination gracefully
    process.on('SIGINT', () => {
      console.log("\n🛑 Received SIGINT, terminating Dev Gateway...");
      childProcess.kill('SIGINT');
    });
    
    process.on('SIGTERM', () => {
      console.log("\n🛑 Received SIGTERM, terminating Dev Gateway...");
      childProcess.kill('SIGTERM');
    });
    
  } catch (error) {
    console.error(`❌ Error starting Dev Gateway: ${error.message}`);
    process.exit(1);
  }
}

// Export the function for use in other modules
module.exports = {
  startDevGateway
};

// Execute when run directly
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const interactiveLogin = !args.includes('--no-interactive');
  
  startDevGateway(interactiveLogin);
}