const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const app = express();
app.use(express.json());
app.use(express.static('public'));
const cors = require("cors");
app.use(cors())

const PORT = 3002;
const VALID_CATEGORIES = ['tech', 'finance', 'lifestyle'];

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, required: true },
  category: { type: String, required: true },
  body: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const commentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  text: { type: String, required: true },
  commenter: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);
const Comment = mongoose.model('Comment', commentSchema);

function validatePost(body) {
  if (!body.title || typeof body.title !== 'string') return { ok: false, msg: 'title is required' };
  if (body.title.trim().length < 5) return { ok: false, msg: 'title must be at least 5 characters' };
  if (!body.author || typeof body.author !== 'string') return { ok: false, msg: 'author is required' };
  if (body.author.trim().length < 3) return { ok: false, msg: 'author must be at least 3 characters' };
  if (!body.category || typeof body.category !== 'string') return { ok: false, msg: 'category is required' };
  if (!VALID_CATEGORIES.includes(body.category)) return { ok: false, msg: 'Invalid category' };
  if (!body.body || typeof body.body !== 'string') return { ok: false, msg: 'body is required' };
  if (body.body.trim().length < 50) return { ok: false, msg: 'body must be at least 50 characters' };
  return { ok: true };
}

function validateComment(body) {
  if (!body.text || typeof body.text !== 'string') return { ok: false, msg: 'text is required' };
  if (body.text.trim().length < 10) return { ok: false, msg: 'text must be at least 10 characters' };
  if (!body.commenter || typeof body.commenter !== 'string') return { ok: false, msg: 'commenter is required' };
  return { ok: true };
}

async function getPost(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Post.findById(id);
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

// POST /posts
app.post('/posts', async (req, res) => {
  try {
    const v = validatePost(req.body);
    if (!v.ok) return sendError(res, 400, v.msg);
    const post = await Post.create({
      title: req.body.title.trim(),
      author: req.body.author.trim(),
      category: req.body.category.trim(),
      body: req.body.body.trim()
    });
    return res.status(201).json(post);
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

// GET /posts
app.get('/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    return res.json(posts);
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

// GET /posts/:id
app.get('/posts/:id', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return sendError(res, 404, 'Post not found');
    return res.json(post);
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

// PUT /posts/:id
app.put('/posts/:id', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return sendError(res, 404, 'Post not found');
    const v = validatePost(req.body);
    if (!v.ok) return sendError(res, 400, v.msg);
    Object.assign(post, {
      title: req.body.title.trim(),
      author: req.body.author.trim(),
      category: req.body.category.trim(),
      body: req.body.body.trim()
    });
    await post.save();
    return res.json(post);
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

// DELETE /posts/:id
app.delete('/posts/:id', async (req, res) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) return sendError(res, 404, 'Post not found');
    await Comment.deleteMany({ postId: req.params.id });
    return res.json({ message: 'Post deleted' });
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

// POST /posts/:id/comments
app.post('/posts/:id/comments', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return sendError(res, 404, 'Post not found');
    const v = validateComment(req.body);
    if (!v.ok) return sendError(res, 400, v.msg);
    const comment = await Comment.create({
      postId: post._id,
      text: req.body.text.trim(),
      commenter: req.body.commenter.trim()
    });
    return res.status(201).json(comment);
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

// GET /posts/:id/comments
app.get('/posts/:id/comments', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return sendError(res, 404, 'Post not found');
    const comments = await Comment.find({ postId: req.params.id }).sort({ createdAt: -1 });
    return res.json(comments);
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

// AI Chatbot endpoint
app.post('/ai-chatbot', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // For demonstration purposes, we'll just echo the message back
    // In a real implementation, you would integrate with Ollama here
    return res.json({
      message: `AI Assistant response to: "${message}"`,
      action: 'echo',
      result: { echoedMessage: message }
    });
  } catch (err) {
    return sendError(res, 500, err.message || 'Server error');
  }
});

async function start() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI environment variable is required');
    await mongoose.connect(uri);
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();