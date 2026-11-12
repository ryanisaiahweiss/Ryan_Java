"""Business rules for the requirements dashboard.

The server calls these around every save/delete/import. Raise ValidationError to reject a change.
(ValidationError is injected by the server when this file is loaded.)

Data model
    modules       {id, name, prefix, level, description}   level orders modules (0 = top)
    requirements  {id, module, text, author, status, tags[], documents[], created, modified,
                   revision, history[]}     documents = ids of Object Tracker objects (sources)
    links         {id, parent, child}                      parent traces down to child
    authors       {id, name, role}
"""
import re
from datetime import datetime, timezone

from core.xlsx import pick, read_workbook

STATUSES = ["Draft", "Review", "Approved", "Obsolete"]


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _next_id(prefix, requirements):
    highest = 0
    for r in requirements:
        m = re.fullmatch(re.escape(prefix) + r"-(\d+)", r.get("id", ""))
        if m:
            highest = max(highest, int(m.group(1)))
    return f"{prefix}-{highest + 1:04d}"


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _split(value):
    if isinstance(value, str):
        value = re.split(r"[,;\n]", value)
    return value or []


def _clean_tags(tags):
    seen, out = set(), []
    for t in _split(tags):
        t = re.sub(r"\s+", " ", str(t)).strip().lower()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _clean_ids(ids):
    out = []
    for i in _split(ids):
        i = str(i).strip()[:200]
        if i and i not in out:
            out.append(i)
    return out


def before_save(collection, item, store):
    handler = {
        "modules": _save_module,
        "requirements": _save_requirement,
        "links": _save_link,
        "authors": _save_author,
    }.get(collection)
    return handler(item, store) if handler else item


def _save_module(item, store):
    name = str(item.get("name", "")).strip()
    mid = re.sub(r"[^A-Za-z0-9_-]", "", str(item.get("id", "")).strip().upper())
    if not name or not mid:
        raise ValidationError("Module needs an ID and a name")
    try:
        level = int(item.get("level", 0))
    except (TypeError, ValueError):
        raise ValidationError("Level must be a whole number")
    prefix = re.sub(r"[^A-Za-z0-9]", "", str(item.get("prefix") or mid).upper()) or mid
    for m in store.read("modules"):
        if m["id"] != mid and m.get("prefix") == prefix:
            raise ValidationError(f"Prefix '{prefix}' is already used by module {m['id']}")
    return {"id": mid, "name": name, "prefix": prefix, "level": level,
            "description": str(item.get("description", "")).strip()}


def _revised(existing, text, status, author, tags, documents, now):
    """Existing requirement with new content; wording/status changes bump the revision."""
    changed = (existing["text"], existing["status"]) != (text, status)
    history = list(existing.get("history", []))
    if changed:
        history.append({"revision": existing.get("revision", 1), "text": existing["text"],
                        "status": existing["status"], "author": existing.get("author", ""),
                        "modified": existing.get("modified", "")})
    return {**existing, "text": text, "status": status, "author": author or existing.get("author", ""),
            "tags": tags, "documents": documents,
            "modified": now if changed else existing.get("modified", now),
            "revision": existing.get("revision", 1) + (1 if changed else 0), "history": history}


def _fresh(rid, module_id, text, status, author, tags, documents, now):
    return {"id": rid, "module": module_id, "text": text, "author": author, "status": status,
            "tags": tags, "documents": documents, "created": now, "modified": now,
            "revision": 1, "history": []}


def _save_requirement(item, store):
    text = str(item.get("text", "")).strip()
    if not text:
        raise ValidationError("Requirement text is required")
    status = item.get("status") or "Draft"
    if status not in STATUSES:
        raise ValidationError(f"Status must be one of {', '.join(STATUSES)}")
    author = str(item.get("author", "")).strip()
    tags, documents = _clean_tags(item.get("tags")), _clean_ids(item.get("documents"))
    now = _now()
    requirements = store.read("requirements")
    existing = next((r for r in requirements if r["id"] == item.get("id")), None)
    if existing:
        # The module (and so the ID prefix) of an existing requirement never changes.
        return _revised(existing, text, status, author, tags, documents, now)
    module = next((m for m in store.read("modules") if m["id"] == item.get("module")), None)
    if not module:
        raise ValidationError("Unknown module")
    return _fresh(_next_id(module["prefix"], requirements), module["id"], text, status, author, tags, documents, now)


def _save_link(item, store):
    parent, child = item.get("parent"), item.get("child")
    if not parent or not child or parent == child:
        raise ValidationError("A link needs two different requirements")
    ids = {r["id"] for r in store.read("requirements")}
    if parent not in ids or child not in ids:
        raise ValidationError("Both requirements must exist")
    return {"id": f"{parent}>{child}", "parent": parent, "child": child}


def _save_author(item, store):
    name = str(item.get("name", "")).strip()
    if not name:
        raise ValidationError("Author name is required")
    return {"id": item.get("id") or _slug(name), "name": name, "role": str(item.get("role", "")).strip()}


def before_delete(collection, item_id, store):
    if collection == "modules":
        if any(r["module"] == item_id for r in store.read("requirements")):
            raise ValidationError("Module still contains requirements")


def after_delete(collection, item_id, store):
    if collection == "requirements":  # never leave dangling trace links
        links = [l for l in store.read("links") if item_id not in (l["parent"], l["child"])]
        store.write("links", links)


# ---------------------------------------------------------------- Excel import
ID = ("id", "requirement id", "req id", "identifier", "number")
TEXT = ("text", "requirement", "requirement text", "wording", "description", "statement", "shall statement")
AUTHOR = ("author", "owner", "responsible")
STATUS = ("status", "state")
TAGS = ("tags", "tag", "labels", "label")
PARENTS = ("parent", "parents", "parent id", "parent ids", "traces from", "derived from", "satisfies")
CHILDREN = ("child", "children", "child id", "child ids", "traces to", "allocated to")


def _module_for_sheet(sheet_name, modules, messages):
    key = sheet_name.strip().lower()
    for m in modules:
        if key in (m["id"].lower(), m["name"].lower()):
            return m
    first = re.sub(r"[^A-Za-z0-9]", "", (sheet_name.split() or ["MOD"])[0]).upper()[:4] or "MOD"
    mid, n = first, 2
    while any(m["id"] == mid or m["prefix"] == mid for m in modules):
        mid, n = f"{first}{n}", n + 1
    module = {"id": mid, "name": sheet_name.strip(), "prefix": mid,
              "level": max((m["level"] for m in modules), default=-1) + 1, "description": ""}
    modules.append(module)
    messages.append(f"Created module '{module['name']}' ({mid}). Name a sheet with a module ID to pick an existing one.")
    return module


def import_file(filename, data, store):
    """One sheet per module. Rows with an existing ID update that requirement; others are added.
    Optional Parent / Children columns hold requirement IDs and create trace links."""
    sheets = read_workbook(data)
    modules, requirements, links = store.read("modules"), store.read("requirements"), store.read("links")
    by_id = {r["id"]: r for r in requirements}
    link_ids = {l["id"] for l in links}
    created = updated = skipped = bad_status = 0
    messages, pending = [], []   # pending: (parent_ids, child_ids, own_id, label)
    now = _now()

    for sheet in sheets:
        text_cols = [h for h in sheet.headers if h in TEXT]
        if not text_cols:
            messages.append(f"Sheet '{sheet.name}' has no requirement text column (e.g. 'Text'); skipped")
            continue
        module = _module_for_sheet(sheet.name, modules, messages)
        for row in sheet.rows:
            text = pick(row.values, *TEXT)
            if not text:
                skipped += 1
                messages.append(f"{sheet.name} row {row.number}: no requirement text, skipped")
                continue
            raw_status = pick(row.values, *STATUS)
            status = next((s for s in STATUSES if s.lower() == raw_status.lower()), None) if raw_status else None
            if raw_status and not status:
                bad_status += 1
            author = pick(row.values, *AUTHOR)
            tags = _clean_tags(pick(row.values, *TAGS))
            rid = re.sub(r"\s+", "", pick(row.values, *ID))
            existing = by_id.get(rid) if rid else None
            if existing:
                new = _revised(existing, text, status or existing["status"], author,
                               tags or existing.get("tags", []), existing.get("documents", []), now)
                requirements[requirements.index(existing)] = new
                updated += 1
            else:
                rid = rid or _next_id(module["prefix"], requirements)
                new = _fresh(rid, module["id"], text, status or "Draft", author, tags, [], now)
                requirements.append(new)
                created += 1
            by_id[rid] = new
            pending.append((_clean_ids(pick(row.values, *PARENTS)), _clean_ids(pick(row.values, *CHILDREN)),
                            rid, f"{sheet.name} row {row.number}"))

    added = missing = 0
    for parents, children, rid, label in pending:   # resolve traces once every ID is known
        pairs = [(p, rid) for p in parents] + [(rid, c) for c in children]
        for parent, child in pairs:
            if parent == child:
                continue
            if parent not in by_id or child not in by_id:
                missing += 1
                messages.append(f"{label}: trace {parent} > {child} skipped (unknown requirement)")
                continue
            lid = f"{parent}>{child}"
            if lid not in link_ids:
                link_ids.add(lid)
                links.append({"id": lid, "parent": parent, "child": child})
                added += 1

    store.write("modules", modules)
    store.write("requirements", requirements)
    store.write("links", links)
    summary = [f"{created} requirements created, {updated} updated, {skipped} skipped; {added} trace links added"]
    if bad_status:
        summary.append(f"{bad_status} row(s) had an unrecognised status and were set to Draft")
    return {"messages": summary + messages[:50]}
