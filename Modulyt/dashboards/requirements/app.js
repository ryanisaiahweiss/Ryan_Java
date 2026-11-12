/* Engineering Requirements dashboard.
   Shared helpers (api, live, form, preview, importExcel, esc) come from /static/modulyt.js. */
(() => {
  const { esc, api: makeApi, live, form, preview, importExcel } = Modulyt;
  const api = makeApi("requirements");
  const STATUSES = ["Draft", "Review", "Approved", "Obsolete"];
  const MAX_COLS = 6, MIN_COLS = 2;
  const $ = (id) => document.getElementById(id);

  const S = {
    modules: [], reqs: [], links: [], authors: [],
    docs: [],                    // Object Tracker objects, used as requirement source documents
    cols: [],                    // [{mod, text}] left to right; order defines which columns are adjacent
    dirty: true,                 // column layout changed: rebuild the column shells
    sel: null,
    drag: null,                  // id of the requirement being dragged
    author: localStorage.getItem("req.author") || "",
  };

  // ---------- data ----------
  async function refresh() {
    const d = await api.all();
    S.modules = d.modules.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
    S.reqs = d.requirements;
    S.links = d.links;
    S.authors = d.authors;
    reconcileColumns();
    if (S.sel && !S.reqs.some((r) => r.id === S.sel)) S.sel = null;
    render();
  }

  /** Keep the column list valid against the current modules (restoring the saved layout first). */
  function reconcileColumns() {
    const ids = S.modules.map((m) => m.id);
    let wanted = S.cols.length ? S.cols.map((c) => c.mod) : null;
    if (!wanted) { try { wanted = JSON.parse(localStorage.getItem("req.cols")); } catch (_) { /* ignore */ } }
    wanted = (Array.isArray(wanted) ? wanted : []).filter((m) => ids.includes(m)).slice(0, MAX_COLS);
    for (const m of ids) { if (wanted.length >= MIN_COLS) break; wanted.push(m); }
    while (wanted.length < MIN_COLS && ids.length) wanted.push(ids[0]);
    if (wanted.join() !== S.cols.map((c) => c.mod).join()) {
      S.cols = wanted.map((mod, i) => ({ mod, text: S.cols[i]?.text || "" }));
      S.dirty = true;
    }
  }
  const saveCols = () => localStorage.setItem("req.cols", JSON.stringify(S.cols.map((c) => c.mod)));

  // The object tracker is optional: if it isn't there, requirements simply have no documents.
  async function loadDocs() {
    try {
      const res = await fetch("/api/object_tracker/data");
      S.docs = res.ok ? (await res.json()).objects : [];
    } catch (_) { S.docs = []; }
    render();
  }

  // ---------- trace graph ----------
  function graph() {
    const nb = new Map(), parents = new Map(), children = new Map();
    const add = (m, a, b) => (m.get(a) || m.set(a, new Set()).get(a)).add(b);
    for (const l of S.links) {
      add(nb, l.parent, l.child); add(nb, l.child, l.parent);
      add(parents, l.child, l.parent); add(children, l.parent, l.child);
    }
    return { nb, parents, children };
  }

  /** Every requirement reachable from `id` going only up (ancestors) or only down (descendants). */
  function closure(id, g) {
    const out = new Set();
    for (const edges of [g.parents, g.children]) {
      const stack = [id];
      while (stack.length) for (const n of edges.get(stack.pop()) || []) if (!out.has(n)) { out.add(n); stack.push(n); }
    }
    out.delete(id);
    return out;
  }

  // ---------- cross-filter logic ----------
  function textMatch(r, q) {
    q = q.toLowerCase();
    return [r.id, r.text, r.author, r.status, (r.tags || []).join(" ")].some((v) => String(v || "").toLowerCase().includes(q));
  }

  /** Rules, for any number of columns:
   *  - No text anywhere: every column shows everything.
   *  - Text in some columns: those columns filter by their own text only (independent).
   *    Every column without text follows the traces automatically, spreading outward from the
   *    filtered columns through neighbouring columns (a column between two filtered ones must
   *    trace to both).
   *  - Text in every column: all independent, no automatic filtering. */
  function compute(nb) {
    const n = S.cols.length;
    const bases = S.cols.map((c) => S.reqs.filter((r) => r.module === c.mod));
    const q = S.cols.map((c) => c.text.trim());
    const sets = q.map((t, i) => (t ? bases[i].filter((r) => textMatch(r, t)) : null));
    const typed = q.filter(Boolean).length;
    if (typed === 0) return { sets: bases, bases, mode: "No filter" };

    if (typed < n) {
      const tracedFrom = (list) => {
        const ids = new Set();
        for (const r of list) for (const x of nb.get(r.id) || []) ids.add(x);
        return ids;
      };
      let known = sets.map((s) => s !== null);
      while (known.some((k) => !k)) {
        const round = [];
        for (let i = 0; i < n; i++) {
          if (known[i]) continue;
          const from = [i - 1, i + 1].filter((j) => j >= 0 && j < n && known[j]);
          if (!from.length) continue;
          let list = bases[i];
          for (const j of from) { const ids = tracedFrom(sets[j]); list = list.filter((r) => ids.has(r.id)); }
          round.push([i, list]);
        }
        if (!round.length) break;
        for (const [i, list] of round) { sets[i] = list; known[i] = true; }
      }
    }
    const names = S.cols.filter((c) => c.text.trim()).map((c) => c.mod).join(", ");
    return {
      sets: sets.map((s, i) => s || bases[i]), bases,
      mode: typed === n ? "Independent filters (auto cross-filter off)" : `Filtering by ${names}; other columns follow the traces`,
    };
  }

  // ---------- rendering ----------
  const authorName = (id) => S.authors.find((a) => a.id === id)?.name || id;
  const docById = (id) => S.docs.find((d) => d.id === id);
  const levelOf = (r) => S.modules.find((m) => m.id === r.module)?.level ?? 0;
  const NEW_MODULE = "__new__", MANAGE_MODULES = "__manage__";
  const moduleOptions = () => S.modules.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.id)})</option>`).join("") +
    `<option disabled>──────────</option><option value="${NEW_MODULE}">＋ New module…</option><option value="${MANAGE_MODULES}">⚙ Manage modules…</option>`;

  function buildColumns() {
    $("columns").innerHTML = S.cols.map((c, i) => `
      <section class="pane" data-col="${i}">
        <div class="pane-head">
          <select class="mod" aria-label="Module for column ${i + 1}"></select>
          <span class="badge count"></span>
          <span class="spacer"></span>
          <button data-colact="left" title="Move column left" ${i === 0 ? "disabled" : ""}>◀</button>
          <button data-colact="right" title="Move column right" ${i === S.cols.length - 1 ? "disabled" : ""}>▶</button>
          <button data-colact="remove" title="Remove column" ${S.cols.length <= MIN_COLS ? "disabled" : ""}>✕</button>
          <button data-colact="new">+ New</button>
        </div>
        <input class="filter" type="search" placeholder="Filter by ID, wording, author, tag…" autocomplete="off" value="${esc(c.text)}">
        <div class="list"></div>
      </section>`).join("");
    S.dirty = false;
  }

  function rowHtml(r, adjacent, g, direct, indirect) {
    const cls = ["req", r.id === S.sel ? "selected" : "", direct.has(r.id) ? "linked" : indirect.has(r.id) ? "linked indirect" : ""].join(" ");
    const reqMod = (id) => S.reqs.find((x) => x.id === id)?.module;
    const traces = adjacent.filter((m) => m !== r.module).map((m) => {
      const n = [...(g.nb.get(r.id) || [])].filter((id) => reqMod(id) === m).length;
      return n ? `<span class="badge trace" title="Requirements traced in ${esc(m)}">${esc(m)} ↔ ${n}</span>`
               : `<span class="badge gap" title="No trace to ${esc(m)}">no ${esc(m)} trace</span>`;
    }).join("");
    const tags = (r.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join("");
    const docs = (r.documents || []).map((id) => docById(id)).filter(Boolean)
      .map((d) => `<span class="badge doc" data-doc="${esc(d.id)}" title="Preview ${esc(d.title || d.ref)}">📄 ${esc(d.ref)}</span>`).join("");
    return `<div class="${cls}" data-id="${esc(r.id)}" draggable="true">
      <div class="req-head">
        <span class="req-id">${esc(r.id)}</span>
        <span class="badge s-${esc(r.status)}">${esc(r.status)}</span>${traces}
        <span class="actions">
          <button class="icon" data-act="edit" title="Edit (or double-click)">✎</button>
          <button class="icon" data-act="dup" title="Duplicate">⧉</button>
          <button class="icon danger" data-act="del" title="Delete">✕</button>
        </span>
      </div>
      <div class="req-text">${esc(r.text)}</div>
      ${tags || docs ? `<div class="req-chips">${docs}${tags}</div>` : ""}
      <div class="req-meta">${esc(authorName(r.author) || "no author")} · rev ${r.revision} · ${esc((r.modified || "").slice(0, 10))}</div>
    </div>`;
  }

  function render() {
    if (S.dirty) buildColumns();
    $("author").innerHTML = S.authors.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.role ? " · " + esc(a.role) : ""}</option>`).join("");
    if (!S.authors.some((a) => a.id === S.author)) S.author = S.authors[0]?.id || "";
    $("author").value = S.author;
    $("add-column").disabled = S.cols.length >= MAX_COLS;

    const g = graph();
    const { sets, bases, mode } = compute(g.nb);
    const direct = S.sel ? g.nb.get(S.sel) || new Set() : new Set();
    const indirect = S.sel ? closure(S.sel, g) : new Set();
    $("mode").textContent = mode;
    document.querySelectorAll(".pane").forEach((pane, i) => {
      const sel = pane.querySelector(".mod");
      sel.innerHTML = moduleOptions();
      sel.value = S.cols[i].mod;
      pane.querySelector(".count").textContent = `${sets[i].length} / ${bases[i].length}`;
      const adjacent = [...new Set([S.cols[i - 1]?.mod, S.cols[i + 1]?.mod].filter(Boolean))];
      pane.querySelector(".list").innerHTML = sets[i].length
        ? sets[i].map((r) => rowHtml(r, adjacent, g, direct, indirect)).join("")
        : `<div class="empty">No requirements</div>`;
    });
    renderManage();
  }

  // ---------- requirement editor ----------
  const tagsText = (r) => (r.tags || []).join(", ");

  function editorFields(withModule) {
    return [
      ...(withModule ? [{ name: "module", label: "Module", type: "select", options: S.modules.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` })) }] : []),
      { name: "text", label: "Requirement wording", type: "textarea", rows: 7, required: true },
      { name: "author", label: "Author", type: "select", options: S.authors.map((a) => ({ value: a.id, label: a.name })) },
      { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
      { name: "tags", label: "Tags (comma separated)" },
      ...(S.docs.length ? [{ name: "documents", label: "Source documents (from Object Tracker)", type: "checks",
        options: S.docs.map((d) => ({ value: d.id, label: `${d.ref}${d.title ? " — " + d.title : ""}` })) }] : []),
    ];
  }

  async function newRequirement(colIndex) {
    if (!S.modules.length) return Modulyt.toast("Create a module first");
    await form({
      title: "New requirement", fields: editorFields(true), submitLabel: "Create",
      values: { module: S.cols[colIndex].mod, author: S.author, status: "Draft" },
      submit: (v) => api.save("requirements", v),
    });
    refresh();
  }

  async function editRequirement(id) {
    const r = S.reqs.find((x) => x.id === id);
    if (!r) return;
    await form({
      title: `Edit ${id} (rev ${r.revision})`, fields: editorFields(false), submitLabel: "Save",
      values: { ...r, tags: tagsText(r), documents: r.documents || [] },
      submit: (v) => api.save("requirements", { ...r, ...v }),
    });
    refresh();
  }

  async function duplicateRequirement(id) {
    const src = S.reqs.find((x) => x.id === id);
    if (!src) return;
    const nLinks = S.links.filter((l) => l.parent === id || l.child === id).length;
    await form({
      title: `Duplicate ${id}`, submitLabel: "Create copy",
      fields: [
        { name: "module", label: "Module for the copy", type: "select", options: S.modules.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` })) },
        { name: "text", label: "Requirement wording", type: "textarea", rows: 6, required: true },
        { name: "copyTags", label: `Copy tags (${(src.tags || []).length})`, type: "checkbox" },
        { name: "copyDocs", label: `Copy source documents (${(src.documents || []).length})`, type: "checkbox" },
        { name: "copyTraces", label: `Copy traces (${nLinks} existing links)`, type: "checkbox" },
      ],
      values: { module: src.module, text: src.text, copyTags: true, copyDocs: true, copyTraces: false },
      submit: async (v) => {
        const copy = await api.save("requirements", {
          module: v.module, text: v.text, author: S.author || src.author, status: "Draft",
          tags: v.copyTags ? src.tags || [] : [], documents: v.copyDocs ? src.documents || [] : [],
        });
        if (v.copyTraces) {
          for (const l of S.links.filter((l) => l.parent === id || l.child === id)) {
            await api.save("links", { parent: l.parent === id ? copy.id : l.parent, child: l.child === id ? copy.id : l.child });
          }
        }
        S.sel = copy.id;
      },
    });
    refresh();
  }

  async function deleteRequirement(id) {
    if (!confirm(`Delete ${id} and its trace links?`)) return;
    await api.remove("requirements", id);
    refresh();
  }

  // ---------- traces ----------
  /** The higher-level (lower number) requirement is the parent; on a tie, `a` is. */
  const orient = (a, b) => (levelOf(b) < levelOf(a) ? [b, a] : [a, b]);

  async function toggleLink(selId, otherId) {
    const [parent, child] = orient(S.reqs.find((r) => r.id === selId), S.reqs.find((r) => r.id === otherId));
    const id = `${parent.id}>${child.id}`;
    if (S.links.some((l) => l.id === id)) await api.remove("links", id);
    else await api.save("links", { parent: parent.id, child: child.id });
    refresh();
  }

  async function dropLink(dragId, targetId) {
    const [parent, child] = orient(S.reqs.find((r) => r.id === dragId), S.reqs.find((r) => r.id === targetId));
    if (S.links.some((l) => l.id === `${parent.id}>${child.id}`)) return Modulyt.toast(`${parent.id} → ${child.id} is already traced`);
    await api.save("links", { parent: parent.id, child: child.id });
    Modulyt.toast(`Traced ${parent.id} → ${child.id}`, true);
    S.sel = dragId;
    refresh();
  }

  // ---------- modules & authors ----------
  async function newModule() {
    await form({
      title: "New requirement module", submitLabel: "Create",
      fields: [
        { name: "id", label: "ID (e.g. SYS)", required: true },
        { name: "name", label: "Name (e.g. System Requirements)", required: true },
        { name: "prefix", label: "Requirement ID prefix (defaults to ID)" },
        { name: "level", label: "Level (0 = top, higher = further down)", type: "number", required: true },
        { name: "description", label: "Description", type: "textarea" },
      ],
      values: { level: S.modules.length },
      submit: (v) => api.save("modules", v),
    });
    refresh();
  }

  async function newAuthor() {
    await form({
      title: "New author", submitLabel: "Add",
      fields: [{ name: "name", label: "Name", required: true }, { name: "role", label: "Role" }],
      submit: (v) => api.save("authors", v),
    });
    refresh();
  }

  // ---------- column layout ----------
  function addColumn() {
    if (S.cols.length >= MAX_COLS) return;
    const shown = new Set(S.cols.map((c) => c.mod));
    // Default to the next module down from the last column, else any module not yet shown.
    const lastIdx = S.modules.findIndex((m) => m.id === S.cols[S.cols.length - 1].mod);
    const next = S.modules[lastIdx + 1] || S.modules.find((m) => !shown.has(m.id)) || S.modules[0];
    S.cols.push({ mod: next.id, text: "" });
    changedLayout();
  }

  function changedLayout() {
    S.dirty = true;
    saveCols();
    render();
  }

  function columnAction(i, act) {
    if (act === "new") return newRequirement(i);
    if (act === "remove" && S.cols.length > MIN_COLS) S.cols.splice(i, 1);
    else if (act === "left" && i > 0) [S.cols[i - 1], S.cols[i]] = [S.cols[i], S.cols[i - 1]];
    else if (act === "right" && i < S.cols.length - 1) [S.cols[i + 1], S.cols[i]] = [S.cols[i], S.cols[i + 1]];
    else return;
    changedLayout();
  }

  // ---------- events (delegated so they survive column rebuilds) ----------
  const cont = $("columns");
  const reqOf = (el) => S.reqs.find((r) => r.id === el.closest(".req")?.dataset.id);
  const colOf = (el) => Number(el.closest(".pane")?.dataset.col);

  cont.addEventListener("click", (e) => {
    const colAct = e.target.closest("[data-colact]");
    if (colAct) return columnAction(colOf(colAct), colAct.dataset.colact);
    const docChip = e.target.closest("[data-doc]");
    if (docChip) return preview(docById(docChip.dataset.doc), "object_tracker");
    const req = reqOf(e.target);
    if (!req) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "edit") return editRequirement(req.id);
    if (act === "dup") return duplicateRequirement(req.id);
    if (act === "del") return deleteRequirement(req.id);
    const selReq = S.reqs.find((r) => r.id === S.sel);
    if ((e.ctrlKey || e.metaKey) && selReq && selReq.id !== req.id && selReq.module !== req.module) return toggleLink(selReq.id, req.id);
    S.sel = S.sel === req.id ? null : req.id;
    render();
  });
  cont.addEventListener("dblclick", (e) => {
    if (e.target.closest("button, [data-doc]")) return;
    const req = reqOf(e.target);
    if (req) editRequirement(req.id);
  });
  cont.addEventListener("input", (e) => {
    if (!e.target.classList.contains("filter")) return;
    S.cols[colOf(e.target)].text = e.target.value;
    render();
  });
  cont.addEventListener("change", (e) => {
    if (!e.target.classList.contains("mod")) return;
    S.cols[colOf(e.target)].mod = e.target.value;
    saveCols();
    render();
  });

  // drag a requirement onto one in another column to trace them
  cont.addEventListener("dragstart", (e) => {
    const req = reqOf(e.target);
    if (!req) return;
    S.drag = req.id;
    e.dataTransfer.effectAllowed = "link";
    e.dataTransfer.setData("text/plain", req.id);
    e.target.closest(".req").classList.add("dragging");
  });
  const dropTarget = (e) => {
    const target = reqOf(e.target), dragged = S.reqs.find((r) => r.id === S.drag);
    return target && dragged && target.module !== dragged.module && target.id !== dragged.id ? { target, dragged } : null;
  };
  cont.addEventListener("dragover", (e) => {
    if (!dropTarget(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "link";
    cont.querySelectorAll(".drop-ok").forEach((n) => n.classList.remove("drop-ok"));
    e.target.closest(".req").classList.add("drop-ok");
  });
  cont.addEventListener("dragleave", (e) => {
    if (!cont.contains(e.relatedTarget)) cont.querySelectorAll(".drop-ok").forEach((n) => n.classList.remove("drop-ok"));
  });
  cont.addEventListener("drop", (e) => {
    const t = dropTarget(e);
    if (!t) return;
    e.preventDefault();
    dropLink(t.dragged.id, t.target.id);
  });
  cont.addEventListener("dragend", () => {
    S.drag = null;
    document.querySelectorAll(".dragging, .drop-ok").forEach((n) => n.classList.remove("dragging", "drop-ok"));
  });

  $("author").addEventListener("change", (e) => { S.author = e.target.value; localStorage.setItem("req.author", S.author); });
  $("add-author").addEventListener("click", newAuthor);
  $("add-module").addEventListener("click", newModule);
  $("add-column").addEventListener("click", addColumn);
  $("import").addEventListener("click", () => importExcel("requirements", refresh));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) { S.sel = null; render(); } });

  refresh();
  loadDocs();
  live("requirements", refresh, $("live"));
  live("object_tracker", loadDocs);
})();
