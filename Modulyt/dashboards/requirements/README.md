# Engineering Requirements dashboard

Write, trace and review engineering requirements across configurable levels (modules), with live cross-filtering. Part of [Modulyt](../../README.md). In-app help: open **Help & FAQ** in the dashboard header.

## Run

```powershell
cd C:\Users\ryanw\Modulyt
py -m pip install -r requirements.txt   # first time only
py modulyt.py requirements              # or double-click launch.bat
```

Opens `http://127.0.0.1:8765/d/requirements/`.

## Features

- **Modules** (Aircraft, System, Subsystem, Component, Software, Verification are seeded; add any with **+ Module**). Each has a level (ordering) and an ID prefix for generated IDs such as `SYS-0001`.
- **Two to six columns**, each showing any module, scrolling sideways when needed. Order columns top-down.
- **Cross-filtering across all columns**: text in some columns filters those independently; the rest follow traces outward through neighbouring columns; text in every column turns the automatic filtering off.
- **Trace highlighting**: selecting a requirement highlights direct traces (solid) and the rest of its up/down chain (dashed).
- **Tracing**: drag a requirement onto another in a different column, or Ctrl+click.
- **Gap hints**: per-row trace counts to neighbouring columns, red badge when there are none.
- **Editing**: double-click or ✎; duplicate (⧉) with optional copy of tags, source documents and traces; delete removes its traces.
- **Revisions**: wording or status changes increment `revision` and archive the previous version in `history`.
- **Authors**: stored list, picked in the header and stamped on new requirements.
- **Tags** and **source documents** (linked to Object Tracker documents, previewable).
- **Excel import** (one sheet per module; see Help & FAQ for headings, including Parent/Children trace columns).

## Files

| Path | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | the page; filtering logic is the pure `compute()` function in `app.js` |
| `help.html` | in-app Help & FAQ |
| `hooks.py` | server-side rules: ID generation, validation, revisions, trace clean-up, Excel import |
| `dashboard.json` | title and data collections |
| `../../Data/requirements/` | `modules.json`, `requirements.json`, `links.json`, `authors.json` |

## Data model

```
modules       {id, name, prefix, level, description}
requirements  {id, module, text, author, status, tags[], documents[], created, modified, revision, history[]}
links         {id: "PARENT>CHILD", parent, child}
authors       {id, name, role}
```

`documents` holds Object Tracker object IDs. Statuses: Draft, Review, Approved, Obsolete.

## Known limits

- No sign-in or permissions; concurrent edits to the same requirement overwrite each other.
- IDs and modules cannot be changed after creation; modules cannot be edited or deleted once they contain requirements.
- Filtering only spreads between neighbouring columns.

## Planned

Verification methods (Test, Inspection, Analysis, Demonstration) with results and coverage/gap reports, baselines, actionable items linked to external trackers, PostgreSQL storage.
