/* Modulyt shared client helpers: API client, live updates, modal forms, document preview,
   Excel import, toasts. Every dashboard page includes this file. */
const Modulyt = (() => {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function toast(message, ok = false) {
    const t = document.createElement("div");
    t.className = "toast" + (ok ? " ok" : "");
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  /** REST client for one dashboard. Errors surface as toasts and rejected promises. */
  function api(dashboard) {
    const base = `/api/${encodeURIComponent(dashboard)}`;
    async function call(url, opts) {
      const res = await fetch(url, opts);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(body.error || res.statusText);
        toast(err.message);
        throw err;
      }
      return body;
    }
    const raw = (path, file) =>
      call(`${base}/${path}${path.includes("?") ? "&" : "?"}${path.startsWith("import") ? "filename" : "name"}=${encodeURIComponent(file.name)}`,
        { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    return {
      all: () => call(`${base}/data`),
      save: (collection, item) =>
        call(`${base}/${collection}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }),
      remove: (collection, id) => call(`${base}/${collection}/${encodeURIComponent(id)}`, { method: "DELETE" }),
      upload: (file) => raw("upload", file),          // -> {name, stored}
      importFile: (file) => raw("import", file),      // -> {messages: [...]}
    };
  }

  /** Subscribe to server-side data changes. Calls onChange() on every change. */
  function live(dashboard, onChange, indicator) {
    const src = new EventSource(`/events/${encodeURIComponent(dashboard)}`);
    src.addEventListener("change", () => onChange());
    src.onopen = () => indicator && indicator.classList.add("on");
    src.onerror = () => indicator && indicator.classList.remove("on");
    return src;
  }

  /**
   * Modal form. fields: [{name, label, type, options:[{value,label}], required, hint}]
   *   type: text | textarea | select | number | url | checkbox | checks (many checkboxes) | file
   * Resolves with the values object (checkbox -> boolean, checks -> array, file -> File|null),
   * or null if cancelled. `submit` may be an async saver: if it throws, the message is shown in
   * the form and the dialog stays open. `onChange(name, value, ctl)` fires on edits;
   * ctl.setOptions(name, options, selected) lets one select depend on another.
   */
  function form({ title, fields, values = {}, submitLabel = "Save", submit, onChange }) {
    return new Promise((resolve) => {
      const dlg = document.createElement("dialog");
      const optionsHtml = (opts, selected) =>
        (opts || []).map((o) => `<option value="${esc(o.value)}" ${o.value === selected ? "selected" : ""}>${esc(o.label)}</option>`).join("");
      const inputs = fields.map((f) => {
        const v = values[f.name] ?? "";
        const req = f.required ? "required" : "";
        const hint = f.hint ? `<small>${esc(f.hint)}</small>` : "";
        if (f.type === "checkbox")
          return `<label class="check"><input type="checkbox" name="${f.name}" ${values[f.name] ? "checked" : ""}> ${esc(f.label)}</label>`;
        if (f.type === "checks") {
          const chosen = new Set(values[f.name] || []);
          const boxes = (f.options || []).map((o) =>
            `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${chosen.has(o.value) ? "checked" : ""}> ${esc(o.label)}</label>`).join("");
          return `<fieldset><legend>${esc(f.label)}</legend><div class="checks">${boxes || "<small>None available</small>"}</div></fieldset>`;
        }
        let control;
        if (f.type === "textarea") control = `<textarea name="${f.name}" rows="${f.rows || 4}" ${req}>${esc(v)}</textarea>`;
        else if (f.type === "select") control = `<select name="${f.name}" ${req}>${optionsHtml(f.options, v)}</select>`;
        else if (f.type === "file") control = `<input name="${f.name}" type="file">`;
        else control = `<input name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" ${req}>`;
        return `<label>${esc(f.label)}${control}${hint}</label>`;
      }).join("");
      dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${inputs}<div class="error"></div>
        <div class="actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></div></form>`;
      document.body.appendChild(dlg);
      const formEl = dlg.querySelector("form");
      const done = (result) => { dlg.close(); dlg.remove(); resolve(result); };

      const collect = () => {
        const out = {};
        for (const f of fields) {
          const els = formEl.querySelectorAll(`[name="${f.name}"]`);
          if (f.type === "checkbox") out[f.name] = els[0].checked;
          else if (f.type === "checks") out[f.name] = [...els].filter((e) => e.checked).map((e) => e.value);
          else if (f.type === "file") out[f.name] = els[0].files[0] || null;
          else out[f.name] = els[0].value;
        }
        return out;
      };
      const ctl = {
        setOptions(name, options, selected) {
          const el = formEl.querySelector(`select[name="${name}"]`);
          el.innerHTML = optionsHtml(options, selected);
        },
      };
      if (onChange) {
        formEl.addEventListener("change", (e) => e.target.name && onChange(e.target.name, e.target.value, ctl));
        onChange(null, null, ctl); // let the caller initialise dependent fields
      }
      dlg.querySelector("[data-cancel]").onclick = () => done(null);
      dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });
      formEl.addEventListener("submit", async (e) => {
        e.preventDefault();
        const result = collect();
        try {
          if (submit) await submit(result);
          done(result);
        } catch (err) {
          dlg.querySelector(".error").textContent = err.message;
        }
      });
      dlg.showModal();
      const first = dlg.querySelector("input, textarea, select");
      if (first) first.focus();
    });
  }

  /** Simple report dialog (used for import results). */
  function report(title, lines) {
    return new Promise((resolve) => {
      const dlg = document.createElement("dialog");
      dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>
        <ul class="report">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <div class="actions"><button class="primary">Close</button></div></form>`;
      document.body.appendChild(dlg);
      dlg.addEventListener("close", () => { dlg.remove(); resolve(); });
      dlg.showModal();
    });
  }

  /** Pick an .xlsx, send it to the dashboard's import hook and show the result. */
  function importExcel(dashboard, onDone) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = async () => {
      if (!input.files[0]) return;
      try {
        const res = await api(dashboard).importFile(input.files[0]);
        await report("Import complete", res.messages || ["Done"]);
        onDone && onDone();
      } catch (_) { /* api() already showed the error */ }
    };
    input.click();
  }

  // ---------- document preview drawer ----------
  const INLINE = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "md", "csv", "log", "html", "htm", "svg"]);
  const isWeb = (u) => /^https?:\/\//i.test(u || "");

  /** Show a document beside the dashboard. `obj` = {ref, title, url, file:{name, stored}}.
   *  Uploaded files render inline when the browser can; external URLs are embedded when the
   *  site allows it (many block framing, so an "Open" link is always offered). */
  function preview(obj, dashboard) {
    let drawer = document.getElementById("mdl-preview");
    if (!drawer) {
      drawer = document.createElement("aside");
      drawer.id = "mdl-preview";
      document.body.appendChild(drawer);
    }
    const file = obj.file;
    const fileUrl = file ? `/files/${encodeURIComponent(dashboard)}/${encodeURIComponent(file.stored)}` : null;
    const ext = file ? file.name.split(".").pop().toLowerCase() : "";
    const openUrl = fileUrl || (isWeb(obj.url) ? obj.url : null);
    let body;
    if (file && INLINE.has(ext)) body = `<iframe src="${esc(fileUrl)}" title="${esc(obj.ref)}"></iframe>`;
    else if (file) body = `<div class="pv-msg">This file type can't be previewed in the browser.<br><a href="${esc(fileUrl)}" download="${esc(file.name)}">Download ${esc(file.name)}</a></div>`;
    else if (isWeb(obj.url)) body = `<iframe src="${esc(obj.url)}" title="${esc(obj.ref)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>
      <div class="pv-note">If the page is blank, the site doesn't allow embedding. Use Open, or attach a copy of the file.</div>`;
    else body = `<div class="pv-msg">No file or URL attached to this document.</div>`;
    drawer.innerHTML = `<header><strong>${esc(obj.ref)}</strong><span class="pv-title">${esc(obj.title || "")}</span><span class="spacer"></span>
      ${openUrl ? `<a class="btn" href="${esc(openUrl)}" target="_blank" rel="noopener noreferrer">Open</a>` : ""}
      <button class="icon" data-close title="Close">✕</button></header>${body}`;
    drawer.classList.add("open");
    drawer.querySelector("[data-close]").onclick = () => { drawer.classList.remove("open"); drawer.innerHTML = ""; };
  }

  return { esc, toast, api, live, form, report, importExcel, preview };
})();
