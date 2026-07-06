# MCP Server Ollama

This repository contains a small blog-style application with two working flows:

1. An AI chatbot flow where natural language requests are translated into real actions against the posts and comments API.
2. An MCP flow where an MCP client calls the MCP endpoint and performs real actions through exposed tools.

The project is split into two services:

- Main REST API server: server.js
- MCP server with Ollama integration: mcp-server/server.js

## What the app does

The main API stores and manages posts and comments in MongoDB.

- Posts contain: title, author, category, body, createdAt
- Comments belong to a post and contain: postId, text, commenter, createdAt

The MCP server adds two higher-level interaction paths on top of that REST API.

---
## Architecture

### Flow 1: AI chatbot -> REST API -> MongoDB

This flow is used when a user talks to the chatbot interface or sends a request to the AI endpoint.

1. A user sends a message such as “Create a new post...” to the chatbot UI or to the AI endpoint.
2. The MCP server sends the message to Ollama.
3. Ollama returns an action plan such as create_post, list_posts, add_comment, and so on.
4. The MCP server executes that action by calling the main REST API.
5. The REST API updates MongoDB and returns the result.

This path is used by:
- the chatbot page at public/chatbot.html
- the endpoint POST /ai-chatbot on the MCP server

### Flow 2: MCP client -> /mcp -> tools -> REST API -> MongoDB

This flow is used when an MCP client connects to the MCP server.

1. The MCP client sends a JSON-RPC request to POST /mcp.
2. The MCP server handles initialization and tool calls.
3. The server invokes registered tools such as create_post, list_posts, update_post, delete_post, add_comment, and list_comments.
4. Each tool calls the main REST API.
5. The REST API performs the action in MongoDB.

This is the path used by MCP-compatible clients.

---
## Project structure

- server.js: Main REST API for posts and comments
- public/: Web UI for the blog and chatbot experience
- public/chatbot.html: AI chatbot UI
- mcp-server/server.js: MCP server with AI and tool support
- mcp-server/README.md: MCP-specific details

---
## Setup

### 1. Install dependencies

From the project root:

```bash
npm install
```

Then install the MCP server dependencies:

```bash
cd mcp-server
npm install
```

### 2. Configure MongoDB

Set the MongoDB connection string for the main API:

```bash
export MONGO_URI="mongodb://localhost:27017/mcp-api"
```

### 3. Install Ollama

Make sure Ollama is running locally and that the model is available.

```bash
ollama pull gemma2
```

---
## Run the services

### Start the main REST API

From the project root:

```bash
npm start
```

The main API runs on:
- http://localhost:3002

### Start the MCP server

In a second terminal:

```bash
cd mcp-server
npm start
```

The MCP server runs on:
- http://localhost:5001

### Open the UI

- Main blog UI: http://localhost:3002/
- Chatbot UI: http://localhost:5001/

---
## API endpoints

Base URL for the main REST API:

- http://localhost:3002

### Posts

- POST /posts: create a post
- GET /posts: list posts
- GET /posts/:id: get one post
- PUT /posts/:id: update a post
- DELETE /posts/:id: delete a post and its comments

### Comments

- POST /posts/:id/comments: add a comment
- GET /posts/:id/comments: list comments for a post

### Validation rules

Posts require:
- title: minimum 5 characters
- author: minimum 3 characters
- category: tech, finance, or lifestyle
- body: minimum 50 characters

Comments require:
- text: minimum 10 characters
- commenter: required

---
## AI chatbot flow

The AI chatbot flow is handled by the MCP server.

### Endpoint

- POST /ai-chatbot on the MCP server

### How it works

1. The client sends a natural language message.
2. The MCP server asks Ollama to interpret the request.
3. Ollama returns an action such as create_post or add_comment.
4. The MCP server executes that action by calling the main REST API.
5. The result is returned to the client in a structured response.

### Example

```bash
curl -X POST http://localhost:5001/ai-chatbot \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a new post about AI trends"}'
```

---
## MCP flow

The MCP flow is handled by the MCP server over Streamable HTTP.

### Endpoint

- POST /mcp

### How it works

1. An MCP client sends a JSON-RPC request to /mcp.
2. The MCP server initializes the connection and handles tool calls.
3. Tools such as create_post, list_posts, update_post, delete_post, add_comment, and list_comments are executed.
4. Each tool calls the REST API and returns the response.

### Example MCP action

An MCP client can call the create_post tool to create a post, and the server will forward that action to the main API.

---
## Tool summary

The MCP server exposes these tools:

- create_post
- list_posts
- get_post
- update_post
- delete_post
- add_comment
- list_comments
- ai_chatbot_agent

---
## Notes

- The main REST API is the data layer.
- The MCP server is the orchestration layer for AI and MCP clients.
- The chatbot and MCP client are both real action executors, not just read-only assistants.
