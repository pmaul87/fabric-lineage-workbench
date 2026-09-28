# Fabric UX MCP Server - Quick Start

## 🚀 Quick Setup (5 minutes)

### Prerequisites Check
- ✅ Docker installed? Run: `docker --version`
- ✅ Node.js installed? Run: `node --version` (v18+)

### Step-by-Step

1. **Clone the MCP server** (one-time setup):
   ```powershell
   cd C:\Users\$env:USERNAME
   mkdir mcp-servers
   cd mcp-servers
   git clone https://github.com/Falkicon/mcp-fabric-ux-system.git
   cd mcp-fabric-ux-system
   npm install
   ```

2. **Start ChromaDB** (do this each time you restart your computer):
   ```powershell
   # First time: create data directory
   mkdir C:\Users\$env:USERNAME\chroma-data
   
   # Pull image (first time only)
   docker pull chromadb/chroma
   
   # Run ChromaDB
   docker run -d -p 8000:8000 -v C:\Users\$env:USERNAME\chroma-data:/chroma/chroma --name chroma_server chromadb/chroma
   ```

3. **Index documentation** (first time only, or after updates):
   ```powershell
   npm run index-docs
   ```

4. **Build the server** (first time only):
   ```powershell
   npm run build
   ```

5. **Configure your client**:

   **VS Code with GitHub Copilot**

   Run `MCP: Add Server` from the Command Palette, choose `Command (stdio)`, then enter:

   - Command: `node`
   - Arguments: `C:\Users\<YourUsername>\mcp-servers\mcp-fabric-ux-system\dist\src\index.js --stdio`
   - Server ID: `mcp_fabricux`

   Or add this to `.vscode/mcp.json`:

   ```json
   {
     "servers": {
       "mcp_fabricux": {
         "type": "stdio",
          "command": "node",
         "args": [
            "C:\\Users\\<YourUsername>\\mcp-servers\\mcp-fabric-ux-system\\dist\\src\\index.js",
            "--stdio"
          ],
          "env": {
            "MCP_LOG_LEVEL": "warn"
          }
       }
     }
   }
   ```

   This avoids npm banner output being interpreted as MCP protocol messages and reduces startup noise.

   **GitHub Copilot CLI**

   Start `copilot`, run `/mcp add`, and use:

   - Name: `mcp_fabricux`
   - Type: `stdio`
   - Command: `npm`
   - Arguments: `run start:stdio --prefix C:\Users\<YourUsername>\mcp-servers\mcp-fabric-ux-system`
   - Tools: `*`

   **Cursor**

   Edit `C:\Users\<YourUsername>\.cursor\mcp.json` and add:

   ```json
   {
     "mcpServers": {
       "mcp_fabricux": {
         "displayName": "Fabric UX System",
         "command": "npm",
         "args": [
           "run",
           "start:stdio",
           "--prefix",
           "C:\\Users\\<YourUsername>\\mcp-servers\\mcp-fabric-ux-system"
         ],
         "cwd": "C:\\Users\\<YourUsername>\\mcp-servers\\mcp-fabric-ux-system",
         "env": {
           "NODE_ENV": "production"
         },
         "enabled": true
       }
     }
   }
   ```

6. **Restart VS Code, Cursor, or Copilot CLI** ♻️

## 💬 How to Use

Just ask Copilot questions about Fabric UX! Examples:

- "What's the recommended pattern for toolbar buttons in Fabric UX?"
- "Show me how to use Tooltip with ToolbarButton"
- "What are the Fabric UX accessibility requirements for buttons?"
- "How do I implement a ribbon in Fabric UX?"

## 🔧 Daily Usage

### Starting Your Day
```powershell
# Check if ChromaDB is running
docker ps

# If not running, start it
docker start chroma_server
```

### Stopping for the Day
```powershell
# Optional: stop ChromaDB to free resources
docker stop chroma_server
```

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| MCP not showing in Copilot | 1. Verify ChromaDB is running: `docker ps`<br>2. Restart the client you configured<br>3. Check the correct config file for your client: `.vscode/mcp.json`, `~/.copilot/mcp-config.json`, or `.cursor\mcp.json` |
| "Cannot connect to ChromaDB" | Run: `docker start chroma_server` |
| Slow first response | Normal - models are loading |
| Indexing fails | Ensure ChromaDB is running first |

## 📚 Full Documentation

See [MCP_Setup.md](../docs/MCP_Setup.md) for complete details.

## ✨ Benefits for This Project

When working on the Fabric Extensibility Toolkit:

✅ Get instant Fabric UX component guidance  
✅ Follow official design patterns  
✅ Ensure accessibility compliance  
✅ Use correct Fluent UI v9 components  
✅ Implement proper toolbar patterns  

**The MCP server acts as your Fabric UX expert assistant!**
