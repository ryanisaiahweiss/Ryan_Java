"""Reads .xlsx workbooks into plain Python structures for dashboard import hooks.

    sheets = read_workbook(bytes)
    sheets[0].name, sheets[0].rows[0].values["id"], sheets[0].rows[0].links["id"]

Header names are normalised (lowercase, punctuation -> single spaces), so "Document ID",
"document_id" and "DOCUMENT ID" all become "document id". `links` holds the hyperlink target
of each cell, which is how an ID cell with an embedded hyperlink keeps its URL.
"""
import datetime
import io
import re
from dataclasses import dataclass, field

MAX_ROWS = 20000


@dataclass
class Row:
    number: int
    values: dict = field(default_factory=dict)
    links: dict = field(default_factory=dict)


@dataclass
class Sheet:
    name: str
    headers: list
    rows: list


def _norm(header):
    return re.sub(r"[^a-z0-9]+", " ", str(header).lower()).strip()


def _text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.date().isoformat() if isinstance(value, datetime.datetime) else value.isoformat()
    return str(value).strip()


def pick(values, *aliases):
    """First non-empty value among the given (normalised) header aliases."""
    for a in aliases:
        if values.get(a):
            return values[a]
    return ""


def read_workbook(data: bytes):
    try:
        import openpyxl
    except ImportError:
        raise ValueError("Excel import needs openpyxl. Run: py -m pip install -r requirements.txt")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except Exception:
        raise ValueError("That file is not a valid .xlsx workbook")
    sheets = []
    for ws in wb.worksheets:
        headers, rows = None, []
        for r_index, cells in enumerate(ws.iter_rows(), start=1):
            if headers is None:
                if any(_text(c.value) for c in cells):
                    headers = [_norm(_text(c.value)) for c in cells]
                continue
            values, links = {}, {}
            for h, c in zip(headers, cells):
                if not h:
                    continue
                values[h] = _text(c.value)
                if c.hyperlink and c.hyperlink.target:
                    links[h] = c.hyperlink.target
            if any(values.values()):
                rows.append(Row(r_index, values, links))
            if len(rows) > MAX_ROWS:
                raise ValueError(f"Sheet '{ws.title}' has more than {MAX_ROWS} rows")
        if headers is not None:
            sheets.append(Sheet(ws.title, [h for h in headers if h], rows))
    return sheets
