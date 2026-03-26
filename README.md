# NovaTech — Adobe Universal Editor Demo
### Frontend: Cloudflare Pages → Backend: Render.com

---

## How Adobe Universal Editor Works

The editor at `experience.adobe.com` is a **3-layer system**:

```
[Adobe Editor UI]   ← iframe loads your app, overlays click handles
       ↕
[Your Frontend]     ← includes cors.js; HTML tagged with data-aue-* attributes
       ↕
[Your UE Service]   ← receives PATCH when author saves; reads/writes content JSON
```

Your HTML elements get `data-aue-*` attributes to make them editable:
- `data-aue-resource` — URN of the content item (maps to your backend)
- `data-aue-prop` — which field/property is being edited
- `data-aue-type` — `text`, `richtext`, or `image`
- `data-aue-label` — friendly label shown in the editor panel
- `data-aue-type="container"` — allows adding/removing child components

---

## Step 1 — Deploy the Backend to Render.com

1. Push the `backend/` folder to a GitHub repo.
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your repo. Set:
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Environment variable**: `FRONTEND_URL=https://your-pages-site.pages.dev`
4. Deploy. Note your URL: `https://YOUR_APP.onrender.com`

Test it:
```bash
curl https://YOUR_APP.onrender.com/api/content
```

---

## Step 2 — Update the Frontend

In `frontend/index.html`, replace **both** occurrences of `YOUR_BACKEND_URL`:

```html
<!-- Connection source meta tag -->
<meta name="urn:adobe:aue:system:demobackend"
      content="demobackend:https://YOUR_APP.onrender.com" />

<!-- UE service endpoint -->
<meta name="urn:adobe:aue:config:service"
      content="https://YOUR_APP.onrender.com" />
```

Also update the JS variable at the bottom:
```js
const BACKEND = 'https://YOUR_APP.onrender.com';
```

---

## Step 3 — Deploy the Frontend to Cloudflare Pages

1. Push the `frontend/` folder to a GitHub repo.
2. Go to [Cloudflare Pages](https://pages.cloudflare.com) → **Create application → Pages**
3. Connect your repo. Settings:
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: `/` (or just use the root)
4. Deploy. You'll get a URL like `https://novatech-demo.pages.dev`

The `_headers` file is already configured to allow the Adobe editor
to load your page in its iframe.

---

## Step 4 — Open in Universal Editor

Open the editor with your page URL:

```
https://experience.adobe.com/#/aem/editor/canvas/YOUR_PAGES_URL
```

For example:
```
https://experience.adobe.com/#/aem/editor/canvas/https://novatech-demo.pages.dev
```

You should see your page load inside the editor canvas. Click any text
element — the editor will show a properties panel on the right where
you can edit it. Click **Publish** (or wait for auto-save) and the
backend persists the change.

---

## Local Development

**Run the backend:**
```bash
cd backend
npm install
npm run dev
# → Listening on http://localhost:3001
```

**Serve the frontend with HTTPS** (required by the editor):
```bash
npm install -g local-ssl-proxy serve
serve frontend -p 3000 &
local-ssl-proxy --source 3001 --target 3000
```

**Open the editor pointing to localhost:**
```
https://experience.adobe.com/#/aem/editor/canvas/https://localhost:3001
```

(Accept the self-signed cert warning in your browser first.)

---

## What's Editable

| Section | Fields |
|---------|--------|
| **Hero** | Badge, Headline, Description (rich text), Primary CTA, Secondary CTA |
| **Stats** | All 3 stat numbers + labels |
| **Features header** | Eyebrow label, Heading |
| **Feature cards** | Icon (emoji), Title, Description (per card) |
| **Team header** | Eyebrow, Heading |
| **Team members** | Avatar emoji, Name, Role, Bio (per member) |
| **CTA banner** | Headline, Sub-text, Button label |

---

## Testing the Backend Directly

```bash
# Get all content
curl https://YOUR_APP.onrender.com/api/content

# Update a field directly (bypassing the editor)
curl -X PATCH https://YOUR_APP.onrender.com/api/content \
  -H "Content-Type: application/json" \
  -d '{"key":"hero","prop":"headline","value":"Hello from API!"}'

# Simulate a UE PATCH (what the editor sends when you save)
curl -X PATCH https://YOUR_APP.onrender.com/ \
  -H "Content-Type: application/json" \
  -d '{
    "connections": [{"name":"demobackend","protocol":"demobackend","uri":"https://YOUR_APP.onrender.com"}],
    "target": {
      "resource": "urn:demobackend:/content/hero",
      "prop": "headline",
      "type": "text"
    },
    "patch": [{"op":"replace","path":"/headline","value":"Updated via UE protocol!"}]
  }'
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Adobe Universal Editor (experience.adobe.com)        │
│  • WYSIWYG canvas (your page in an iframe)            │
│  • Click handles on data-aue-* elements               │
│  • Properties panel on the right                      │
└────────────────┬─────────────────┬───────────────────┘
                 │ iframe           │ PATCH /
                 ▼                  ▼
┌────────────────────┐  ┌──────────────────────────────┐
│  Cloudflare Pages   │  │  Render.com Express Server    │
│  index.html        │  │  • UE service endpoint         │
│  + cors.js         │  │  • GET /api/content            │
│  + data-aue-* tags │  │  • PATCH / (UE protocol)       │
│                    │  │  • content.json store          │
└────────────────────┘  └──────────────────────────────┘
```
