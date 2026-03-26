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
// Must echo back exact origin (not *) because Adobe sends credentials:'include'
// Must reflect requested headers because Adobe sends dynamic ones like
// x-demobackend-authorization that can't be hardcoded
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');

  // Reflect back whatever headers the preflight requests
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    res.header('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  res.header('Access-Control-Max-Age', '86400');

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

app.get('/', (req, res) => {
  res.json({
    service: 'NovaTech UE Demo Backend',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

// /configuration — Adobe UE calls on startup
app.get('/configuration', (req, res) => {
  console.log('[GET /configuration]');
  res.json({
    status: 'ok',
    version: '1.0.0',
    connections: [
      {
        name: 'demobackend',
        protocol: 'custom',
        uri: 'https://ue-demo-backend.onrender.com',
      },
    ],
  });
});

app.post('/configuration', (req, res) => {
  console.log('[POST /configuration]');
  res.json({ status: 'ok' });
});

// ══════════════════════════════════════════════════════════
//  ADOBE UNIVERSAL EDITOR ENDPOINTS
// ══════════════════════════════════════════════════════════

// /details — returns field values for the properties panel
// Adobe calls this when a component is selected in the canvas
app.get('/details', (req, res) => {
  console.log('[GET /details]', req.query);
  res.json({ status: 'ok' });
});

app.post('/details', (req, res) => {
  console.log('[POST /details]', JSON.stringify(req.body, null, 2));

  try {
    const target = req.body?.target || {};
    const resource = target.resource || '';

    // Parse URN to find current field values
    const contentPath = resource.replace(/^urn:[^:]+:/, '');
    const parts       = contentPath.replace(/^\/content\//, '').split('/');
    const sectionKey  = parts[0];
    const arrayIndex  = parts[1] ? parseInt(parts[1], 10) - 1 : null;

    let currentData = {};
    if (sectionKey && content[sectionKey]) {
      if (arrayIndex !== null && Array.isArray(content[sectionKey])) {
        currentData = content[sectionKey][arrayIndex] || {};
      } else {
        currentData = content[sectionKey] || {};
      }
    }

    // Return current field values so the properties panel is pre-filled
    res.json({
      resource,
      properties: currentData,
    });

  } catch (err) {
    console.error('[/details error]', err);
    // Always return 200 with empty data — never let /details crash
    res.json({ resource: '', properties: {} });
  }
});

// /update — called when author saves an edit
app.get('/update',   (req, res) => res.json({ status: 'ok' }));
app.post('/update',  handleUEUpdate);
app.patch('/update', handleUEUpdate);
app.post('/',        handleUEUpdate);
app.patch('/',       handleUEUpdate);

function handleUEUpdate(req, res) {
  try {
    const body    = req.body;
    const target  = body.target  || {};
    const patches = body.patch   || [];

    console.log(`[${req.method} ${req.path}]`, JSON.stringify(body, null, 2));

    const resource    = target.resource || '';
    const contentPath = resource.replace(/^urn:[^:]+:/, '');
    const parts       = contentPath.replace(/^\/content\//, '').split('/');
    const sectionKey  = parts[0];
    const arrayIndex  = parts[1] ? parseInt(parts[1], 10) - 1 : null;

    if (!sectionKey) {
      return res.status(400).json({ error: 'Could not parse resource URN' });
    }

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

    // Fallback: single-prop update
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

app.get('/api/content', (req, res) => {
  res.json(content);
});

app.get('/api/content/:key', (req, res) => {
  const section = content[req.params.key];
  if (section === undefined) {
    return res.status(404).json({ error: `Section "${req.params.key}" not found` });
  }
  res.json(section);
});

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
  console.log(`   UE update:     http://localhost:${PORT}/update`);
  console.log(`   UE details:    http://localhost:${PORT}/details`);
});
