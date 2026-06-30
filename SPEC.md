# Upstream Property — Council Routine Inspection Report Tool

Working spec, v0. Built for Upstream Property (Dave is the primary user; Nick owns branding).

---

## What we're building

A mobile-first web app that lets an Upstream inspector walk a council property, capture flagged action items with photos, and produce a professionally branded Word document that's emailed for internal review before going to council.

**Current scope:** Council Routine Inspection Report only. Architecture should allow other report types later without rework.

---

## End-to-end flow

1. Inspector signs in with Microsoft 365 (Upstream's tenant).
2. Picks report type → Council Routine Inspection Report.
3. Picks property from a list. (Properties are pre-registered with their OneDrive folder location.)
4. App creates a subfolder in that property's OneDrive folder, named `YYYY-MM-DD - Council Inspection`.
5. On site, inspector creates **action items** one at a time:
   - Enter Area (with quick-pick chips for areas already used in this inspection)
   - Enter Comment (voice-to-text supported)
   - Take one or more photos for that item
   - "Done — next item" or "Add another photo"
6. Photos are stored locally first and uploaded to OneDrive in the background. Works offline.
7. Back at the office, inspector reviews/edits items, then hits **Generate Report**.
8. Server fills a branded `.docx` template with action items, photos, and sign-off (signature stored once per user).
9. Generated doc is saved to the same OneDrive subfolder, and an Outlook draft is created addressed to Dave with the doc attached. Inspector hits Send manually.

---

## WordPress integration

The existing `upstreamproperty.com` WordPress site stays untouched.

- App deploys to a subdomain: `app.upstreamproperty.com` (or `reports.upstreamproperty.com`).
- WordPress nav gets a "Staff Login" link pointing to the subdomain.
- Two separate codebases, zero coupling. CNAME on the subdomain → Vercel.

Visual branding (colours, fonts, logo) lifted from the WP site so the app feels like part of Upstream.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Hosting | Vercel |
| Auth | NextAuth.js with Entra ID provider |
| Microsoft APIs | `@microsoft/microsoft-graph-client` |
| OneDrive folder picker | OneDrive File Picker SDK v8 |
| Database | Supabase (Postgres) |
| File storage (signatures only) | Supabase Storage |
| Offline photo queue | IndexedDB via the `idb` library |
| Service worker / PWA | `@serwist/next` |
| Doc generation | `docxtemplater` + `docxtemplater-image-module-free` |

Photos live in OneDrive, not Supabase — Upstream owns the source files.

---

## Data model

```sql
users
  id, m365_oid (unique), email, name, position,
  signature_path, created_at

properties
  id, name, address, onedrive_drive_id, onedrive_folder_id,
  council_name, created_at

inspections
  id, property_id, user_id, inspection_date,
  onedrive_subfolder_id,
  status,                          -- draft | generated | sent
  generated_doc_onedrive_id,
  created_at

action_items
  id, inspection_id, area, comment, sort_order, created_at

photos
  id, action_item_id,
  local_uuid,                      -- generated on device at capture
  onedrive_file_id,                -- null until uploaded
  filename,
  sync_status,                     -- pending | uploaded | failed
  taken_at
```

Notes:
- `m365_oid` is the Entra Object ID — stable identifier, survives email changes.
- `local_uuid` is created the instant a photo is captured, before any network call. This is what makes the offline queue work.
- `inspections.status` drives the UI state.

---

## Routes

```
/                          → redirect to /dashboard or /login
/login                     → M365 sign in
/dashboard                 → "New Inspection" + recent inspections
/properties                → list + "Add property"
/properties/new            → name, address, OneDrive folder picker
/inspect/new               → pick report type → pick property → create subfolder → redirect
/inspect/[id]              → working screen (3 tabs)
/inspect/[id]/generate     → preview, generate, send
/account                   → signature capture, name, position
```

All authenticated users can do everything (no admin role for v1).

---

## The `/inspect/[id]` screen — three tabs

### Capture (default)

- Header shows: property name, date, photo count, sync status pill (`✓ Synced` or `⟳ 3 pending`).
- Primary card: **"+ Start new action item"**.
- Tapping it opens a form:
  - **Area** — text input with chip row of areas already used in this inspection for one-tap autofill.
  - **Comment** — textarea with voice-to-text (browser speech API).
- Saving unlocks the camera.
- Camera view: full-screen, single big shutter button, thumbnail strip of the current item's photos at the bottom.
- After each photo: **Take another** (stays in camera) or **Done — next item** (back to the start-new-item card).

### Items

- Vertical list of all action items, grouped by area.
- Each row: area, comment, photo thumbnails, edit/delete.
- Drag-to-reorder sets `sort_order`.

### Generate

- Disabled until ≥1 action item exists and all photos have synced.
- **Generate Report** → server pulls action items + photos → fills template → uploads `.docx` to the inspection's OneDrive subfolder → sets `status = generated`.
- Preview pane.
- **Send to Dave for review** → creates an Outlook draft via Graph (`/me/messages` with attachment) → opens in Outlook → inspector hits Send manually.

---

## Offline sync

```
Capture flow:
  1. Take photo → blob in memory
  2. Resize client-side to 1920px long edge (~300KB)
  3. INSERT into IndexedDB: { local_uuid, action_item_id, blob, status: 'pending' }
  4. INSERT into Supabase photos row with onedrive_file_id = null
  5. Trigger upload worker (don't await)
  6. UI updates immediately — inspector can take next photo

Upload worker (runs continuously while app is open):
  - Reads pending items from IndexedDB
  - PUT to Graph /me/drives/{drive}/items/{folder}:/filename.jpg:/content
  - On success: set onedrive_file_id, delete blob from IndexedDB
  - On failure: exponential backoff + retry
  - On reconnect (online event): kick the queue
```

Background Sync API is unreliable on iOS Safari. Retry on app-open and on the `online` event instead. Covers 95% of real cases.

---

## PWA

Built as a Progressive Web App so it installs to home screen on iOS/Android with its own icon, runs full-screen, and works offline. Single codebase, no app stores. Service worker via `@serwist/next`.

---

## Word document template

Owned by Upstream (Nick on branding). Built as a real `.docx` using Word styles, with Jinja-style placeholders:

```
{{property_name}}
{{inspection_date}}
{% for item in action_items %}
  {{item.area}} — {{item.comment}}
  {%image item.photos[0]%} {%image item.photos[1]%}
{% endfor %}
{{inspector_name}}
{{inspector_position}}
{%image signature%}
```

Branding consistency = template owns the brand, code just fills it in.

Template can be done later. Code uses a placeholder template until then.

---

## Confirmed decisions

- Area + comment entered upfront, before camera unlocks. (Dave's call.)
- One action item can have multiple photos.
- Inspector picks the OneDrive parent folder per property via the OneDrive File Picker. Stored against the property.
- Folder naming: `YYYY-MM-DD - Council Inspection`.
- Signature captured once per user, stored, reused on every report.
- One report format for all councils (for now).
- Generated doc lands back in the same OneDrive subfolder as the photos.
- Approval flow = generate doc → Outlook draft to Dave → inspector sends manually. No in-app approval state machine.
- Everyone on the Upstream tenant can do everything. No admin role for v1.
- Photos resized client-side to 1920px long edge before upload.
- Deployed to a subdomain off `upstreamproperty.com`. WordPress untouched.

---

## Build estimate

Working with Claude Code:

| Chunk | Time |
|---|---|
| Auth + property CRUD + OneDrive picker | ~½ day |
| Capture flow + offline queue | ~1 day |
| Doc generation + Outlook draft | ~½ day (once template exists) |
| Mobile testing + polish + edge cases | ~1 day |

**~3 days to something usable**, plus template work whenever Nick delivers branding.

External unknowns (not coding time): Entra app registration approval on Upstream's tenant, branded `.docx` template.

---

## Open items to pick up later

- Branded Word template from Nick.
- Per-council template variants (not needed for v1, but `properties.council_name` is already in the schema so it's easy when it comes).
- Other report types beyond council routine inspections.
- Whether to add an admin role later (only if Dave asks).