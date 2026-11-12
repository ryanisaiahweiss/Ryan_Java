/* Object Tracker dashboard. Shared helpers come from /static/modulyt.js. */
(() => {
  const { esc, api: makeApi, live, form, preview, importExcel } = Modulyt;
  const DASH = "object_tracker";
  const api = makeApi(DASH);
  const $ = (id) => document.getElementById(id);
  const DEFAULT_STATUSES = ["In Work", "Under Review", "Released"];

  const S = {
    types: [], objects: [],
    type: "", status: "", text: "", tags: new Set(),   // active filters (tags combine with AND)
    sort: { key: "ref", dir: 1 },
  };

  async function refresh() {
    const d = await api.all();
    S.types = d.types.sort((a, b) => a.name.localeCompare(b.name));
    S.objects = d.objects;
    if (S.type && !S.types.some((t) => t.id === S.type)) S.type = "";
    render();
  }

  const typeName = (id) => S.types.find((t) => t.id === id)?.name || id;
  const statusesOf = (typeId) => S.types.find((t) => t.id === typeId)?.statuses || DEFAULT_STATUSES;

  function visible() {
    const q = S.text.trim().toLowerCase();
    const list = S.objects.filter((o) => {
      if (S.type && o.type !== S.type) return false;
      if (S.status && o.status !== S.status) return false;
      for (const t of S.tags) if (!o.tags.includes(t)) return false;
      if (!q) return true;
      return [o.ref, o.title, o.author, o.status, o.notes, typeName(o.type), ...o.tags]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
    const { key, dir } = S.sort;
    const val = (o) => String(key === "type" ? typeName(o.type) : o[key] || "");
    return list.sort((a, b) => dir * val(a).localeCompare(val(b), undefined, { numeric: true, sensitivity: "base" }));
  }

  function render() {
    $("type-filter").innerHTML = `<option value="">All types</option>` +
      S.types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
    $("type-filter").value = S.type;
    $("edit-type").hidden = !S.type;

    // Status choices: that type's list, or every status in use/defined when viewing all types.
    const statuses = S.type ? statusesOf(S.type) : [...new Set([...S.types.flatMap((t) => t.statuses || []), ...S.objects.map((o) => o.status)])];
    if (S.status && !statuses.includes(S.status)) S.status = "";
    $("status-filter").innerHTML = `<option value="">All statuses</option>` + statuses.map((s) => `<option>${esc(s)}</option>`).join("");
    $("status-filter").value = S.status;

    // Tag bar counts reflect the current type filter, so you see which groups exist in view.
    const counts = new Map();
    for (const o of S.objects) if (!S.type || o.type === S.type) for (const t of o.tags) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of S.tags) if (!counts.has(t)) counts.set(t, 0);
    $("tags").innerHTML = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) =>
      `<span class="badge tag ${S.tags.has(t) ? "on" : ""}" data-tag="${esc(t)}">${esc(t)}<span class="n">${n}</span></span>`).join("")
      || `<span class="badge">No tags yet</span>`;

    const list = visible();
    $("count").textContent = `${list.length} / ${S.objects.length}`;
    $("rows").innerHTML = list.length ? list.map((o) => {
      const link = /^https?:\/\//i.test(o.url || "");
      const ref = link ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.ref)}</a>` : esc(o.ref);
      const canPreview = link || o.file;
      return `<tr data-id="${esc(o.id)}">
        <td class="ref">${ref}${o.file ? ` <span class="badge" title="${esc(o.file.name)}">📎</span>` : ""}${o.title ? `<span class="title">${esc(o.title)}</span>` : ""}</td>
        <td>${esc(typeName(o.type))}</td>
        <td><span class="badge st-${esc(o.status.replace(/\s+/g, ""))}">${esc(o.status)}</span></td>
        <td>${esc(o.author)}</td>
        <td><div class="tags">${o.tags.map((t) => `<span class="badge tag ${S.tags.has(t) ? "on" : ""}" data-tag="${esc(t)}">${esc(t)}</span>`).join("")}</div></td>
        <td class="notes">${esc(o.notes)}</td>
        <td class="actions">
          ${canPreview ? `<button class="icon" data-act="preview" title="Preview document">👁</button>` : ""}
          <button class="icon" data-act="edit" title="Edit">✎</button>
          <button class="icon danger" data-act="del" title="Delete">✕</button>
        </td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty">No objects match</td></tr>`;
  }

  // ---------- actions ----------
  async function editObject(existing) {
    if (!S.types.length) return Modulyt.toast("Create a type first");
    const typeOptions = S.types.map((t) => ({ value: t.id, label: t.name }));
    const statusOptions = (typeId) => statusesOf(typeId).map((s) => ({ value: s, label: s }));
    const startType = existing ? existing.type : S.type || S.types[0].id;
    await form({
      title: existing ? `Edit ${existing.ref}` : "New object",
      submitLabel: existing ? "Save" : "Create",
      fields: [
        { name: "type", label: "Type", type: "select", options: typeOptions },
        { name: "ref", label: "Document ID / name", required: true },
        { name: "title", label: "Title (optional)" },
        { name: "status", label: "Status", type: "select", options: statusOptions(startType) },
        { name: "url", label: "URL (makes the ID a hyperlink)", type: "url" },
        { name: "file", label: existing?.file ? `Replace attached copy (current: ${existing.file.name})` : "Attach a copy for in-tool preview", type: "file",
          hint: "PDF, images, text and HTML preview inline. Word/Excel files can be stored but not previewed." },
        { name: "author", label: "Author" },
        { name: "notes", label: "Notes", type: "textarea" },
        { name: "tags", label: "Tags (comma separated)" },
      ],
      values: existing ? { ...existing, tags: existing.tags.join(", ") } : { type: startType },
      onChange: (name, value, ctl) => {
        // Keep the status list in step with the chosen type.
        if (name === "type") ctl.setOptions("status", statusOptions(value), statusesOf(value)[0]);
      },
      submit: async (v) => {
        const { file, ...rest } = v;
        const item = { ...rest, id: existing?.id, file: existing?.file || null };
        if (file) item.file = await api.upload(file);
        await api.save("objects", item);
      },
    });
    refresh();
  }

  async function editType(existing) {
    await form({
      title: existing ? `Edit type: ${existing.name}` : "New object type",
      submitLabel: existing ? "Save" : "Create",
      fields: [
        { name: "name", label: "Name (e.g. Procedure, Venue, Vendor)", required: true },
        { name: "statuses", label: "Status list (comma separated, first is the default)", required: true },
      ],
      values: existing ? { name: existing.name, statuses: existing.statuses.join(", ") } : { statuses: DEFAULT_STATUSES.join(", ") },
      submit: (v) => api.save("types", { ...v, id: existing?.id }),
    });
    refresh();
  }

  // ---------- events ----------
  function toggleTag(t) { S.tags.has(t) ? S.tags.delete(t) : S.tags.add(t); render(); }

  $("tags").addEventListener("click", (e) => { const t = e.target.closest("[data-tag]"); if (t) toggleTag(t.dataset.tag); });
  $("rows").addEventListener("click", async (e) => {
    const tag = e.target.closest("[data-tag]");
    if (tag) return toggleTag(tag.dataset.tag);
    const act = e.target.closest("[data-act]")?.dataset.act;
    const obj = S.objects.find((o) => o.id === e.target.closest("tr")?.dataset.id);
    if (!act || !obj) return;
    if (act === "preview") return preview(obj, DASH);
    if (act === "edit") return editObject(obj);
    if (confirm(`Delete ${obj.ref}?`)) { await api.remove("objects", obj.id); refresh(); }
  });
  $("rows").addEventListener("dblclick", (e) => {
    if (e.target.closest("a, button, [data-tag]")) return;
    const obj = S.objects.find((o) => o.id === e.target.closest("tr")?.dataset.id);
    if (obj) editObject(obj);
  });
  document.querySelector("thead").addEventListener("click", (e) => {
    const key = e.target.closest("[data-sort]")?.dataset.sort;
    if (!key) return;
    S.sort = { key, dir: S.sort.key === key ? -S.sort.dir : 1 };
    render();
  });
  $("type-filter").addEventListener("change", (e) => { S.type = e.target.value; render(); });
  $("status-filter").addEventListener("change", (e) => { S.status = e.target.value; render(); });
  $("text-filter").addEventListener("input", (e) => { S.text = e.target.value; render(); });
  $("clear").addEventListener("click", () => { S.type = ""; S.status = ""; S.text = ""; S.tags.clear(); $("text-filter").value = ""; render(); });
  $("add-object").addEventListener("click", () => editObject(null));
  $("add-type").addEventListener("click", () => editType(null));
  $("edit-type").addEventListener("click", () => editType(S.types.find((t) => t.id === S.type)));
  $("import").addEventListener("click", () => importExcel(DASH, refresh));

  refresh();
  live(DASH, refresh, $("live"));
})();
