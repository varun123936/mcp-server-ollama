# MCP Server (Streamable HTTP)

This MCP server exposes the blog API through two practical paths:

1. An AI chatbot flow using POST /ai-chatbot
2. An MCP client flow using POST /mcp

The server runs on port 5001 by default and forwards real actions to the main REST API on port 3002.

## Setup

1. Start the main REST API first:
   ```bash
   cd ..
   export MONGO_URI="mongodb://localhost:27017/mcp-api"
   npm start
   ```

2. Start the MCP server:
   ```bash
   npm install
   npm start
   ```

## Configuration

- API_BASE_URL: base URL of the main API (default: http://localhost:3002)
- MCP_PORT: port for this MCP server (default: 5001)
- OLLAMA_MODEL: Ollama model to use (default: gemma2)
- OLLAMA_HOST: Ollama host (default: http://localhost:11434)

## Endpoints

- POST /mcp: MCP Streamable HTTP endpoint for MCP clients
- POST /ai-chatbot: direct AI chatbot endpoint for natural language actions
- GET /health: health check
- GET /mcp: returns 405 Method Not Allowed

## Available tools

The MCP server exposes these tools:

- create_post
- list_posts
- get_post
- update_post
- delete_post
- add_comment
- list_comments
- ai_chatbot_agent

All tools validate input and forward the request to the main REST API.

## Flow 1: AI chatbot

1. A client sends a message to POST /ai-chatbot.
2. The server sends the message to Ollama.
3. Ollama returns an action plan.
4. The server executes that action against the main REST API.
5. The result is returned as a structured response.

## Flow 2: MCP client

1. An MCP client sends a JSON-RPC request to POST /mcp.
2. The server handles initialization and tool calls.
3. The requested tool calls the main REST API.
4. The REST API performs the real database action.
5. The tool result is returned to the client.
