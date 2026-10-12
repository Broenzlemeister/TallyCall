// Rundown-Liste: verschachtelte Gruppen (zuklappbar), Pausen, Drag & Drop (Planung), Start-Knöpfe (Regie).
// Setzt common.js (CL) voraus. Schreibt nie selbst, sondern meldet über onAction / onSelect / onStart.
const Rundown = (() => {
  const E = (s) => CL.esc(s);
  function create(el, opts = {}) {
    const o = { editable: false, startable: false, key: "rd", onAction: null, onSelect: null, onStart: null, onOpen: null, ...opts };
    el.classList.add("rd");
    let collapsed = new Set(), selected = null, last = "", dragId = null, drop = null, rowsCache = [];
    try { collapsed = new Set(JSON.parse(localStorage.getItem("rdc:" + o.key) || "[]")); } catch (_) {}
    const saveC = () => { try { localStorage.setItem("rdc:" + o.key, JSON.stringify([...collapsed])); } catch (_) {} };
    const hiddenByCollapse = (r, rows) => CLS.ancestors(rows.map((x) => x.e), r.e).some((g) => collapsed.has(g.id));

    function html(rows, s, { currentId, pastIdx } = {}) {
      if (!rows.length) return `<div class="empty">${o.editable ? I18N.t("Noch keine Punkte. Mit „+ Punkt“ beginnen oder einen Plan importieren.") : I18N.t("Dieser Tag hat noch keine Punkte.")}</div>`;
      return rows.map((r, i) => {
        if (hiddenByCollapse(r, rows)) return "";
        const e = r.e, cls = ["r", e.type === "group" ? "g d" + r.depth : "", r.brk ? "brk" : "", e.id === currentId ? "now" : "", pastIdx != null && i < pastIdx && !r.group ? "past" : "", r.skip ? "skip" : "", selected === e.id ? "sel" : ""].filter(Boolean).join(" ");
        const late = r.late != null && Math.abs(r.late) >= 60 ? `<small class="${r.late > 0 ? "late-pos" : "late-neg"}">${CL.signed(r.late)}</small>` : "";
        const tm = r.group ? (r.empty ? "" : `${CL.hhmm(r.pStart ?? r.start)}`) : `<b>${r.skip ? "–" : CL.hhmm(r.pStart ?? r.start)}</b>${e.start === "fixed" ? " 📌" : ""}${late}${r.over ? ` <span class="warn" title="${E(I18N.t("Der Punkt davor reicht {d} in den festen Start hinein", { d: CL.fmtDur(r.over) }))}">⚠</span>` : ""}`;
        const dur = r.group ? (r.empty ? "" : CL.fmtDur((r.pEnd ?? r.end) - (r.pStart ?? r.start))) : CL.fmtDur(e.duration);
        const tog = e.type === "group" ? `<button class="tog" data-a="tog" title="${E(I18N.t("Auf- oder zuklappen"))}">${collapsed.has(e.id) ? "▸" : "▾"}</button>` : o.editable ? `<span class="hd" title="${E(I18N.t("Ziehen zum Sortieren"))}">⠿</span>` : "<span></span>";
        const sub = [e.presenter, e.subtitle].filter(Boolean).join(" · ");
        const cueCh = e.cues?.length ? `<span class="cuech">${CL.gChips(e.cues, s)}</span>` : "";
        const pins = [e.lowerId ? `<span class="pill" title="${E(I18N.t("Bauchbinde beim Start"))}">▭</span>` : "", e.actions?.length || e.cues?.some((c) => c.actions?.length) ? `<span class="pill" title="${E(I18N.t("Sendet Trigger"))}">⚡</span>` : "", e.endAction === "next" ? `<span class="pill" title="${E(I18N.t("Danach automatisch weiter"))}">⏭</span>` : ""].filter(Boolean).join("");
        const acts = o.startable && !r.group && !r.skip ? `<button class="sm go" data-a="start" title="${E(I18N.t("Diesen Punkt starten"))}">▶</button><button class="sm ghost" data-a="load" title="${E(I18N.t("Laden ohne Start"))}">⏏</button>` :
          o.editable ? `<button class="sm ghost" data-a="dup" title="${E(I18N.t("Duplizieren"))}">⧉</button><button class="sm ghost" data-a="skip" title="${E(I18N.t("Überspringen"))}">${e.skip ? "↩" : "⤼"}</button><button class="sm ghost stop" data-a="del" title="${E(I18N.t("Löschen"))}">✕</button>` : "";
        return `<div class="${cls}" data-id="${E(e.id)}" data-depth="${r.depth}" data-type="${e.type}" style="--c:${E(e.color)}" ${o.editable ? 'draggable="true"' : ""}>${tog}<div class="c"></div><div class="tm">${tm}</div>
          <div class="t"><span translate="no">${E(e.title) || "<i>" + I18N.t("(ohne Titel)") + "</i>"}</span>${cueCh}${pins ? `<span class="pins">${pins}</span>` : ""}${sub ? `<small translate="no">${E(sub)}</small>` : ""}</div><div class="dur">${dur}</div><div class="acts">${acts}</div></div>`;
      }).join("");
    }
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-a]"), row = ev.target.closest(".r"); if (!row) return;
      const id = row.dataset.id;
      if (b) {
        const a = b.dataset.a;
        if (a === "tog") { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); saveC(); last = ""; api.refresh(); return; }
        if (a === "start") return o.onStart?.(id, true);
        if (a === "load") return o.onStart?.(id, false);
        const e = rowsCache.find((r) => r.e.id === id)?.e;
        if (a === "skip") return o.onAction?.({ type: "update", id, data: { skip: !e.skip } });
        if (a === "dup") return o.onAction?.({ type: "add", dayId: api.dayId, after: id, data: { ...e, id: undefined, parent: undefined, start: "chain", skip: false, cues: e.cues.map((c) => ({ ...c, id: undefined })) } });
        if (a === "del") {
          if (e.type === "group" && rowsCache.some((r) => r.e.parent === id)) {
            UI.modal({ title: I18N.t("Gruppe löschen?"), html: `<p>${E(I18N.t("„{t}“ enthält Punkte. Was soll passieren?", { t: e.title }))}</p>`, actions: [{ label: "Abbrechen" }, { label: "Nur Gruppe auflösen", onClick: (close) => { close(); o.onAction?.({ type: "delete", id }); } }, { label: "Mit Inhalt löschen", cls: "danger", onClick: (close) => { close(); o.onAction?.({ type: "delete", id, withChildren: true }); } }] });
            return;
          }
          if (confirm(I18N.t("„{t}“ löschen?", { t: e.title }))) o.onAction?.({ type: "delete", id });
          return;
        }
      }
      selected = id; last = ""; api.refresh(); o.onSelect?.(id);
    });
    el.addEventListener("dblclick", (ev) => { const row = ev.target.closest(".r"); if (!row) return; if (o.startable && row.dataset.type !== "group") o.onStart?.(row.dataset.id, true); else o.onOpen?.(row.dataset.id); });

    // Drag & Drop: vor/hinter einen Punkt (gleiche Ebene) oder in eine Gruppe (Mitte der Gruppenzeile)
    if (o.editable) {
      el.addEventListener("dragstart", (ev) => { const row = ev.target.closest(".r"); if (!row) return; dragId = row.dataset.id; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", dragId); setTimeout(() => row.classList.add("dragging"), 0); });
      el.addEventListener("dragover", (ev) => {
        const row = ev.target.closest(".r"); if (!row || !dragId || row.dataset.id === dragId) return;
        ev.preventDefault(); ev.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect(), y = (ev.clientY - rect.top) / rect.height;
        const mode = row.dataset.type === "group" && y > 0.3 && y < 0.7 ? "into" : y < 0.5 ? "before" : "after";
        if (drop && drop.id === row.dataset.id && drop.mode === mode) return;
        clearDrop(); drop = { id: row.dataset.id, mode };
        if (mode === "into") row.classList.add("into"); else { const m = document.createElement("div"); m.className = "ins on"; row.insertAdjacentElement(mode === "before" ? "beforebegin" : "afterend", m); }
      });
      el.addEventListener("dragleave", (ev) => { if (!el.contains(ev.relatedTarget)) clearDrop(); });
      el.addEventListener("drop", (ev) => {
        ev.preventDefault(); if (!dragId || !drop) return clearDrop();
        const events = rowsCache.map((r) => r.e), target = events.find((e) => e.id === drop.id), src = events.find((e) => e.id === dragId);
        if (!target || !src || CLS.isDesc(events, target, dragId)) return clearDrop();
        let parent, index;
        if (drop.mode === "into") { parent = target.id; index = CLS.children(events, parent).filter((e) => e.id !== dragId).length; }
        else { parent = target.parent || ""; const sib = CLS.children(events, parent).filter((e) => e.id !== dragId); index = sib.indexOf(target) + (drop.mode === "after" ? 1 : 0); }
        o.onAction?.({ type: "move", id: dragId, dayId: api.dayId, parent, index });
        clearDrop(); dragId = null;
      });
      el.addEventListener("dragend", () => { clearDrop(); el.querySelectorAll(".dragging").forEach((r) => r.classList.remove("dragging")); dragId = null; });
    }
    function clearDrop() { el.querySelectorAll(".ins").forEach((m) => m.remove()); el.querySelectorAll(".into").forEach((r) => r.classList.remove("into")); drop = null; }

    let lastArgs = null;
    const api = {
      dayId: null,
      render(rows, s, extra = {}) {
        rowsCache = rows; lastArgs = [rows, s, extra];
        if (dragId) return; // während des Ziehens nicht neu bauen
        const h = html(rows, s, extra);
        if (h !== last) { last = h; el.innerHTML = h; }
      },
      refresh() { if (lastArgs) api.render(...lastArgs); },
      select(id) { selected = id; last = ""; api.refresh(); },
      get selected() { return selected; },
      expandAll() { collapsed.clear(); saveC(); last = ""; api.refresh(); },
      collapseAll(rows) { for (const r of rows || rowsCache) if (r.e.type === "group") collapsed.add(r.e.id); saveC(); last = ""; api.refresh(); },
      reveal(id) { const ev = rowsCache.map((r) => r.e), e = ev.find((x) => x.id === id); if (!e) return; let ch = false; for (const g of CLS.ancestors(ev, e)) if (collapsed.delete(g.id)) ch = true; if (ch) { saveC(); last = ""; api.refresh(); } },
    };
    return api;
  }
  return { create };
})();
