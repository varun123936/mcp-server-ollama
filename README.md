# MCP API

Node.js Express API for **Posts** and **Comments**, backed by MongoDB (Mongoose). All responses are JSON.

There is also an **MCP server** in the `mcp-server/` folder that exposes this API as MCP tools over **Streamable HTTP** at `POST /mcp` (no auth). See `mcp-server/README.md` for setup and tool list.

## Project structure

- `server.js`: Backend REST API (Node.js + Express + MongoDB) for posts and comments.
- `public/`: Frontend UI that talks to this backend (served by Express via `express.static('public')`).
- `mcp-server/`: MCP server that wraps this backend and exposes it as MCP tools.

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

3. **Start the backend server**
   ```bash
   npm start
   ```
   Server runs on **port 3002** (see `PORT` in `server.js`).

4. **Open the UI**

   The UI is served from the `public/` folder by Express. Once the backend is running, open:

   - `http://localhost:3002/` in your browser.

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

- **Missing required fields** → `400` with a message describing what’s wrong.
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
