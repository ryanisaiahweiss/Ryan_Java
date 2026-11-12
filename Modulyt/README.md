# Modulyt

A home for engineering dashboards. First dashboard: **Engineering Requirements**.

## Run

```powershell
py modulyt.py requirements      # serves http://127.0.0.1:8765 and opens the dashboard
py modulyt.py --no-browser      # just serve; --port 9000 to change the port
```

No dependencies beyond Python 3.10+ except `openpyxl` (Excel import): `py -m pip install -r requirements.txt`.
Edit any JSON file in `Data/` by hand and open pages update live.

## Layout

| Path | Purpose | Reusable? |
|---|---|---|
| `modulyt.py` | launcher | yes |
| `core/server.py` | HTTP server, generic REST API, live updates (SSE), dashboard discovery | yes |
| `core/store.py` | `JsonStore` (atomic writes, change detection). Swap for a PostgreSQL store later | yes |
| `shared/static/` | dark theme CSS, JS helpers (API client, live updates, modal forms) | yes |
| `dashboards/<name>/` | `dashboard.json`, `hooks.py` (business rules), `index.html`, `app.js` | one per dashboard |
| `Data/<name>/*.json` | data, one file per collection | |

## Adding a dashboard

1. Create `dashboards/<name>/dashboard.json` with `title`, `description`, `collections`.
2. Add `index.html` (include `/static/modulyt.css` and `/static/modulyt.js`) and an `app.js`.
3. Optionally add `hooks.py` with `before_save`, `before_delete`, `after_delete`.

It appears on the home page automatically. The documents tracker and events planner follow this pattern.

## Requirements dashboard

- **Modules** (Aircraft, System, Subsystem, Component, Software, Verification) are data, not code. Use **+ Module** to add any level. Each has an ID prefix used for unique, auto-generated requirement IDs (`SYS-0001`).
- Pick any two modules for the left and right columns.
- **Cross-filtering**: text in one filter box filters that column and auto-filters the other to the traced requirements. Text in both boxes turns auto-filtering off so each column filters independently.
- **Selection** highlights traced requirements in the other column. **Drag** a requirement onto one in the other column to trace them instantly (the higher-level module becomes the parent). Ctrl+click still toggles a trace.
- **Edit** with the ✎ button or by double-clicking. **Duplicate** (⧉) copies a requirement and lets you choose whether to bring its tags, source documents and traces along.
- **Source documents**: attach Object Tracker documents to a requirement; click the 📄 chip to preview the document beside the dashboard.
- Rows show trace counts, or a **no trace** badge (a first gap check).
- **Authors** are stored in `authors.json`; the author picker in the header is the current author for new requirements. Can become real accounts and roles later.
- Each edit that changes wording or status bumps the revision and keeps the previous version in `history`.

## Object Tracker

Tracks documents or any other objects. Types (Procedure, Venue, ...) are data, and each type has its own status list (default In Work / Under Review / Released; **Edit type** changes it). Objects have an ID/name (hyperlinked when a URL is set), title, author, status, notes and tags. Attach a copy (PDF, images, text, HTML preview inline) and use 👁 to preview it. Many websites refuse to be embedded, so for those attach a copy instead.

## Excel import

Both dashboards have an **Import Excel** button. One sheet per type/module; the first row holds headers (case and punctuation are ignored).

| Dashboard | Sheet name | Columns recognised |
|---|---|---|
| Object Tracker | the type (created if new) | ID/Name/Document ID, Title, URL/Link, Author, Status, Notes, Tags (an old Disposition column is appended to Notes). A hyperlink embedded in the ID cell becomes the URL. |
| Requirements | the module ID or name (created if new; a short sheet name like `SYS` picks the module ID) | ID, Text/Requirement, Author, Status, Tags, Parent (IDs this traces from), Children (IDs this traces to) |

Re-importing updates rows with the same ID instead of duplicating them. A summary lists anything skipped.

## Roadmap (from the DOORS feature list)

Done in prototype: storage, parent-child links, unique IDs, basic revision history, gap badges.
Next: Excel import, verification tests and status, gap/coverage reports, baselines, PostgreSQL store.
