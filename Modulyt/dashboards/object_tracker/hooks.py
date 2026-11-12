"""Business rules for the object tracker.

Data model
    types    {id, name, statuses[]}   what kind of object; each type has its own status list
    objects  {id, type, ref, title, url, file, author, status, notes, tags[], created, modified}
             ref  = the document ID / name you recognise it by
             url  = optional web link (ref becomes a hyperlink)
             file = optional attached copy {name, stored} for in-tool preview
(ValidationError is injected by the server when this file is loaded.)
"""
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from core.xlsx import pick, read_workbook

DEFAULT_STATUSES = ["In Work", "Under Review", "Released"]
STORED_NAME = re.compile(r"^[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}$")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _split(text):
    if isinstance(text, str):
        text = re.split(r"[,;\n]", text)
    return text or []


def _clean_tags(tags):
    seen, out = set(), []
    for t in _split(tags):
        t = re.sub(r"\s+", " ", str(t)).strip().lower()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _clean_statuses(statuses):
    out = []
    for s in _split(statuses):
        s = re.sub(r"\s+", " ", str(s)).strip()
        if s and s.lower() not in [x.lower() for x in out]:
            out.append(s)
    return out or list(DEFAULT_STATUSES)


def _valid_url(url):
    p = urlparse(url)
    # Only web links: blocks javascript: and other schemes that would run when clicked.
    return p.scheme in ("http", "https") and bool(p.netloc)


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def before_save(collection, item, store):
    if collection == "types":
        return _save_type(item, store)
    if collection == "objects":
        return _save_object(item, store)
    return item


def _save_type(item, store):
    name = str(item.get("name", "")).strip()
    if not name:
        raise ValidationError("Type name is required")
    tid = item.get("id") or _slug(name)
    if not tid:
        raise ValidationError("Type name needs letters or digits")
    return {"id": tid, "name": name, "statuses": _clean_statuses(item.get("statuses"))}


def _save_object(item, store):
    ref = str(item.get("ref", "")).strip()
    if not ref:
        raise ValidationError("An ID or name is required")
    otype = next((t for t in store.read("types") if t["id"] == item.get("type")), None)
    if not otype:
        raise ValidationError("Unknown type")
    url = str(item.get("url", "")).strip()
    if url and not _valid_url(url):
        raise ValidationError("URL must start with http:// or https://")
    existing = next((o for o in store.read("objects") if o["id"] == item.get("id")), None)

    statuses = otype.get("statuses") or DEFAULT_STATUSES
    status = item.get("status") or statuses[0]
    if status not in statuses and not (existing and existing.get("status") == status):
        raise ValidationError(f"Status for {otype['name']} must be one of: {', '.join(statuses)}")

    file = item.get("file") or None
    if file:
        stored = file.get("stored", "") if isinstance(file, dict) else ""
        if not STORED_NAME.match(stored) or not (store.dir / "files" / stored).is_file():
            raise ValidationError("Attached file not found; upload it again")
        file = {"name": str(file.get("name") or stored)[:120], "stored": stored}
    old = existing.get("file") if existing else None
    if old and (not file or file["stored"] != old["stored"]):  # replaced: drop the previous copy
        (store.dir / "files" / old["stored"]).unlink(missing_ok=True)

    now = _now()
    return {
        "id": existing["id"] if existing else uuid.uuid4().hex[:10],
        "type": otype["id"], "ref": ref,
        "title": str(item.get("title", "")).strip(),
        "url": url, "file": file,
        "author": str(item.get("author", "")).strip(),
        "status": status,
        "notes": str(item.get("notes", "")).strip(),
        "tags": _clean_tags(item.get("tags")),
        "created": existing["created"] if existing else now,
        "modified": now,
    }


def before_delete(collection, item_id, store):
    if collection == "types" and any(o["type"] == item_id for o in store.read("objects")):
        raise ValidationError("Type still has objects")
    if collection == "objects":  # remove the attached copy along with the record
        obj = next((o for o in store.read("objects") if o["id"] == item_id), None)
        if obj and obj.get("file"):
            (store.dir / "files" / obj["file"]["stored"]).unlink(missing_ok=True)


# ---------------------------------------------------------------- Excel import
REF = ("id", "document id", "doc id", "document", "document name", "document number", "doc number",
       "number", "name", "ref", "reference", "identifier")
TITLE = ("title", "document title", "description")
URL = ("url", "link", "hyperlink", "location")
AUTHOR = ("author", "owner", "responsible", "poc")
STATUS = ("status", "state")
NOTES = ("notes", "note", "comments", "comment")
TAGS = ("tags", "tag", "labels", "label")
DISPOSITION = ("disposition", "actions", "action")


def _ref_and_link(row):
    """The ID text plus any hyperlink embedded in that same cell."""
    for h in REF:
        if row.values.get(h):
            return row.values[h], row.links.get(h, "")
    return "", ""


def import_file(filename, data, store):
    """One sheet per type. Rows are matched on (type, ID): existing ones update, new ones add."""
    sheets = read_workbook(data)
    types = store.read("types")
    objects = store.read("objects")
    index = {(o["type"], o["ref"].lower()): o for o in objects}
    created = updated = skipped = bad_status = 0
    messages = []
    now = _now()

    for sheet in sheets:
        name = sheet.name.strip()
        otype = next((t for t in types if t["id"] == _slug(name) or t["name"].lower() == name.lower()), None)
        if not otype:
            otype = {"id": _slug(name) or uuid.uuid4().hex[:6], "name": name, "statuses": list(DEFAULT_STATUSES)}
            types.append(otype)
            messages.append(f"Created type '{name}'")
        statuses = otype.get("statuses") or DEFAULT_STATUSES
        lookup = {s.lower(): s for s in statuses}

        for row in sheet.rows:
            ref, ref_link = _ref_and_link(row)
            title = pick(row.values, *TITLE)
            ref = ref or title
            if not ref:
                skipped += 1
                messages.append(f"{name} row {row.number}: no ID or name, skipped")
                continue
            url = pick(row.values, *URL) or ref_link
            if url and not _valid_url(url):
                messages.append(f"{name} row {row.number}: ignored non-web link '{url[:40]}'")
                url = ""
            raw_status = pick(row.values, *STATUS)
            status = lookup.get(raw_status.lower()) if raw_status else None
            if raw_status and not status:
                bad_status += 1
            notes = pick(row.values, *NOTES)
            disposition = pick(row.values, *DISPOSITION)
            if disposition:  # old spreadsheets: keep the information rather than drop it
                notes = (notes + "\n" if notes else "") + f"Disposition: {disposition}"

            key = (otype["id"], ref.lower())
            existing = index.get(key)
            record = {
                "id": existing["id"] if existing else uuid.uuid4().hex[:10],
                "type": otype["id"], "ref": ref,
                "title": title if title != ref else "",
                "url": url or (existing or {}).get("url", ""),
                "file": (existing or {}).get("file"),
                "author": pick(row.values, *AUTHOR),
                "status": status or (existing or {}).get("status") or statuses[0],
                "notes": notes,
                "tags": _clean_tags(pick(row.values, *TAGS)),
                "created": existing["created"] if existing else now,
                "modified": now,
            }
            if existing:
                objects[objects.index(existing)] = record
                updated += 1
            else:
                objects.append(record)
                created += 1
            index[key] = record

    store.write("types", types)
    store.write("objects", objects)
    summary = [f"{created} created, {updated} updated, {skipped} skipped"]
    if bad_status:
        summary.append(f"{bad_status} row(s) had a status not in the type's list; defaulted to the first status")
    return {"messages": summary + messages[:50]}
