/**
 * Adobe Universal Editor — Custom Service + Content Backend
 * ──────────────────────────────────────────────────────────
 * Runs on Render.com (free tier).
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Content store ──────────────────────────────────────────
const CONTENT_FILE = path.join(__dirname, 'content.json');

function loadContent() {
  try {
    return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveContent(data) {
  try {
    fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist content:', err.message);
  }
}

let content = loadContent();

// ── CORS ───────────────────────────────────────────────────
// Adobe sends requests with credentials:'include' so we must:
//   1. Echo back the exact requesting origin (not wildcard *)
//   2. Reflect back whatever headers Adobe asks for in the preflight
//      because Adobe sends dynamic headers like x-demobackend-authorization
//      that change based on your connection name and cannot be hardcoded
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Echo back exact origin — required when credentials:'include'
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');

  // Reflect back whatever headers the preflight asks for
  // This handles x-demobackend-authorization and any other
  // dynamic headers Adobe generates from your connection name
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    res.header('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  res.header('Access-Control-Max-Age', '86400');

  // Preflight — respond immediately with no body
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// ── Body parsing ───────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ══════════════════════════════════════════════════════════
//  STANDARD ENDPOINTS
// ══════════════════════════════════════════════════════════

// Health check
app.get('/', (req, res) => {
  res.json({
    service: 'NovaTech UE Demo Backend',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

// /configuration — Adobe UE calls this on startup
app.get('/configuration', (req, res) => {
  console.log('[GET /configuration]');
  res.json({
    status: 'ok',
    version: '1.0.0',
    connections: [
      {
        name: 'demobackend',
        protocol: 'demobackend',
        uri: 'https://ue-demo-backend.onrender.com',
      },
    ],
  });
});

// Adobe also POSTs to /configuration
app.post('/configuration', (req, res) => {
  console.log('[POST /configuration]', JSON.stringify(req.body, null, 2));
  res.json({ status: 'ok' });
});

// ══════════════════════════════════════════════════════════
//  ADOBE UNIVERSAL EDITOR ENDPOINTS
// ══════════════════════════════════════════════════════════

// /details — called to get resource metadata for the Properties panel
app.get('/details', (req, res) => {
  console.log('[GET /details]', req.query);
  res.json({ status: 'ok', properties: {} });
});

app.post('/details', (req, res) => {
  console.log('[POST /details]', JSON.stringify(req.body, null, 2));
  res.json({
    resource: req.body?.target?.resource || '',
    properties: {},
  });
});

// /update — called when author saves an edit in the canvas
app.get('/update',   (req, res) => res.json({ status: 'ok' }));
app.post('/update',  handleUEUpdate);
app.patch('/update', handleUEUpdate);

// Root PATCH/POST for older UE versions
app.post('/',  handleUEUpdate);
app.patch('/', handleUEUpdate);

function handleUEUpdate(req, res) {
  try {
    const body = req.body;
    console.log(`[${req.method} ${req.path}]`, JSON.stringify(body, null, 2));

    const target  = body.target  || {};
    const patches = body.patch   || [];

    // Parse resource URN → content section key + optional array index
    // "urn:demobackend:/content/hero"       → sectionKey="hero",     arrayIndex=null
    // "urn:demobackend:/content/features/1" → sectionKey="features", arrayIndex=0
    const resource    = target.resource || '';
    const contentPath = resource.replace(/^urn:[^:]+:/, '');
    const parts       = contentPath.replace(/^\/content\//, '').split('/');
    const sectionKey  = parts[0];
    const arrayIndex  = parts[1] ? parseInt(parts[1], 10) - 1 : null;

    if (!sectionKey) {
      return res.status(400).json({ error: 'Could not parse resource URN' });
    }

    // Create section if missing
    if (!content[sectionKey]) {
      content[sectionKey] = arrayIndex !== null ? [] : {};
    }

    // Apply JSON patch operations
    if (patches.length > 0) {
      patches.forEach(op => {
        if (op.op !== 'replace' && op.op !== 'add') return;
        const prop  = op.path.replace(/^\//, '');
        const value = op.value;

        if (arrayIndex !== null && Array.isArray(content[sectionKey])) {
          if (!content[sectionKey][arrayIndex]) content[sectionKey][arrayIndex] = {};
          content[sectionKey][arrayIndex][prop] = value;
        } else {
          content[sectionKey][prop] = value;
        }
      });
    }

    // Fallback: single-prop update (some UE versions send this format)
    if (patches.length === 0 && target.prop) {
      const prop  = target.prop;
      const value = body.value ?? body.data ?? '';

      if (arrayIndex !== null && Array.isArray(content[sectionKey])) {
        if (!content[sectionKey][arrayIndex]) content[sectionKey][arrayIndex] = {};
        content[sectionKey][arrayIndex][prop] = value;
      } else {
        content[sectionKey][prop] = value;
      }
    }

    saveContent(content);
    console.log(`[SAVED] ${sectionKey}${arrayIndex !== null ? `[${arrayIndex}]` : ''}`);

    res.status(200).json({
      ok: true,
      resource: target.resource,
      updated: arrayIndex !== null
        ? content[sectionKey][arrayIndex]
        : content[sectionKey],
    });

  } catch (err) {
    console.error('[UE update error]', err);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════
//  CONTENT API
// ══════════════════════════════════════════════════════════

// GET /api/content — full content (frontend fetches this on page load)
app.get('/api/content', (req, res) => {
  res.json(content);
});

// GET /api/content/:key — single section
app.get('/api/content/:key', (req, res) => {
  const section = content[req.params.key];
  if (section === undefined) {
    return res.status(404).json({ error: `Section "${req.params.key}" not found` });
  }
  res.json(section);
});

// PATCH /api/content — direct update for testing with curl/Postman
// Body: { "key": "hero", "prop": "headline", "value": "Hello!" }
app.patch('/api/content', (req, res) => {
  const { key, prop, value } = req.body;
  if (!key) return res.status(400).json({ error: '"key" is required' });

  if (!content[key]) content[key] = {};
  if (prop) {
    content[key][prop] = value;
  } else {
    content[key] = { ...content[key], ...req.body };
  }

  saveContent(content);
  res.json({ ok: true, updated: { key, prop, value } });
});

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ NovaTech UE Backend running on port ${PORT}`);
  console.log(`   Health:        http://localhost:${PORT}/`);
  console.log(`   Configuration: http://localhost:${PORT}/configuration`);
  console.log(`   Content API:   http://localhost:${PORT}/api/content`);
  console.log(`   UE update:     http://localhost:${PORT}/update  (POST/PATCH)`);
  console.log(`   UE details:    http://localhost:${PORT}/details (GET/POST)`);
});
