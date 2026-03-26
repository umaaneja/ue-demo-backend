/**
 * Adobe Universal Editor — Custom Service + Content Backend
 * ──────────────────────────────────────────────────────────
 * Runs on Render.com (free tier).
 * Single server handles both the UE Service protocol AND content storage.
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
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  const requestedHeaders = req.headers['access-control-request-headers'];
  res.header('Access-Control-Allow-Headers', requestedHeaders || 'Content-Type, Authorization');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Body parsing ───────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Field definitions ──────────────────────────────────────
// Tells the properties panel what input fields to show
// per component model (matches data-aue-model in index.html)
function getFieldDefs(modelId) {
  const models = {
    hero: [
      { name: 'badge',        label: 'Badge Text',      component: 'text',     valueType: 'string' },
      { name: 'headline',     label: 'Headline',        component: 'text',     valueType: 'string' },
      { name: 'description',  label: 'Description',     component: 'richtext', valueType: 'string' },
      { name: 'ctaPrimary',   label: 'Primary Button',  component: 'text',     valueType: 'string' },
      { name: 'ctaSecondary', label: 'Secondary Button',component: 'text',     valueType: 'string' },
    ],
    stats: [
      { name: 'stat1Value', label: 'Stat 1 Number', component: 'text', valueType: 'string' },
      { name: 'stat1Label', label: 'Stat 1 Label',  component: 'text', valueType: 'string' },
      { name: 'stat2Value', label: 'Stat 2 Number', component: 'text', valueType: 'string' },
      { name: 'stat2Label', label: 'Stat 2 Label',  component: 'text', valueType: 'string' },
      { name: 'stat3Value', label: 'Stat 3 Number', component: 'text', valueType: 'string' },
      { name: 'stat3Label', label: 'Stat 3 Label',  component: 'text', valueType: 'string' },
    ],
    'features-header': [
      { name: 'eyebrow', label: 'Eyebrow', component: 'text', valueType: 'string' },
      { name: 'title',   label: 'Heading', component: 'text', valueType: 'string' },
    ],
    feature: [
      { name: 'icon',        label: 'Icon (emoji)', component: 'text',     valueType: 'string' },
      { name: 'title',       label: 'Title',        component: 'text',     valueType: 'string' },
      { name: 'description', label: 'Description',  component: 'richtext', valueType: 'string' },
    ],
    'team-header': [
      { name: 'eyebrow', label: 'Eyebrow', component: 'text', valueType: 'string' },
      { name: 'title',   label: 'Heading', component: 'text', valueType: 'string' },
    ],
    'team-member': [
      { name: 'avatar', label: 'Avatar (emoji)', component: 'text',     valueType: 'string' },
      { name: 'name',   label: 'Name',           component: 'text',     valueType: 'string' },
      { name: 'role',   label: 'Role',           component: 'text',     valueType: 'string' },
      { name: 'bio',    label: 'Bio',            component: 'richtext', valueType: 'string' },
    ],
    cta: [
      { name: 'headline',   label: 'Headline', component: 'text', valueType: 'string' },
      { name: 'subtext',    label: 'Subtext',  component: 'text', valueType: 'string' },
      { name: 'buttonText', label: 'Button',   component: 'text', valueType: 'string' },
    ],
  };
  return models[modelId] || [
    { name: 'text', label: 'Text', component: 'text', valueType: 'string' },
  ];
}

// ── Helper: parse resource URN ─────────────────────────────
// "urn:demobackend:/content/hero"       → { sectionKey: 'hero',     arrayIndex: null }
// "urn:demobackend:/content/features/1" → { sectionKey: 'features', arrayIndex: 0    }
function parseResource(resource) {
  const contentPath = resource.replace(/^urn:[^:]+:/, '');
  const parts       = contentPath.replace(/^\/content\//, '').split('/');
  return {
    sectionKey: parts[0] || '',
    arrayIndex: parts[1] ? parseInt(parts[1], 10) - 1 : null,
  };
}

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

app.get('/details', (req, res) => {
  console.log('[GET /details]');
  res.json({ status: 'ok', properties: {} });
});

// /details — Adobe calls this when a component is clicked
// Returns: current field values + field definitions for the properties panel
app.post('/details', (req, res) => {
  console.log('[POST /details]', JSON.stringify(req.body, null, 2));
  try {
    const target   = req.body?.target || {};
    const resource = target.resource  || '';
    const model    = target.model     || '';

    const { sectionKey, arrayIndex } = parseResource(resource);

    // Get current field values from content store
    let currentData = {};
    if (sectionKey && content[sectionKey]) {
      const section = content[sectionKey];
      currentData = (arrayIndex !== null && Array.isArray(section))
        ? (section[arrayIndex] || {})
        : section;
    }

    // Get field definitions for this model
    const fieldDefs = getFieldDefs(model || sectionKey);

    res.json({
      resource,
      properties: currentData,      // pre-fills the input values
      model: {
        id:     model || sectionKey,
        fields: fieldDefs,           // tells editor what inputs to show
      },
    });

  } catch (err) {
    console.error('[/details error]', err.message);
    // Always 200 — never crash the properties panel
    res.json({ resource: '', properties: {}, model: { fields: [] } });
  }
});

// /update — called when author saves an edit in the canvas
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

    const resource = target.resource || '';
    const { sectionKey, arrayIndex } = parseResource(resource);

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
