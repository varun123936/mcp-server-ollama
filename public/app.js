const API_BASE = 'http://localhost:3002/posts';

const els = {
  postsList: document.getElementById('postsList'),
  refreshPostsBtn: document.getElementById('refreshPostsBtn'),
  newPostBtn: document.getElementById('newPostBtn'),
  deletePostBtn: document.getElementById('deletePostBtn'),
  editorTitle: document.getElementById('editorTitle'),
  postForm: document.getElementById('postForm'),
  postId: document.getElementById('postId'),
  title: document.getElementById('title'),
  author: document.getElementById('author'),
  category: document.getElementById('category'),
  body: document.getElementById('body'),
  postError: document.getElementById('postError'),
  postSuccess: document.getElementById('postSuccess'),
  savePostBtn: document.getElementById('savePostBtn'),
  savePostText: document.getElementById('savePostText'),
  commentsList: document.getElementById('commentsList'),
  commentsMeta: document.getElementById('commentsMeta'),
  commentForm: document.getElementById('commentForm'),
  commenter: document.getElementById('commenter'),
  commentText: document.getElementById('commentText'),
  addCommentBtn: document.getElementById('addCommentBtn'),
  commentError: document.getElementById('commentError'),
  postItemTemplate: document.getElementById('postItemTemplate'),
  commentItemTemplate: document.getElementById('commentItemTemplate'),
};

let state = {
  posts: [],
  activePostId: null,
  loadingPost: false,
};

function showPostMessage(type, message) {
  els.postError.classList.add('hidden');
  els.postSuccess.classList.add('hidden');

  if (!message) return;

  if (type === 'error') {
    els.postError.textContent = message;
    els.postError.classList.remove('hidden');
  } else if (type === 'success') {
    els.postSuccess.textContent = message;
    els.postSuccess.classList.remove('hidden');
  }
}

function showCommentError(message) {
  els.commentError.classList.add('hidden');
  if (!message) return;
  els.commentError.textContent = message;
  els.commentError.classList.remove('hidden');
}

async function apiRequest(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const contentType = res.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    if (body && body.error) {
      throw new Error(body.error);
    }
    throw new Error(`Request failed (${res.status})`);
  }

  return body;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function setActivePostId(id) {
  state.activePostId = id;
  els.deletePostBtn.disabled = !id;
  els.addCommentBtn.disabled = !id;

  const items = els.postsList.querySelectorAll('.post-item');
  items.forEach((el) => {
    if (el.dataset.id === id) el.classList.add('active');
    else el.classList.remove('active');
  });
}

function renderPosts() {
  els.postsList.innerHTML = '';

  if (!state.posts.length) {
    els.postsList.classList.add('empty-state');
    els.postsList.innerHTML = '<p>No posts yet. Create your first post on the right.</p>';
    return;
  }

  els.postsList.classList.remove('empty-state');

  state.posts.forEach((post) => {
    const node = els.postItemTemplate.content.cloneNode(true);
    const root = node.querySelector('.post-item');
    root.dataset.id = post._id;

    const titleEl = root.querySelector('.post-title');
    const bodyEl = root.querySelector('.post-body');
    const catEl = root.querySelector('.pill-category');
    const authorEl = root.querySelector('.pill-author');
    const dateEl = root.querySelector('.pill-date');

    titleEl.textContent = post.title;
    bodyEl.textContent = post.body;
    catEl.textContent = post.category;
    authorEl.textContent = post.author;
    dateEl.textContent = formatDate(post.createdAt);

    root.addEventListener('click', () => {
      loadPostDetail(post._id);
    });

    if (state.activePostId === post._id) {
      root.classList.add('active');
    }

    els.postsList.appendChild(node);
  });
}

async function loadPosts() {
  try {
    state.posts = await apiRequest(API_BASE);
    renderPosts();
  } catch (err) {
    showPostMessage('error', err.message || 'Failed to load posts');
  }
}

function resetPostForm() {
  els.postForm.reset();
  els.postId.value = '';
  els.editorTitle.textContent = 'Create Post';
  els.savePostText.textContent = 'Create Post';
  setActivePostId(null);
  showPostMessage();
  els.commentsList.classList.add('empty-state');
  els.commentsList.innerHTML = '<p>No post selected.</p>';
  els.commentsMeta.textContent = 'Select a post to view comments.';
  showCommentError();
}

async function loadPostDetail(id) {
  if (!id) return;
  state.loadingPost = true;
  setActivePostId(id);
  showPostMessage();
  showCommentError();

  try {
    const post = await apiRequest(`${API_BASE}/${id}`);
    els.postId.value = post._id;
    els.title.value = post.title;
    els.author.value = post.author;
    els.category.value = post.category;
    els.body.value = post.body;
    els.editorTitle.textContent = 'Edit Post';
    els.savePostText.textContent = 'Save Changes';
    els.commentsMeta.textContent = `Comments for “${post.title}”`;
    await loadComments(id);
  } catch (err) {
    showPostMessage('error', err.message || 'Failed to load post');
  } finally {
    state.loadingPost = false;
  }
}

async function loadComments(postId) {
  if (!postId) return;
  els.commentsList.innerHTML = '<p style="font-size:12px;color:#9ca3af;">Loading comments…</p>';
  els.commentsList.classList.remove('empty-state');

  try {
    const comments = await apiRequest(`${API_BASE}/${postId}/comments`);
    els.commentsList.innerHTML = '';

    if (!comments.length) {
      els.commentsList.classList.add('empty-state');
      els.commentsList.innerHTML = '<p>No comments yet. Be the first to comment.</p>';
      return;
    }

    els.commentsList.classList.remove('empty-state');

    comments.forEach((c) => {
      const node = els.commentItemTemplate.content.cloneNode(true);
      const root = node.querySelector('.comment-item');
      root.querySelector('.comment-text').textContent = c.text;
      root.querySelector('.pill-author').textContent = c.commenter;
      root.querySelector('.pill-date').textContent = formatDate(c.createdAt);
      els.commentsList.appendChild(node);
    });
  } catch (err) {
    showCommentError(err.message || 'Failed to load comments');
  }
}

async function handlePostSubmit(e) {
  e.preventDefault();
  showPostMessage();
  showCommentError();

  const id = els.postId.value || null;
  const payload = {
    title: els.title.value.trim(),
    author: els.author.value.trim(),
    category: els.category.value,
    body: els.body.value.trim(),
  };

  if (!payload.title || !payload.author || !payload.category || !payload.body) {
    showPostMessage('error', 'Please fill in all fields.');
    return;
  }

  els.savePostBtn.disabled = true;
  els.savePostText.textContent = id ? 'Saving…' : 'Creating…';

  try {
    const method = id ? 'PUT' : 'POST';
    const path = id ? `${API_BASE}/${id}` : API_BASE;
    const saved = await apiRequest(path, {
      method,
      body: JSON.stringify(payload),
    });

    await loadPosts();
    setActivePostId(saved._id);

    if (!id) {
      els.postId.value = saved._id;
      els.editorTitle.textContent = 'Edit Post';
      els.savePostText.textContent = 'Save Changes';
    }

    await loadPostDetail(saved._id);
    showPostMessage('success', id ? 'Post updated.' : 'Post created.');
  } catch (err) {
    showPostMessage('error', err.message || 'Failed to save post');
  } finally {
    els.savePostBtn.disabled = false;
    if (!els.postId.value) {
      els.savePostText.textContent = 'Create Post';
    } else {
      els.savePostText.textContent = 'Save Changes';
    }
  }
}

async function handleDeletePost() {
  const id = els.postId.value;
  if (!id) return;
  if (!window.confirm('Delete this post and all its comments?')) return;

  els.deletePostBtn.disabled = true;

  try {
    await apiRequest(`${API_BASE}/${id}`, { method: 'DELETE' });
    showPostMessage('success', 'Post deleted.');
    await loadPosts();
    resetPostForm();
  } catch (err) {
    showPostMessage('error', err.message || 'Failed to delete post');
  } finally {
    els.deletePostBtn.disabled = false;
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  showCommentError();

  const postId = state.activePostId;
  if (!postId) {
    showCommentError('Select a post first.');
    return;
  }

  const payload = {
    commenter: els.commenter.value.trim(),
    text: els.commentText.value.trim(),
  };

  if (!payload.commenter || !payload.text) {
    showCommentError('Please fill in your name and comment.');
    return;
  }

  els.addCommentBtn.disabled = true;

  try {
    await apiRequest(`${API_BASE}/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    els.commentForm.reset();
    await loadComments(postId);
  } catch (err) {
    showCommentError(err.message || 'Failed to add comment');
  } finally {
    els.addCommentBtn.disabled = !state.activePostId;
  }
}

function attachEvents() {
  els.refreshPostsBtn.addEventListener('click', () => {
    loadPosts();
  });

  els.newPostBtn.addEventListener('click', () => {
    resetPostForm();
  });

  els.deletePostBtn.addEventListener('click', () => {
    handleDeletePost();
  });

  els.postForm.addEventListener('submit', handlePostSubmit);
  els.commentForm.addEventListener('submit', handleCommentSubmit);
}

function init() {
  attachEvents();
  loadPosts();
}

document.addEventListener('DOMContentLoaded', init);

