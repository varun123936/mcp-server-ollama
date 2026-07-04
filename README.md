# MCP API with AI Chatbot Agent

Node.js Express API for **Posts** and **Comments**, backed by MongoDB (Mongoose). All responses are JSON.

There is also an **MCP server** in the `mcp-server/` folder that exposes this API as MCP tools over **Streamable HTTP** at `POST /mcp` (no auth). See `mcp-server/README.md` for setup and tool list.

This project has been enhanced with an **AI Chatbot Agent** that can understand natural language commands and perform CRUD operations using the Ollama Gemma2 model.

## Project structure

- `server.js`: Backend REST API (Node.js + Express + MongoDB) for posts and comments.
- `public/`: Frontend UI that talks to this backend (served by Express via `express.static('public')`).
- `mcp-server/`: MCP server that wraps this backend and exposes it as MCP tools.
- `public/chatbot.html`: AI chatbot interface for natural language interaction.

---
## Setup

1. **Install backend dependencies**
   ```bash
   npm install
   ```

2. **Set MongoDB connection for the backend**
   ```bash
   # example
   export MONGO_URI="mongodb://localhost:27017/mcp-api"
   ```

3. **Install Ollama and the Gemma2 model**
   ```bash
   # Install Ollama from https://ollama.com/
   # Then pull the Gemma2 model
   ollama pull gemma2:2b
   ```

4. **Start the backend server**
   ```bash
   npm start
   ```
   Server runs on **port 3002** (see `PORT` in `server.js`).

5. **Open the UI**

   The UI is served from the `public/` folder by Express. Once the backend is running, open:

   - `http://localhost:3002/` in your browser for the main blog interface.
   - `http://localhost:3002/chatbot.html` for the AI chatbot interface.

---
## Running the MCP server

The MCP server lives in the `mcp-server/` folder and wraps this backend.

1. **Make sure the backend is running first**

   From the project root:
   ```bash
   # in one terminal
   export MONGO_URI="mongodb://localhost:27017/mcp-api"
   npm start          # backend on http://localhost:3002
   ```

2. **Start the MCP server**

   In a new terminal:
   ```bash
   cd mcp-server
   npm install        # first time only
   npm start
   ```

   By default:
   - Backend base URL: `http://localhost:3002`
   - MCP server port: `3001`
   - MCP HTTP endpoint: `POST http://localhost:3001/mcp`
   - AI Chatbot endpoint: `POST http://localhost:3001/ai-chatbot`

---
## AI Chatbot Agent

The AI Chatbot Agent is a new feature that allows users to interact with the blog system using natural language commands. It uses the Ollama Gemma2 model to understand user requests and map them to appropriate API actions.

### Features

1. **Natural Language Processing**: Understands user requests in plain English
2. **CRUD Operations**: Can create, read, update, and delete posts and comments
3. **Context Awareness**: Provides relevant context to the AI model
4. **Web Interface**: User-friendly chat interface
5. **API Endpoint**: Direct API access for integration

### How It Works

1. User sends a natural language request (e.g., "Create a new post about AI")
2. The AI processes the request using the Ollama Gemma2 model
3. The AI determines the appropriate action and parameters
4. The system executes the corresponding API call
5. Results are returned to the user in a conversational format

### Example Commands

- "Create a new post with title 'The Future of AI', author 'Tech Writer', category 'tech', and body 'Artificial intelligence is rapidly evolving...'"
- "List all posts"
- "Show me all posts in the tech category"
- "Update post ID 12345 with a new title 'The Future of AI and Machine Learning'"
- "Delete the post with ID 12345"
- "Add a comment 'This is fascinating!' from 'Reader' to post ID 67890"
- "List all comments for post ID 67890"

### Web Interface

Navigate to `http://localhost:3002/chatbot.html` to access the AI chatbot interface. The interface includes:
- Chat message display
- Text input for commands
- Example commands for quick access
- Real-time responses from the AI

### API Endpoint

You can also interact with the AI chatbot directly via the API:

```bash
curl -X POST http://localhost:3001/ai-chatbot \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a new post about technology trends"}'
```

Response format:
```json
{
  "action": "create_post",
  "explanation": "Creating a new post with the provided details",
  "result": {
    "_id": "67890",
    "title": "Technology Trends",
    "author": "AI Assistant",
    "category": "tech",
    "body": "This is a post about technology trends...",
    "createdAt": "2026-07-04T12:00:00.000Z"
  }
}
```

---
## Validation

The API validates request bodies and returns clear error messages.

### Post (create & update)

| Field     | Rule                          | Error (400) |
|----------|--------------------------------|-------------|
| `title`  | Required, min 5 characters     | `"title is required"` / `"title must be at least 5 characters"` |
| `author` | Required, min 3 characters     | `"author is required"` / `"author must be at least 3 characters"` |
| `category` | Required, one of: `tech`, `finance`, `lifestyle` | `"Invalid category"` |
| `body`   | Required, min 50 characters    | `"body is required"` / `"body must be at least 50 characters"` |

- **Missing required fields** → `400` with a message describing what's wrong.
- **Invalid category** → `400` with message `"Invalid category"`.
- **Body shorter than 50 characters** → `400`.

### Comment (create)

| Field       | Rule                          | Error (400) |
|------------|--------------------------------|-------------|
| `text`     | Required, min 10 characters    | `"text is required"` / `"text must be at least 10 characters"` |
| `commenter`| Required                       | `"commenter is required"` |

- **Comment text shorter than 10 characters** → `400`.

### Post not found

- Invalid or non-existent post ID (e.g. for `GET/PUT/DELETE /posts/:id` or comment routes) → **404** with `"Post not found"`.

All error responses use the shape: `{ "error": "<message>" }`.

---
## API Endpoints

Base URL: `http://localhost:3002`

### Posts

| Method | Path           | Description                    | Success |
|--------|----------------|--------------------------------|---------|
| `POST` | `/posts`      | Create a post (validated)      | `201` + created post |
| `GET`  | `/posts`      | List all posts                 | `200` + array of posts |
| `GET`  | `/posts/:id`  | Get one post                   | `200` + post, or `404` |
| `PUT`  | `/posts/:id`  | Update a post (same validation)| `200` + updated post, or `404` |
| `DELETE` | `/posts/:id`| Delete a post (and its comments) | `200` + `{ "message": "Post deleted" }`, or `404` |

### Comments

| Method | Path                  | Description           | Success |
|--------|-----------------------|-----------------------|---------|
| `POST` | `/posts/:id/comments` | Add a comment to post | `201` + created comment, or `404` if post not found |
| `GET`  | `/posts/:id/comments` | List comments for post| `200` + array of comments, or `404` if post not found |

### AI Chatbot

| Method | Path           | Description                    | Success |
|--------|----------------|--------------------------------|---------|
| `POST` | `/ai-chatbot`  | Process natural language command | `200` + action result |

---
## Request / Response Examples

### Create a post
```http
POST /posts
Content-Type: application/json

{
  "title": "Getting started with Node",
  "author": "Jane",
  "category": "tech",
  "body": "This is a longer body that meets the minimum length requirement of fifty characters."
}
```
→ `201` + post object (includes `_id`, `createdAt`).

### Create a comment
```http
POST /posts/<postId>/comments
Content-Type: application/json

{
  "text": "Great post, very helpful!",
  "commenter": "Alex"
}
```
→ `201` + comment object.

### AI Chatbot Request
```http
POST /ai-chatbot
Content-Type: application/json

{
  "message": "Create a new post about AI advancements"
}
```
→ `200` + JSON response with action details.

### Error response (validation)
```json
{ "error": "Invalid category" }
```
```json
{ "error": "body must be at least 50 characters" }
```

### Error response (not found)
```json
{ "error": "Post not found" }
```

---
## Data Models (summary)

- **Post**: `title`, `author`, `category`, `body`, `createdAt` (auto).
- **Comment**: `postId` (reference to post), `text`, `commenter`, `createdAt` (auto).
- IDs are MongoDB ObjectIds, auto-generated.

Use this README to walk through validation rules and the exposed API when explaining the project.