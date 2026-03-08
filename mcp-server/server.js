const express = require('express');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod');
const cors=require("cors");

const app = express();
app.use(express.json());
app.use(cors())

// Serve static UI assets from /public
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.MCP_PORT || 3001;
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3002';
const VALID_CATEGORIES = ['tech', 'finance', 'lifestyle'];

// --- API client: call Posts API and return parsed JSON or throw with message ---
async function api(method, path, body) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const msg = data.error || res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// --- Validation (same rules as main API) ---
function validatePostInput(args) {
  if (!args.title || typeof args.title !== 'string') return 'title is required';
  if (args.title.trim().length < 5) return 'title must be at least 5 characters';
  if (!args.author || typeof args.author !== 'string') return 'author is required';
  if (args.author.trim().length < 3) return 'author must be at least 3 characters';
  if (!args.category || typeof args.category !== 'string') return 'category is required';
  if (!VALID_CATEGORIES.includes(args.category)) return 'Invalid category';
  if (!args.body || typeof args.body !== 'string') return 'body is required';
  if (args.body.trim().length < 50) return 'body must be at least 50 characters';
  return null;
}

function validateCommentInput(args) {
  if (!args.text || typeof args.text !== 'string') return 'text is required';
  if (args.text.trim().length < 10) return 'text must be at least 10 characters';
  if (!args.commenter || typeof args.commenter !== 'string') return 'commenter is required';
  return null;
}

// --- Build MCP server with tools (stateless: create per request) ---
function createMcpServer() {
  const server = new McpServer({
    name: 'posts-api-mcp',
    version: '1.0.0',
    description: 'MCP server that exposes Posts & Comments API as tools'
  }, { capabilities: { tools: {}, resources: {}, prompts: {} } });

  server.registerTool('create_post', {
    description: 'Create a new post. Validates: title (min 5), author (min 3), category (tech|finance|lifestyle), body (min 50 chars).',
    inputSchema: {
      title: z.string().min(5).describe('Post title, min 5 characters'),
      author: z.string().min(3).describe('Author name, min 3 characters'),
      category: z.enum(['tech', 'finance', 'lifestyle']).describe('Category'),
      body: z.string().min(50).describe('Post body, min 50 characters')
    }
  }, async (args) => {
    const err = validatePostInput(args);
    if (err) throw new Error(err);
    const post = await api('POST', '/posts', {
      title: args.title.trim(),
      author: args.author.trim(),
      category: args.category,
      body: args.body.trim()
    });
    return { content: [{ type: 'text', text: JSON.stringify(post, null, 2) }] };
  });

  server.registerTool('list_posts', {
    description: 'List all posts from the API.',
    inputSchema: {}
  }, async () => {
    const posts = await api('GET', '/posts');
    return { content: [{ type: 'text', text: JSON.stringify(posts, null, 2) }] };
  });

  server.registerTool('get_post', {
    description: 'Get a single post by ID. Returns 404 if not found.',
    inputSchema: {
      postId: z.string().describe('MongoDB ObjectId of the post')
    }
  }, async (args) => {
    const post = await api('GET', `/posts/${args.postId}`);
    return { content: [{ type: 'text', text: JSON.stringify(post, null, 2) }] };
  });

  server.registerTool('update_post', {
    description: 'Update an existing post. Same validation as create_post. Returns 404 if post not found.',
    inputSchema: {
      postId: z.string().describe('MongoDB ObjectId of the post'),
      title: z.string().min(5).describe('Post title, min 5 characters'),
      author: z.string().min(3).describe('Author name, min 3 characters'),
      category: z.enum(['tech', 'finance', 'lifestyle']).describe('Category'),
      body: z.string().min(50).describe('Post body, min 50 characters')
    }
  }, async (args) => {
    const err = validatePostInput(args);
    if (err) throw new Error(err);
    const post = await api('PUT', `/posts/${args.postId}`, {
      title: args.title.trim(),
      author: args.author.trim(),
      category: args.category,
      body: args.body.trim()
    });
    return { content: [{ type: 'text', text: JSON.stringify(post, null, 2) }] };
  });

  server.registerTool('delete_post', {
    description: 'Delete a post by ID. Also deletes its comments. Returns 404 if post not found.',
    inputSchema: {
      postId: z.string().describe('MongoDB ObjectId of the post')
    }
  }, async (args) => {
    const result = await api('DELETE', `/posts/${args.postId}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  server.registerTool('add_comment', {
    description: 'Add a comment to a post. Validates: text (min 10), commenter required. Returns 404 if post not found.',
    inputSchema: {
      postId: z.string().describe('MongoDB ObjectId of the post'),
      text: z.string().min(10).describe('Comment text, min 10 characters'),
      commenter: z.string().describe('Commenter name')
    }
  }, async (args) => {
    const err = validateCommentInput(args);
    if (err) throw new Error(err);
    const comment = await api('POST', `/posts/${args.postId}/comments`, {
      text: args.text.trim(),
      commenter: args.commenter.trim()
    });
    return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] };
  });

  server.registerTool('list_comments', {
    description: 'List all comments for a post. Returns 404 if post not found.',
    inputSchema: {
      postId: z.string().describe('MongoDB ObjectId of the post')
    }
  }, async (args) => {
    const comments = await api('GET', `/posts/${args.postId}/comments`);
    return { content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }] };
  });

  // --- Resource: API guide for posts (national duty / general) ---
  server.registerResource('posts-api-guide', 'https://posts-api.example/guide', {
    title: 'Posts API Guide',
    description: 'Guide for creating and managing posts (e.g. national duty). Categories: tech, finance, lifestyle. Title min 5 chars, author min 3, body min 50.',
    mimeType: 'text/plain'
  }, async () => {
    return {
      contents: [{
        uri: 'https://posts-api.example/guide',
        text: 'Posts API: create_post (title, author, category, body), get_post(postId), update_post(postId, ...), delete_post(postId), list_posts. Categories: tech, finance, lifestyle. Use this workflow for a "national duty" post: create → edit → view → delete.'
      }]
    };
  });

  // --- Prompt: run full post workflow (create national duty post → edit → view → delete) ---
  server.registerPrompt('national-duty-post-workflow', {
    title: 'National Duty Post: Create, Edit, View, Delete',
    description: 'Runs all post tools in sequence: create a post on national duty, edit it, view it, then delete it.'
  }, async () => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You must use the Posts API tools in this exact order. Do each step and use the post ID from step 1 for steps 2, 3, and 4.

1) CREATE: Call create_post to create a new post about "national duty". Use:
   - title: at least 5 characters (e.g. "Why National Duty Matters")
   - author: at least 3 characters (e.g. "Jane Doe")
   - category: one of tech, finance, or lifestyle (e.g. "lifestyle")
   - body: at least 50 characters describing the importance of national duty, civic responsibility, or serving the country.

2) EDIT: Call update_post with the _id returned from step 1. Change the title or body to an edited version (e.g. add a sentence or refine the message). Keep author and category the same; title and body must still meet minimum length rules.

3) VIEW: Call get_post with the same post _id to fetch and show the current post.

4) DELETE: Call delete_post with the same post _id to remove the post.

After each tool call, report the result briefly. Complete all four steps in order.`
          }
        }
      ]
    };
  });

  return server;
}

// --- /mcp: no auth, streamable HTTP ---
app.post('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message || 'Internal server error' },
        id: null
      });
    }
  } finally {
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
  }
});

app.get('/mcp', (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Use POST for MCP.' },
    id: null
  });
});

app.listen(PORT, () => {
  console.log(`MCP server (streamable HTTP) listening on port ${PORT}, endpoint POST /mcp (no auth)`);
  console.log(`API base: ${API_BASE}`);
});
 