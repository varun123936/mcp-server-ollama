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

const PORT = process.env.MCP_PORT || 5001;
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3002';
const VALID_CATEGORIES = ['tech', 'finance', 'lifestyle'];
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma2';

// Initialize Ollama client
const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
const ollama = new Ollama({ host: ollamaHost });

// Logger utility
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err || ''),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`)
};

// --- API client: call Posts API and return parsed JSON or throw with message ---
async function api(method, path, body) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  logger.info(`API call: ${method} ${url}`);
  
  const opts = { 
    method, 
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  };
  
  if (body && (method === 'POST' || method === 'PUT')) {
    opts.body = JSON.stringify(body);
  }
  
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      logger.error('Failed to parse API response:', e);
      data = {};
    }
    
    if (!res.ok) {
      const msg = data.error || res.statusText || `HTTP ${res.status}`;
      logger.error(`API error: ${msg}`);
      throw new Error(msg);
    }
    
    logger.info(`API success: ${method} ${url}`);
    return data;
  } catch (error) {
    logger.error(`API call failed: ${method} ${url}`, error);
    throw error;
  }
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
  logger.info(`Processing user message: "${message}"`);
  
  // Get current posts to provide context to the AI
  let postsContext = "";
  let posts = [];
  try {
    posts = await api('GET', '/posts');
    const postSummary = posts.slice(0, 5).map(p => `- "${p.title}" (ID: ${p._id})`).join('\n');
    postsContext = posts.length > 0 
      ? `\n\nCurrent posts in system:\n${postSummary}`
      : '\n\nNo posts currently in system.';
  } catch (err) {
    logger.warn(`Failed to fetch posts for context: ${err.message}`);
    postsContext = "\n\nCould not fetch current posts.";
  }

  const systemPrompt = `You are a production-grade AI assistant for managing a blog. 
You must understand user intent and perform the appropriate action.
Always respond with ONLY valid JSON, no markdown, no extra text, no explanations outside JSON.
Be precise and accurate.`;

  const userPrompt = `You manage blog posts and comments. Available actions:
- create_post (need: title, author, category, body)
- list_posts (no params needed)
- get_post (need: postId)
- update_post (need: postId, title, author, category, body)
- delete_post (need: postId - WARNING: deletes post and ALL comments)
- add_comment (need: postId, text, commenter)
- list_comments (need: postId)

User request: "${message}"
${postsContext}

Respond ONLY with this JSON structure (no other text):
{
  "action": "one of the actions listed above",
  "parameters": {object with required fields},
  "explanation": "brief explanation in simple English of what you're doing"
}

Rules:
1. Extract PostId from phrases like "post with ID xyz" or "post xyz"
2. For delete, confirm you understood - be explicit
3. Always validate required fields are present
4. Never make up information`;

  try {
    logger.info(`Calling Ollama model: ${OLLAMA_MODEL}`);
    
    const response = await ollama.chat({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      format: 'json',
      stream: false
    });

    const rawContent = response?.message?.content
      ?? (Array.isArray(response?.message) ? response.message[0]?.content : undefined)
      ?? response?.content
      ?? '';
    
    const content = typeof rawContent === 'string'
      ? rawContent.trim()
      : JSON.stringify(rawContent, null, 2);

    logger.info(`Ollama response: ${content.substring(0, 200)}`);

    const result = tryExtractJson(content);
    if (!result || typeof result !== 'object' || !result.action) {
      logger.warn(`Invalid AI response, returning list_posts: ${content}`);
      return {
        action: 'list_posts',
        parameters: {},
        explanation: 'I could not parse your request clearly. Showing all posts instead.'
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
      logger.warn(`Unknown action from AI: ${action}`);
      return {
        action: 'list_posts',
        parameters: {},
        explanation: 'I did not understand that action. Showing posts instead.'
      };
    }

    const missing = requiredFields[action].filter((field) => {
      return parameters[field] === undefined || parameters[field] === null || String(parameters[field]).trim() === '';
    });

    if (missing.length) {
      const missingList = missing.join(', ');
      logger.info(`Missing required fields for ${action}: ${missingList}`);
      return {
        action: 'clarify',
        parameters: { missing },
        explanation: `To ${action}, I need: ${missingList}. Please provide these details.`
      };
    }

    logger.info(`Parsed action: ${action}, parameters: ${JSON.stringify(parameters)}`);
    return result;
  } catch (error) {
    logger.error(`Error processing with Ollama: ${error.message}`, error);
    // Fallback: try to understand the message without AI
    logger.info('Attempting fallback pattern matching...');
    return parseMessageFallback(message);
  }
}

// Fallback pattern-based message parsing
function parseMessageFallback(message) {
  const lower = message.toLowerCase();
  
  if ((lower.includes('delete') || lower.includes('remove')) && lower.includes('post')) {
    const idMatch = message.match(/\b([0-9a-f]{24})\b/i);
    if (idMatch) {
      return {
        action: 'delete_post',
        parameters: { postId: idMatch[1] },
        explanation: `Deleting post ${idMatch[1]}`
      };
    }
  }
  
  if (lower.includes('list') && lower.includes('post')) {
    return {
      action: 'list_posts',
      parameters: {},
      explanation: 'Showing all posts'
    };
  }
  
  if (lower.includes('create') && lower.includes('post')) {
    return {
      action: 'clarify',
      parameters: {},
      explanation: 'To create a post, please provide: title, author, category (tech/finance/lifestyle), and body (50+ characters)'
    };
  }
  
  return {
    action: 'list_posts',
    parameters: {},
    explanation: 'I did not understand. Showing available posts.'
  };
}

async function executeAction(action, parameters) {
  logger.info(`Executing action: ${action} with params: ${JSON.stringify(parameters)}`);
  
  try {
    switch (action) {
      case "create_post": {
        const createError = validatePostInput(parameters);
        if (createError) throw new Error(createError);
        const result = await api('POST', '/posts', {
          title: parameters.title.trim(),
          author: parameters.author.trim(),
          category: parameters.category,
          body: parameters.body.trim()
        });
        logger.info(`Post created with ID: ${result._id}`);
        return result;
      }

      case "list_posts": {
        const result = await api('GET', '/posts');
        logger.info(`Retrieved ${result.length} posts`);
        return result;
      }

      case "get_post": {
        if (!parameters.postId) throw new Error("postId is required");
        const result = await api('GET', `/posts/${parameters.postId}`);
        logger.info(`Retrieved post: ${result._id}`);
        return result;
      }

      case "update_post": {
        if (!parameters.postId) throw new Error("postId is required");
        const updateError = validatePostInput(parameters);
        if (updateError) throw new Error(updateError);
        const result = await api('PUT', `/posts/${parameters.postId}`, {
          title: parameters.title.trim(),
          author: parameters.author.trim(),
          category: parameters.category,
          body: parameters.body.trim()
        });
        logger.info(`Post updated: ${parameters.postId}`);
        return result;
      }

      case "delete_post": {
        if (!parameters.postId) throw new Error("postId is required");
        logger.warn(`DELETE operation initiated for post: ${parameters.postId}`);
        const result = await api('DELETE', `/posts/${parameters.postId}`);
        logger.info(`Post deleted: ${parameters.postId}`);
        return result;
      }

      case "add_comment": {
        if (!parameters.postId) throw new Error("postId is required");
        const commentError = validateCommentInput(parameters);
        if (commentError) throw new Error(commentError);
        const result = await api('POST', `/posts/${parameters.postId}/comments`, {
          text: parameters.text.trim(),
          commenter: parameters.commenter.trim()
        });
        logger.info(`Comment added to post: ${parameters.postId}`);
        return result;
      }

      case "list_comments": {
        if (!parameters.postId) throw new Error("postId is required");
        const result = await api('GET', `/posts/${parameters.postId}/comments`);
        logger.info(`Retrieved ${result.length} comments for post: ${parameters.postId}`);
        return result;
      }

      case "clarify": {
        return { message: parameters.message || 'I need more details to complete that request.' };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    logger.error(`Action execution failed: ${action}`, error);
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

// --- Health check endpoint ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mcp_port: PORT,
    api_base: API_BASE,
    ollama_model: OLLAMA_MODEL,
    ollama_host: ollamaHost,
    timestamp: new Date().toISOString()
  });
});

// --- New endpoint for direct AI chatbot interaction (PRODUCTION) ---
app.post('/ai-chatbot', async (req, res) => {
  const startTime = Date.now();
  const { message, context } = req.body;

  logger.info(`=== AI Chatbot Request Received ===`);
  logger.info(`Message: "${message}"`);

  try {
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      logger.warn('Invalid message received');
      return res.status(400).json({ 
        error: 'Message is required and must be non-empty',
        success: false
      });
    }

    // Process the user message with the AI to determine the action
    logger.info('Step 1: Processing user message with AI...');
    const actionPlan = await processUserMessage(message.trim(), context || {});
    logger.info(`Step 2: Action determined: ${actionPlan.action}`);

    // Execute the determined action
    logger.info(`Step 3: Executing action: ${actionPlan.action}`);
    const result = await executeAction(actionPlan.action, actionPlan.parameters);
    logger.info(`Step 4: Action executed successfully`);

    const response = {
      success: true,
      action: actionPlan.action,
      explanation: actionPlan.explanation,
      result: result,
      executionTime: `${Date.now() - startTime}ms`
    };

    logger.info(`=== AI Chatbot Request Completed (${response.executionTime}) ===`);
    res.json(response);
  } catch (error) {
    logger.error(`=== AI Chatbot Request Failed ===`, error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      success: false,
      executionTime: `${Date.now() - startTime}ms`
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
  logger.info(`========================================`);
  logger.info(`MCP Server Started (Production Ready)`);
  logger.info(`========================================`);
  logger.info(`Port: ${PORT}`);
  logger.info(`API Base: ${API_BASE}`);
  logger.info(`Ollama Host: ${ollamaHost}`);
  logger.info(`Ollama Model: ${OLLAMA_MODEL}`);
  logger.info(`----------------------------------------`);
  logger.info(`Endpoints:`);
  logger.info(`  POST /ai-chatbot - AI chatbot for performing actions`);
  logger.info(`  POST /mcp - MCP protocol endpoint`);
  logger.info(`  GET /health - Health check`);
  logger.info(`----------------------------------------`);
  logger.info(`The AI chatbot can now perform real actions through this server.`);
  logger.info(`Ensure Ollama is running at: ${ollamaHost}`);
  logger.info(`========================================`);
});
