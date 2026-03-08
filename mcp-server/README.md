# MCP Server (Streamable HTTP)

MCP server that exposes the **Posts & Comments API** as tools over **Streamable HTTP**. No auth on `/mcp`.

**Requires Node 18+** (MCP SDK and Hono depend on it).

## Setup

1. **Start the main API** (Posts server) first, e.g. on port 3000:
   ```bash
   cd .. && MONGO_URI="mongodb://..." npm start
   ```

2. **Install and start the MCP server** (default port 3001):
   ```bash
   npm install
   npm start
   ```

## Configuration

- **`API_BASE_URL`** – Base URL of the Posts API (default: `http://localhost:3000`).
- **`MCP_PORT`** – Port for this MCP server (default: `3001`).

## Endpoint

- **`POST /mcp`** – MCP Streamable HTTP endpoint (no authentication).  
  MCP clients send JSON-RPC here; the server handles initialization and tool calls.

- **`GET /mcp`** – Returns `405 Method Not Allowed` (stateless server, no SSE session).

## Tools (with validation)

All tools call the main API and apply the same validation rules.

| Tool | Description | Validation |
|------|-------------|------------|
| `create_post` | Create a post | title ≥5, author ≥3, category ∈ tech/finance/lifestyle, body ≥50 |
| `list_posts` | List all posts | — |
| `get_post` | Get one post by ID | — |
| `update_post` | Update a post | Same as create_post |
| `delete_post` | Delete a post (and its comments) | — |
| `add_comment` | Add comment to a post | text ≥10, commenter required |
| `list_comments` | List comments for a post | — |

Validation errors (e.g. invalid category, body too short) are returned as tool errors with clear messages. If the API returns 404 (e.g. post not found), the tool returns that as an error.

## Flow

1. MCP client sends `POST /mcp` with JSON-RPC (e.g. `initialize`, then `tools/call`).
2. Server uses **Streamable HTTP** transport (stateless, new server + transport per request).
3. Tool handlers validate arguments (Zod + custom rules), then `fetch()` the Posts API.
4. API response is returned as the tool result (or an error).
