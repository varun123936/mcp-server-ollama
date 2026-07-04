const express = require('express');
const path = require('path');
require('dotenv').config();
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod');
const cors = require("cors");
const { Ollama } = require('ollama');

const app = express();
app.use(express.json());
app.use(cors())

// Serve static UI assets from /public
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.MCP_PORT || 3001;
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3002';
const VALID_CATEGORIES = ['tech', 'finance', 'lifestyle'];
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:cloud';

// Initialize Ollama client
const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434' });

// --- API client: call Posts API and return parsed JSON or throw with message ---
async function api(method, path, body) {
  console.log(`API call: ${method} ${path} ${body ? JSON.stringify(body) : ''}`);
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

function tryExtractJson(text) {
  if (!text || typeof text !== 'string') return null;
  let candidate = text.trim();

  // Strip markdown fences if present
  candidate = candidate.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();

  // Try raw parse first
  try {
    return JSON.parse(candidate);
  } catch {
    // Extract the first balanced JSON object from the text
    let depth = 0;
    let start = -1;
    for (let i = 0; i < candidate.length; i++) {
      const char = candidate[i];
      if (char === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          const chunk = candidate.slice(start, i + 1);
          try {
            return JSON.parse(chunk);
          } catch {
            start = -1;
          }
        }
      }
    }
  }

  return null;
}

// --- AI Chatbot Agent Functions ---
async function processUserMessage(message, context = {}) {
  // Get current posts to provide context to the AI
  let postsContext = "";
  try {
    const posts = await api('GET', '/posts');
    postsContext = `\n\nCurrent posts in the system:\n${JSON.stringify(posts.slice(0, 3), null, 2)}`;
  } catch (err) {
    console.error("Failed to fetch posts for context:", err.message);
  }

  const systemPrompt = `You are a helpful AI assistant. Always speak in short, simple English. Only output valid JSON with no extra text.`;
  const userPrompt = `You can manage posts and comments. Use these actions:
- create_post
- list_posts
- get_post
- update_post
- delete_post
- add_comment
- list_comments

User message: "${message}"

Current context:${postsContext}

Return one JSON object with:
- action: one of create_post, list_posts, get_post, update_post, delete_post, add_comment, list_comments
- parameters: object with required inputs
- explanation: short simple English

If unsure, ask one simple question in explanation and use list_posts with empty parameters.
`;

  try {
    const response = await ollama.chat({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      format: 'json'
    });

    const rawContent = response?.message?.content
      ?? (Array.isArray(response?.message) ? response.message[0]?.content : undefined)
      ?? response?.content
      ?? '';
    const content = typeof rawContent === 'string'
      ? rawContent
      : JSON.stringify(rawContent, null, 2);

    const result = tryExtractJson(content);
    if (!result || typeof result !== 'object' || !result.action) {
      console.error('Error parsing AI response or missing action:', content);
      return {
        action: 'list_posts',
        parameters: {},
        explanation: 'I could not understand the AI response clearly, so I am showing the posts.'
      };
    }

    const action = result.action;
    const parameters = result.parameters || {};
    const requiredFields = {
      create_post: ['title', 'author', 'category', 'body'],
      update_post: ['postId', 'title', 'author', 'category', 'body'],
      get_post: ['postId'],
      delete_post: ['postId'],
      add_comment: ['postId', 'text', 'commenter'],
      list_comments: ['postId'],
      list_posts: []
    };

    if (!requiredFields[action]) {
      console.error('Unknown action from AI response:', action, content);
      return {
        action: 'list_posts',
        parameters: {},
        explanation: 'I got an action I do not understand, so I am showing the posts.'
      };
    }

    const missing = requiredFields[action].filter((field) => {
      return parameters[field] === undefined || parameters[field] === null || String(parameters[field]).trim() === '';
    });

    if (missing.length) {
      const missingList = missing.join(', ');
      return {
        action: 'clarify',
        parameters: {},
        explanation: `I need ${missingList} to do that. Please tell me the missing info in simple English.`
      };
    }

    return result;
  } catch (error) {
    console.error('Error processing with Ollama:', error);
    throw new Error('Failed to process request with AI assistant: ' + error.message);
  }
}

async function executeAction(action, parameters) {
  try {
    switch (action) {
      case "create_post":
        const createError = validatePostInput(parameters);
        if (createError) throw new Error(createError);
        return await api('POST', '/posts', {
          title: parameters.title.trim(),
          author: parameters.author.trim(),
          category: parameters.category,
          body: parameters.body.trim()
        });

      case "list_posts":
        return await api('GET', '/posts');

      case "get_post":
        if (!parameters.postId) throw new Error("postId is required");
        return await api('GET', `/posts/${parameters.postId}`);

      case "update_post":
        if (!parameters.postId) throw new Error("postId is required");
        const updateError = validatePostInput(parameters);
        if (updateError) throw new Error(updateError);
        return await api('PUT', `/posts/${parameters.postId}`, {
          title: parameters.title.trim(),
          author: parameters.author.trim(),
          category: parameters.category,
          body: parameters.body.trim()
        });

      case "delete_post":
        if (!parameters.postId) throw new Error("postId is required");
        return await api('DELETE', `/posts/${parameters.postId}`);

      case "add_comment":
        if (!parameters.postId) throw new Error("postId is required");
        const commentError = validateCommentInput(parameters);
        if (commentError) throw new Error(commentError);
        return await api('POST', `/posts/${parameters.postId}/comments`, {
          text: parameters.text.trim(),
          commenter: parameters.commenter.trim()
        });

      case "list_comments":
        if (!parameters.postId) throw new Error("postId is required");
        return await api('GET', `/posts/${parameters.postId}/comments`);

      case "clarify":
        return { message: parameters.message || 'I need more details to complete that request.' };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    throw new Error(`Failed to execute ${action}: ${error.message}`);
  }
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

  // --- New AI Chatbot Agent Tool ---
  server.registerTool('ai_chatbot_agent', {
    description: 'AI chatbot agent that can understand natural language requests and perform CRUD operations on posts and comments using the Ollama Gemma model.',
    inputSchema: {
      message: z.string().describe('User message to process'),
      context: z.object({}).optional().describe('Additional context for the AI')
    }
  }, async (args) => {
    try {
      // Process the user message with the AI to determine the action
      const actionPlan = await processUserMessage(args.message, args.context || {});

      // Execute the determined action
      const result = await executeAction(actionPlan.action, actionPlan.parameters);

      return {
        content: [
          {
            type: 'text',
            text: `Action completed: ${actionPlan.explanation}\n\nResult:\n${JSON.stringify(result, null, 2)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error processing request: ${error.message}`
          }
        ]
      };
    }
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

// --- New endpoint for direct AI chatbot interaction ---
app.post('/ai-chatbot', async (req, res) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Process the user message with the AI to determine the action
    const actionPlan = await processUserMessage(message, context || {});

    // Execute the determined action
    const result = await executeAction(actionPlan.action, actionPlan.parameters);

    res.json({
      action: actionPlan.action,
      explanation: actionPlan.explanation,
      result: result
    });
  } catch (error) {
    console.error('AI Chatbot error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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
  console.log(`AI Chatbot endpoint: POST /ai-chatbot`);
});