/**
 * Adobe Universal Editor — Custom Service + Content Backend
 * ──────────────────────────────────────────────────────────
 * Runs on Render.com (free tier).
 *
 * This server does two jobs:
 *  1. Acts as the Universal Editor Service endpoint — receives
 *     PATCH requests from the Adobe editor when authors save.
 *  2. Stores and serves content as JSON for the frontend to read.
 *
 * Endpoints:
 *   GET  /                  health check
 *   GET  /api/content       return full content JSON
 *   GET  /api/content/:key  return one content section
 *   PATCH /                 UE service protocol — receive edits
 *   PATCH /api/content      update content directly (for testing)
 *   GET  /corslib/LATEST    serves the UE cors.js (proxy to Adobe CDN)
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Content store ──────────────────────────────────────────
// In production swap this for a real DB (MongoDB, Postgres, etc.)
// For this demo we read from content.json on disk and keep a
// live in-memory copy so edits survive without a restart.
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

// ── Middleware ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// CORS — allow the Adobe editor (experience.adobe.com) and
// your Cloudflare Pages domain.
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      'https://experience.adobe.com',
      'https://universal-editor-service.adobe.io',
      // Add your Cloudflare Pages URL:
      process.env.FRONTEND_URL || '*',
    ];
    if (!origin || allowed.includes('*') || allowed.some(o => origin.startsWith(o.replace('*', '')))) {
      cb(null, true);
    } else {
      cb(null, true); // allow all for demo — restrict in production
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Forwarded-Host',
                   'X-Adobe-Event', 'X-Adobe-Event-Id'],
  credentials: true,
}));

// ── Health check ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'NovaTech UE Demo Backend',
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

// ── Content API ────────────────────────────────────────────
// GET /api/content — return all content
app.get('/api/content', (req, res) => {
  res.json(content);
});

// GET /api/content/:key — return one section (e.g. /api/content/hero)
app.get('/api/content/:key', (req, res) => {
  const section = content[req.params.key];
  if (section === undefined) {
    return res.status(404).json({ error: 'Section not found' });
  }
  res.json(section);
});

// PATCH /api/content — direct update (for Postman testing)
// Body: { "key": "hero", "prop": "headline", "value": "Hello World" }
app.patch('/api/content', (req, res) => {
  const { key, prop, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });

  if (!content[key]) content[key] = {};
  if (prop) {
    content[key][prop] = value;
  } else {
    content[key] = { ...content[key], ...req.body };
  }

  saveContent(content);
  res.json({ ok: true, updated: { key, prop, value } });
});

// ── Universal Editor Service Protocol ─────────────────────
//
// When an author edits something in the UE canvas and hits save,
// the editor sends a PATCH (or POST) request to the service URL
// configured in the meta tag:
//   <meta name="urn:adobe:aue:config:service" content="https://your-backend.onrender.com">
//
// Body shape the UE sends:
// {
//   "connections": [{ "name": "demobackend", "protocol": "demobackend", "uri": "..." }],
//   "target": {
//     "resource": "urn:demobackend:/content/hero",
//     "prop": "headline",
//     "type": "text"
//   },
//   "patch": [{ "op": "replace", "path": "/headline", "value": "New headline" }]
// }
//
// We parse the resource URN to find the content key, then apply the patch.
// ────────────────────────────────────────────────────────────
app.patch('/', handleUEPatch);
app.post('/', handleUEPatch);   // some UE versions use POST

function handleUEPatch(req, res) {
  try {
    const body = req.body;
    console.log('[UE PATCH]', JSON.stringify(body, null, 2));

    const target = body.target || {};
    const patches = body.patch || [];

    // Parse the resource URN: urn:demobackend:/content/hero  →  "hero"
    // or urn:demobackend:/content/features/1  →  "features" (array index 0)
    const resource = target.resource || '';
    const contentPath = resource.replace(/^urn:[^:]+:/, '');   // strip urn prefix
    const parts = contentPath.replace(/^\/content\//, '').split('/');
    // parts[0] = section key (e.g. "hero", "features", "team")
    // parts[1] = optional array index (e.g. "1" for features/1)

    const sectionKey = parts[0];
    const arrayIndex = parts[1] ? parseInt(parts[1], 10) - 1 : null;

    if (!sectionKey || !content.hasOwnProperty(sectionKey)) {
      return res.status(404).json({ error: `Unknown content section: ${sectionKey}` });
    }

    // Apply each patch operation
    patches.forEach(op => {
      if (op.op !== 'replace' && op.op !== 'add') return;

      // op.path looks like "/headline" or "/title"
      const prop = op.path.replace(/^\//, '');
      const value = op.value;

      if (arrayIndex !== null && Array.isArray(content[sectionKey])) {
        if (!content[sectionKey][arrayIndex]) {
          content[sectionKey][arrayIndex] = {};
        }
        content[sectionKey][arrayIndex][prop] = value;
      } else {
        content[sectionKey][prop] = value;
      }
    });

    // Also handle simple single-prop updates from the editor
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

    // UE expects a 200 with the updated resource
    res.status(200).json({
      ok: true,
      resource: target.resource,
      updated: content[sectionKey],
    });

  } catch (err) {
    console.error('[UE PATCH error]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── UE Details endpoint ────────────────────────────────────
// The UE editor sometimes calls /details to get metadata
// about a resource (used for the Properties panel).
app.get('/details', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/details', (req, res) => {
  const { connections, target } = req.body || {};
  // Return minimal metadata so the Properties panel renders
  res.json({
    resource: target?.resource,
    properties: {},
  });
});

// ── CORS library proxy (optional convenience) ──────────────
// If you ever point cors.js at this backend, we proxy it.
app.get('/corslib/LATEST', async (req, res) => {
  try {
    const { default: https } = await import('https');
    https.get('https://universal-editor-service.adobe.io/cors.js', r => {
      res.setHeader('Content-Type', 'application/javascript');
      r.pipe(res);
    }).on('error', () => res.status(503).send(''));
  } catch {
    res.status(503).send('');
  }
});

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ NovaTech UE Backend running on port ${PORT}`);
  console.log(`   Content API:  http://localhost:${PORT}/api/content`);
  console.log(`   UE Service:   http://localhost:${PORT}/  (PATCH)`);
});
