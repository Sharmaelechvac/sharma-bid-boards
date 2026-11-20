"use strict";
/* Shared bid board app — one codebase renders both boards.
   GitHub build: data comes from the decrypted bids.enc.json envelope via lock.js
   (SharmaLock.load). The app never sends anything; contact emails are mailto: links only.

   MANAGE (2026-11-19): Select mode with bulk Won / Lost / Archive / Folder,
   user folders, an Archived view, extended sorting (Builder A–Z / Z–A, due
   soonest / latest, amount high / low, status, sent), and per-bid Files
   (estimates & submittals) in the detail. In-app changes persist on this
   device as a changes overlay in localStorage (sharma-bids-overlay:v1),
   keyed by the stable row id that tools/build_plain.py derives:
     slugify(board | builder | project | plan_name | trade | address)
   with a -2/-3 suffix for rows colliding on every key field (CSV order).
   More -> "Changes to publish" lists the overlay with per-item Undo and a
   copyable plain-text summary Jarvis folds into the CSVs, then rebuilds and
   re-encrypts. Folders live in localStorage (sharma-bids-folders:v1),
   shared by both boards. */
const BOARD_NAME = document.body.dataset.board;
const OPEN_STATUSES = ["Sent", "Pending", "In progress"];
const STATUSES = ["Sent", "Won", "Lost", "Declined", "Pending", "In progress"];
const STATUS_SORT = ["Sent", "In progress", "Pending", "Won", "Lost", "Declined"];
const LS_OVERLAY = "sharma-bids-overlay:v1";
const LS_FOLDERS = "sharma-bids-folders:v1";
/* CONFIG — Follow-up button target: Jarvis's Muse Mail mailbox
   ("Jarvis, on behalf of Sanjay"), approved by Sanjay 2026-11-19.
   This is the single place the address lives; change it here only. */
const JARVIS_FOLLOWUP_EMAIL = "jarvis-sharma@muse.ai";
const LS_FOLLOWUPS = "sharma-bids-followups:v1";
const LS_SORT = "sharma-bids-sort:" + BOARD_NAME;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const ID_FIELDS = ["builder", "project", "plan_name", "trade", "address"];
function computeIds(list, board) {
  const seen = {};
  list.forEach(r => {
    const base = slugify([board].concat(ID_FIELDS.map(k => r[k] || "")).join("|"));
    const n = (seen[base] || 0) + 1; seen[base] = n;
    r.id = n === 1 ? base : base + "-" + n;
  });
}
function parseDatePart(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
const fmtDateObj = d => d ? d.toISOString().slice(0, 10) : "";
const fmtDate = s => { const d = parseDatePart(s); return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : (s || ""); };
function amountOf(r) {
  if (typeof r.amount_value === "number") return r.amount_value;
  const v = parseFloat(String(r.amount || "").replace(/[$,]/g, "").trim());
  return isNaN(v) ? null : v;
}
function fmtUSD(v) {
  if (v === null || v === undefined) return "";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v % 1 ? 2 : 0 });
}
function sqftOf(r, kind) {
  const v = r["sqft_" + kind + "_value"];
  if (typeof v === "number") return v;
  const n = parseFloat(String(r["sqft_" + kind] || "").replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}
const fmtSF = v => (v === null || v === undefined) ? "" : v.toLocaleString("en-US") + " sq ft";
const isMutual = r => /mutually exclusive/i.test((r.amount_notes || "") + " " + (r.notes || ""));
function initials(name) {
  const words = String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[1][0] : "")).toUpperCase();
}
function logoHtml(r, cls) {
  const slug = r.logo || slugify(r.builder);
  return `<span class="bid-logo-wrap ${cls || ""}"><span class="bid-badge">${esc(initials(r.builder))}</span><img class="bid-logo" src="assets/logos/${esc(slug)}.png" alt="" loading="lazy" onerror="this.remove()"></span>`;
}
function chip(status) {
  const cls = { "Sent": "chip-sent", "Won": "chip-won", "Lost": "chip-lost", "Declined": "chip-declined", "Pending": "chip-pending", "In progress": "chip-inprogress" }[status] || "";
  return `<span class="chip ${cls}">${esc(status)}</span>`;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600); }

/* ---------- persistent stores ---------- */
function lsGet(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ } }
let overlay = lsGet(LS_OVERLAY, {});
let folders = lsGet(LS_FOLDERS, []);
let fuMarks = lsGet(LS_FOLLOWUPS, {});   // rowId -> "YYYY-MM-DD" the follow-up was requested
let fuTargets = [];                      // rows the follow-up confirm sheet will ask about
const saveOverlay = () => lsSet(LS_OVERLAY, overlay);
const saveFolders = () => lsSet(LS_FOLDERS, folders);

/* ---------- data ---------- */
let BOARD = null;      // this board's payload from the envelope (base state)
let AS_OF = "2026-11-18";
let rows = [];         // effective rows for this board (base + overlay)
let baseById = {};     // id -> base row, both boards
const state = { q: "", status: "", trade: "", builder: "", dueWin: "", sentWin: "", view: "", sort: lsGet(LS_SORT, "due"), selectMode: false, selected: new Set() };
let detailId = null;
let folderTargets = [];

const baseOf = id => baseById[id] || null;
function effOf(base) {
  const ov = overlay[base.id];
  const r = Object.assign({}, base);
  if (ov) {
    if ("status" in ov) r.status = ov.status;
    if ("folder" in ov) r.folder = ov.folder;
    if ("archived" in ov) r.archived = ov.archived;
  }
  r.folder = r.folder || "";
  r.archived = !!r.archived;
  return r;
}
function rebuildEffective() { rows = (BOARD ? BOARD.rows : []).map(effOf); }
const labelOf = r => [r.builder, r.project, r.trade].filter(Boolean).join(" — ");
function pruneOverlay() {
  let changed = false;
  Object.keys(overlay).forEach(id => {
    const base = baseOf(id), ov = overlay[id];
    if (!base || !ov) return;
    ["status", "folder", "archived"].forEach(k => {
      if (k in ov) {
        const bv = k === "archived" ? !!base[k] : (base[k] || "");
        if (ov[k] === bv) { delete ov[k]; changed = true; }
      }
    });
    if (!("status" in ov) && !("folder" in ov) && !("archived" in ov)) { delete overlay[id]; changed = true; }
  });
  if (changed) saveOverlay();
}
function setOverlay(id, patch) {
  const base = baseOf(id); if (!base) return;
  const ov = overlay[id] || (overlay[id] = { _label: labelOf(base), _board: base._boardName || BOARD_NAME });
  Object.assign(ov, patch);
  pruneOverlay(); saveOverlay(); rebuildEffective();
}
const changeCount = () => Object.keys(overlay).length;
const liveRows = () => rows.filter(r => !r.archived);

/* ---------- totals (same math as before: open pipeline with mutually
   exclusive option groups counting highest only; archived rows are out) ---------- */
function computeTotals(list, asOfStr) {
  const asOf = parseDatePart(asOfStr), day = 86400000;
  const groups = {};
  list.forEach((r, i) => {
    if (isMutual(r) && OPEN_STATUSES.includes(r.status)) {
      const k = [r.builder, r.project, r.trade].join("|");
      (groups[k] = groups[k] || []).push(i);
    }
  });
  const excludedIdx = new Set();
  Object.values(groups).forEach(idxs => {
    if (idxs.length < 2) return;
    let maxI = idxs[0];
    idxs.forEach(i => { if ((amountOf(list[i]) || 0) > (amountOf(list[maxI]) || 0)) maxI = i; });
    idxs.forEach(i => { if (i !== maxI) excludedIdx.add(i); });
  });
  let pipeline = 0, won = 0, lost = 0, wonN = 0, lostN = 0, due7 = 0;
  const dueList = [];
  list.forEach((r, i) => {
    const a = amountOf(r) || 0;
    if (OPEN_STATUSES.includes(r.status) && !excludedIdx.has(i)) pipeline += a;
    if (r.status === "Won") { won += a; wonN++; }
    if (r.status === "Lost") { lost += a; lostN++; }
    const due = parseDatePart(r.due_date);
    if (due && asOf) {
      const diff = Math.round((due - asOf) / day);
      if (diff >= 0 && diff <= 7) due7++;
      if (OPEN_STATUSES.includes(r.status) && diff <= 0) dueList.push({ r, due, diff });
    }
  });
  dueList.sort((x, y) => x.due - y.due);
  const winRate = (wonN + lostN) ? (wonN / (wonN + lostN)) * 100 : null;
  return { pipeline, won, lost, wonN, lostN, due7, dueList, winRate, excludedCount: excludedIdx.size };
}

/* ---------- filtering + sorting ---------- */
function viewRows() {
  const asOf = parseDatePart(AS_OF), day = 86400000;
  let out = rows.filter(r => {
    if (state.view === "__archived") { if (!r.archived) return false; }
    else {
      if (r.archived) return false;
      if (state.view === "__unfiled" && r.folder) return false;
      if (state.view && state.view !== "__unfiled" && r.folder !== state.view) return false;
    }
    if (state.status && r.status !== state.status) return false;
    if (state.trade && r.trade !== state.trade) return false;
    if (state.builder && r.builder !== state.builder) return false;
    if (state.q) {
      const hay = [r.builder, r.project, r.address, r.contact_name, r.contact_email, r.jobber, r.plan_name, r.notes, r.next_step, r.folder].join(" ").toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    if (state.dueWin) {
      const due = parseDatePart(r.due_date);
      if (state.dueWin === "none") { if (due) return false; }
      else if (!due) return false;
      else {
        const diff = Math.round((due - asOf) / day);
        if (state.dueWin === "today" && diff !== 0) return false;
        if (state.dueWin === "overdue" && diff >= 0) return false;
        if (state.dueWin === "7" && !(diff >= 0 && diff <= 7)) return false;
        if (state.dueWin === "30" && !(diff >= 0 && diff <= 30)) return false;
      }
    }
    if (state.sentWin) {
      const sent = parseDatePart(r.date_sent);
      if (!sent) return false;
      const diff = Math.round((asOf - sent) / day);
      if (diff < 0 || diff > +state.sentWin) return false;
    }
    return true;
  });
  return sortRows(out);
}
function sortRows(list) {
  const idx = new Map(list.map((r, i) => [r, i]));
  const FAR = new Date(8640000000000000).getTime();
  const dueT = r => { const d = parseDatePart(r.due_date); return d ? d.getTime() : FAR; };
  const byDue = (a, b) => dueT(a) - dueT(b);
  const stable = (a, b, c) => c || (idx.get(a) - idx.get(b));
  const blankLast = (va, vb, cmp) => {
    const ba = va === "" || va == null, bb = vb === "" || vb == null;
    if (ba && bb) return 0; if (ba) return 1; if (bb) return -1;
    return cmp(va, vb);
  };
  switch (state.sort) {
    case "builder": return list.slice().sort((a, b) => stable(a, b, blankLast(a.builder, b.builder, (x, y) => String(x).localeCompare(String(y))) || byDue(a, b)));
    case "builder-desc": return list.slice().sort((a, b) => stable(a, b, blankLast(a.builder, b.builder, (x, y) => String(y).localeCompare(String(x))) || byDue(a, b)));
    case "amount-desc": return list.slice().sort((a, b) => stable(a, b, blankLast(amountOf(a), amountOf(b), (x, y) => y - x)));
    case "amount-asc": return list.slice().sort((a, b) => stable(a, b, blankLast(amountOf(a), amountOf(b), (x, y) => x - y)));
    case "status": return list.slice().sort((a, b) => stable(a, b, (STATUS_SORT.indexOf(a.status) - STATUS_SORT.indexOf(b.status)) || byDue(a, b)));
    case "sent": return list.slice().sort((a, b) => stable(a, b, blankLast(a.date_sent, b.date_sent, (x, y) => String(y).localeCompare(String(x)))));
    case "due-desc": return list.slice().sort((a, b) => stable(a, b, blankLast(a.due_date, b.due_date, (x, y) => String(y).localeCompare(String(x)))));
    default: return list.slice().sort((a, b) => stable(a, b, byDue(a, b)));
  }
}

/* ---------- render ---------- */
function folderList() {
  const names = folders.slice();
  rows.forEach(r => { if (r.folder && !names.includes(r.folder)) names.push(r.folder); });
  return names;
}
function render() {
  const live = liveRows();
  const t = computeTotals(live, AS_OF);
  const archN = rows.length - live.length;
  $("#totals").innerHTML = `
    <div class="total"><div class="label">Open pipeline</div><div class="value">${fmtUSD(t.pipeline)}</div>
      <div class="note">Sent, Pending and In progress${t.excludedCount ? `; mutually exclusive options count highest only (${t.excludedCount} option row${t.excludedCount > 1 ? "s" : ""} not summed)` : ""}</div></div>
    <div class="total"><div class="label">Won total</div><div class="value">${fmtUSD(t.won)}</div><div class="note">${t.wonN} won bid${t.wonN === 1 ? "" : "s"}</div></div>
    <div class="total"><div class="label">Lost total</div><div class="value">${fmtUSD(t.lost)}</div><div class="note">${t.lostN} lost bid${t.lostN === 1 ? "" : "s"}</div></div>
    <div class="total"><div class="label">Due in next 7 days</div><div class="value">${t.due7}</div><div class="note">From ${AS_OF} (date part of due date)</div></div>
    <div class="total"><div class="label">Win rate</div><div class="value">${t.winRate === null ? "—" : t.winRate.toFixed(1) + "%"}</div>
      <div class="note">Won + Lost rows only (${t.wonN} won, ${t.lostN} lost)</div></div>
    <div class="total"><div class="label">Bids on board</div><div class="value">${live.length}</div><div class="note">${archN ? archN + " archived, hidden from the board" : "All rows from the data file"}</div></div>`;
  const ul = $("#due-list");
  ul.innerHTML = t.dueList.length ? t.dueList.map(({ r, due, diff }) => `
      <li data-id="${esc(r.id)}"><span class="due-when">${diff < 0 ? "Overdue — due " + fmtDateObj(due) : diff === 0 ? "Due today — " + esc(r.due_date) : "Due " + fmtDateObj(due)}</span>
      <span class="due-builder">${esc(r.builder)}</span><span>${esc(r.project)}</span>${r.address ? `<span class="loc">${esc(r.address)}</span>` : ""}
      <span>${esc(r.trade)}</span><span class="mono">${fmtUSD(amountOf(r))}</span>${chip(r.status)}</li>`).join("")
    : `<li class="empty" style="border:none">No open bids due today or overdue as of ${AS_OF}.</li>`;

  /* status chips + sidebar status */
  const counts = {}; live.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  $("#statusChips").innerHTML = [`<button data-st="" aria-pressed="${!state.status}">All (${live.length})</button>`]
    .concat(STATUSES.filter(s => counts[s]).map(s => `<button data-st="${esc(s)}" aria-pressed="${state.status === s}">${esc(s)} (${counts[s]})</button>`)).join("");
  $("#side-status").innerHTML = [`<button class="side-item" data-st="">All statuses<span class="side-count">${live.length}</span></button>`]
    .concat(STATUSES.filter(s => counts[s]).map(s => `<button class="side-item" data-st="${esc(s)}" aria-current="${state.status === s}">${esc(s)}<span class="side-count">${counts[s]}</span></button>`)).join("");
  const stSel = $("#f-status"); if (stSel.value !== state.status) stSel.value = state.status;

  /* folders: chips (narrow) + sidebar (wide) */
  const names = folderList();
  const fcount = {}; live.forEach(r => { if (r.folder) fcount[r.folder] = (fcount[r.folder] || 0) + 1; });
  const unfiled = live.filter(r => !r.folder).length;
  $("#folderChips").innerHTML = [`<button data-view="" aria-pressed="${state.view === ""}">All</button>`,
    `<button data-view="__unfiled" aria-pressed="${state.view === "__unfiled"}">Unfiled (${unfiled})</button>`]
    .concat(names.map(f => `<button data-view="${esc(f)}" aria-pressed="${state.view === f}">${esc(f)} (${fcount[f] || 0})</button>`))
    .concat([`<button data-view="__archived" aria-pressed="${state.view === "__archived"}">Archived (${archN})</button>`]).join("");
  $("#side-folders").innerHTML = names.length ? names.map(f => `<button class="side-item" data-view="${esc(f)}" aria-current="${state.view === f}">${esc(f)}<span class="side-count">${fcount[f] || 0}</span></button>`).join("") : `<p class="side-empty">No folders yet</p>`;
  $$("#sidebar [data-view]").forEach(b => { if (b.dataset.view === state.view) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
  const cAll = $("[data-count='all']"), cUn = $("[data-count='unfiled']"), cAr = $("[data-count='archived']");
  if (cAll) cAll.textContent = live.length; if (cUn) cUn.textContent = unfiled; if (cAr) cAr.textContent = archN;

  const list = viewRows();
  $("#rows").innerHTML = list.length ? list.map(r => `<tr data-id="${esc(r.id)}" tabindex="0" class="${state.selected.has(r.id) ? "is-selected" : ""} ${detailId === r.id ? "is-open" : ""}">
    <td class="sel-col">${state.selectMode ? `<label class="sel-hit"><input type="checkbox" data-sel="${esc(r.id)}" ${state.selected.has(r.id) ? "checked" : ""} aria-label="Select bid"></label>` : ""}</td>
    <td data-label="Builder">${logoHtml(r)}<strong>${esc(r.builder)}</strong>${r.contact_name ? `<br>${esc(r.contact_name)}` : ""}${r.contact_email ? `<br><a href="mailto:${esc(r.contact_email.split(";")[0].trim())}" onclick="event.stopPropagation()">${esc(r.contact_email)}</a>` : ""}</td>
    <td data-label="Project">${esc(r.project)}${r.plan_name ? `<br>${esc(r.plan_name)}` : ""}${r.address ? `<br><span class="loc">${esc(r.address)}</span>` : ""}${r.folder ? `<br><span class="folder-tag">${esc(r.folder)}</span>` : ""}${fuMarks[r.id] ? `<br><span class="fu-tag">Follow-up requested · ${esc(fmtDate(fuMarks[r.id]))}</span>` : ""}</td>
    <td data-label="Trade">${esc(r.trade)}</td>
    <td data-label="Amount" class="amount">${fmtUSD(amountOf(r))}</td>
    <td data-label="Sq Ft" class="sqft">${fmtSF(sqftOf(r, "living"))}${sqftOf(r, "roof") !== null ? `<br><span class="loc2">under roof ${fmtSF(sqftOf(r, "roof"))}</span>` : ""}</td>
    <td data-label="Sent" class="mono">${esc(r.date_sent)}</td>
    <td data-label="Due" class="mono">${esc(r.due_date)}</td>
    <td data-label="Status">${chip(r.status)}</td>
    <td data-label="Jobber" class="mono">${esc(r.jobber)}</td></tr>`).join("")
    : `<tr><td colspan="10" class="empty">No bids match these filters.</td></tr>`;
  $("#cards").innerHTML = list.map(r => `<article class="bid-card ${state.selected.has(r.id) ? "is-selected" : ""}" data-id="${esc(r.id)}">
    ${state.selectMode ? `<label class="sel-hit card-check"><input type="checkbox" data-sel="${esc(r.id)}" ${state.selected.has(r.id) ? "checked" : ""} aria-label="Select bid"></label>` : ""}
    <div class="card-top"><span class="builder-cell">${logoHtml(r)}<strong>${esc(r.builder) || "No builder"}</strong></span>${chip(r.status)}</div>
    <div class="card-proj">${esc(r.project)}</div>
    ${r.plan_name ? `<div class="card-sub">${esc(r.plan_name)}</div>` : ""}
    ${r.address ? `<div class="card-sub"><span class="loc">${esc(r.address)}</span></div>` : ""}
    <div class="card-meta"><span>${esc(r.trade)}</span><span>${fmtUSD(amountOf(r)) || "No amount"}</span><span>${fmtSF(sqftOf(r, "living"))}</span><span>${r.due_date ? "Due " + esc(r.due_date) : ""}</span>${r.folder ? `<span class="folder-tag">${esc(r.folder)}</span>` : ""}${fuMarks[r.id] ? `<span class="fu-tag">Follow-up requested · ${esc(fmtDate(fuMarks[r.id]))}</span>` : ""}</div>
    ${r.next_step ? `<div class="card-next">${esc(r.next_step)}</div>` : ""}
  </article>`).join("");
  $("#row-count").textContent = `${list.length} of ${rows.length} bids shown`;
  $("#changesCount").textContent = changeCount();
  renderActionbar();
  updateBadge();
}

/* App badge (App Readiness, client-only): bids due today or tomorrow,
   excluding Won / Lost / archived. Each board stashes its count with
   today's date (bb_due_<board>); the badge shows the sum of the counts
   stamped today, and clears at 0. It refreshes when a board is opened —
   background updates arrive only with push (not yet wired). */
function updateBadge() {
  try {
    if (!("setAppBadge" in navigator)) return;
    const now = new Date();
    const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const today = iso(now), tomorrow = iso(new Date(now.getTime() + 86400000));
    const n = rows.filter(r => {
      if (r.archived || r.status === "Won" || r.status === "Lost") return false;
      const due = String(r.due_date || "").slice(0, 10);
      return due === today || due === tomorrow;
    }).length;
    lsSet("bb_due_" + BOARD_NAME, { count: n, date: today });
    let sum = 0;
    ["commercial", "residential"].forEach(b => { const s = lsGet("bb_due_" + b, null); if (s && s.date === today) sum += s.count || 0; });
    if (sum > 0) { const p = navigator.setAppBadge(sum); if (p && p.catch) p.catch(() => {}); }
    else if ("clearAppBadge" in navigator) { const p = navigator.clearAppBadge(); if (p && p.catch) p.catch(() => {}); }
  } catch (e) { /* badge is best-effort */ }
}

/* ---------- select mode + bulk actions ---------- */
function renderActionbar() {
  const bar = $("#actionbar");
  bar.hidden = !state.selectMode;
  const n = state.selected.size;
  $("#selCount").textContent = n === 1 ? "1 selected" : n + " selected";
  ["#ab-won", "#ab-lost", "#ab-archive", "#ab-folder", "#ab-followup"].forEach(s => { $(s).disabled = n === 0; });
  $("#ab-archive").textContent = state.view === "__archived" ? "Unarchive" : "Archive";
  $("#btn-select").setAttribute("aria-pressed", String(state.selectMode));
  $("#btn-select").textContent = state.selectMode ? "Selecting…" : "Select";
  document.body.classList.toggle("selecting", state.selectMode);
}
function setSelectMode(on) { state.selectMode = on; if (!on) state.selected.clear(); render(); }
function toggleSelected(id) { state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); render(); }
function bulk(patch, verb) {
  const ids = Array.from(state.selected);
  if (!ids.length) return;
  ids.forEach(id => setOverlay(id, patch));
  state.selected.clear();
  render();
  toast(ids.length + (ids.length === 1 ? " bid " : " bids ") + verb + " — saved on this device");
}

/* ---------- folders ---------- */
function createFolder(name) {
  name = String(name || "").trim();
  if (!name) return null;
  if (["__archived", "__unfiled"].includes(name)) { toast("That name is reserved"); return null; }
  if (!folders.some(f => f.toLowerCase() === name.toLowerCase())) { folders.push(name); saveFolders(); }
  return folders.find(f => f.toLowerCase() === name.toLowerCase());
}
function openFolderSheet(ids) {
  folderTargets = ids.slice();
  if (!folderTargets.length) return;
  $("#folderList").innerHTML = [`<button class="folder-opt" data-folder="">No folder (Unfiled)</button>`]
    .concat(folderList().map(f => `<button class="folder-opt" data-folder="${esc(f)}">${esc(f)}</button>`)).join("");
  $("#newFolderName").value = "";
  $("#folderDlg").showModal();
}
function assignFolder(name) {
  folderTargets.forEach(id => setOverlay(id, { folder: name || "" }));
  if (state.selected.size) state.selected.clear();
  folderTargets = [];
  $("#folderDlg").close();
  render();
  toast(name ? "Moved to “" + name + "” — saved on this device" : "Removed from folder — saved on this device");
}
function renameFolder(oldName, newName) {
  newName = String(newName || "").trim();
  if (!newName || newName === oldName) return;
  if (folders.some(f => f.toLowerCase() === newName.toLowerCase() && f !== oldName)) { toast("A folder with that name already exists"); return; }
  folders = folders.map(f => f === oldName ? newName : f); saveFolders();
  Object.values(baseById).forEach(b => { if (effOf(b).folder === oldName) setOverlay(b.id, { folder: newName }); });
  if (state.view === oldName) state.view = newName;
  rebuildEffective(); render(); renderFolderManager();
  toast("Folder renamed");
}
function deleteFolder(name) {
  folders = folders.filter(f => f !== name); saveFolders();
  Object.values(baseById).forEach(b => { if (effOf(b).folder === name) setOverlay(b.id, { folder: "" }); });
  if (state.view === name) state.view = "";
  rebuildEffective(); render(); renderFolderManager();
  toast("Folder deleted — its bids are unfiled");
}
function renderFolderManager() {
  const names = folderList();
  $("#folderManager").innerHTML = names.length ? names.map(f => `<div class="folder-row"><input type="text" value="${esc(f)}" data-fname="${esc(f)}" aria-label="Folder name"><button class="secondary" data-rename="${esc(f)}">Rename</button><button class="secondary" data-del="${esc(f)}">Delete</button></div>`).join("") : `<p class="note">No folders yet. Select bids and use Folder… to create one.</p>`;
}

/* ---------- changes sheet ---------- */
function changesLines() {
  const lines = [], items = [];
  Object.keys(overlay).sort().forEach(id => {
    const ov = overlay[id], base = baseOf(id);
    const label = ov._label || (base ? labelOf(base) : id);
    const board = ov._board || (base ? base._boardName : "") || BOARD_NAME;
    if (!base) { items.push({ id, label, board, text: "This bid is no longer on the board." }); return; }
    const parts = [];
    if ("status" in ov) { parts.push(`Status: ${base.status || "—"} → ${ov.status}`); lines.push(`${board} | ${id} | status=${ov.status}`); }
    if ("folder" in ov) { parts.push(`Folder: ${base.folder || "Unfiled"} → ${ov.folder || "Unfiled"}`); lines.push(`${board} | ${id} | folder=${ov.folder}`); }
    if ("archived" in ov) { parts.push(ov.archived ? "Archived" : "Un-archived"); lines.push(`${board} | ${id} | archived=${ov.archived ? "true" : "false"}`); }
    if (parts.length) items.push({ id, label, board, text: parts.join(" · ") });
  });
  return { lines, items };
}
function renderChanges() {
  const { lines, items } = changesLines();
  $("#changesSummary").textContent = items.length ? items.length + (items.length === 1 ? " bid" : " bids") + " with changes saved on this device. They reach the published boards when Jarvis folds them into the CSVs and re-encrypts." : "No changes yet. Use Select on a board to mark bids Won / Lost, archive them, or file them in folders.";
  $("#changesList").innerHTML = items.map(it => `<div class="change-row"><div><strong>${esc(it.label)}</strong><br><small>${esc(it.board)} · ${esc(it.text)}</small></div><button class="secondary" data-undo="${esc(it.id)}">Undo</button></div>`).join("");
  $("#changesText").value = ["# Bid changes to publish — from the Bid Boards app (this device).",
    "# Jarvis: for each line, find the row in bid-boards/data/bids-<board>.csv whose",
    "# computed id matches (tools/build_plain.py derives it), set the field, then",
    "# rebuild + re-encrypt + publish. folder= with nothing after it means unfiled."].concat(lines).join("\n");
}

/* ---------- detail (dialog on narrow screens, inspector panel on wide) ---------- */
function filesHTML(r) {
  const files = Array.isArray(r.files) ? r.files : [];
  if (!files.length) return `<dt>Files</dt><dd>No files on record</dd>`;
  const items = files.map(f => {
    const name = f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>` : esc(f.name);
    const when = f.date ? " · " + fmtDate(f.date) : "";
    const tag = f.url ? "" : ` <span class="onfile">On file</span>`;
    return `<li><span class="file-kind" data-k="${esc(f.kind)}">${esc(f.kind)}</span> <span class="file-name">${name}</span><small>${when}</small>${tag}</li>`;
  }).join("");
  return `<dt>Files</dt><dd><ul class="files">${items}</ul></dd>`;
}
function detailHTML(r) {
  const labels = { builder: "Builder", contact_name: "Contact", contact_email: "Contact email", project: "Project",
    address: "Address", plan_name: "Plan", trade: "Trade", amount: "Amount", amount_notes: "Amount notes", terms: "Terms",
    date_sent: "Date sent", due_date: "Due date", status: "Status", gmail_account: "Gmail account",
    gmail_thread_id: "Gmail thread ID", jobber: "Jobber", houses: "Houses", next_step: "Next step", notes: "Notes", source: "Source",
    sqft_living: BOARD_NAME === "commercial" ? "Project sq ft" : "Living SF", sqft_roof: "Under Roof SF" };
  const fields = (BOARD.fields || Object.keys(labels)).filter(k => k in labels);
  const dl = fields.map(k => {
    let v = k === "amount" ? (fmtUSD(amountOf(r)) || "") : (k === "sqft_living" || k === "sqft_roof") ? fmtSF(sqftOf(r, k.slice(5))) : r[k];
    if (k === "address" && v) v = `<span class="loc">${esc(v)}</span>`;
    else if (k === "contact_email" && v) v = `<a href="mailto:${esc(String(v).split(";")[0].trim())}">${esc(v)}</a>`;
    else v = esc(v || "");
    return `<dt>${labels[k]}</dt><dd>${v || '<span style="color:var(--gray)">—</span>'}</dd>`;
  }).join("");
  return `<div class="detail-head"><h2>${logoHtml(r, "detail-logo")}${esc(r.builder + " — " + r.project)}</h2></div>
  <div class="detail-body"><dl>${dl}
  <dt>Folder</dt><dd>${esc(r.folder || "Unfiled")}</dd>
  ${r.archived ? `<dt>Archived</dt><dd>Yes — hidden from the board lists</dd>` : ""}
  ${fuMarks[r.id] ? `<dt>Follow-up</dt><dd>Requested · ${esc(fmtDate(fuMarks[r.id]))} (marked on this device — Jarvis confirms in chat when the draft is ready)</dd>` : ""}
  ${filesHTML(r)}</dl>
  <div class="row-btns detail-actions">
    ${r.contact_email ? `<button data-act="followup">Follow up</button>` : ""}
    <button data-act="folder">Move to folder…</button>
    <button class="secondary" data-act="archive">${r.archived ? "Unarchive" : "Archive"}</button>
  </div></div>`;
}
function openDetail(id) {
  const r = rows.find(x => x.id === id); if (!r) return;
  detailId = id;
  const html = detailHTML(r);
  if (window.matchMedia("(min-width: 1100px)").matches) {
    $("#inspectorBody").innerHTML = html;
    $("#inspector").hidden = false;
    if ($("#detail").open) $("#detail").close();
  } else {
    $("#detailBody").innerHTML = html;
    $("#inspector").hidden = true;
    if (!$("#detail").open) $("#detail").showModal();
  }
  render();
}
function closeDetail() {
  detailId = null;
  $("#inspector").hidden = true;
  if ($("#detail").open) $("#detail").close();
  render();
}
function detailAction(act) {
  const r = rows.find(x => x.id === detailId); if (!r) return;
  if (act === "folder") { if ($("#detail").open) $("#detail").close(); openFolderSheet([r.id]); }
  if (act === "archive") { setOverlay(r.id, { archived: !r.archived }); toast(r.archived ? "Bid archived — saved on this device" : "Bid un-archived"); closeDetail(); render(); }
  if (act === "followup") { if ($("#detail").open) $("#detail").close(); openFollowup([r]); }
}

/* ---------- follow-up requests ----------
   The Follow up button NEVER contacts the builder. It opens the phone's
   Mail with a prefilled request to Jarvis (JARVIS_FOLLOWUP_EMAIL above);
   one tap in Mail sends it. Jarvis then drafts the follow-up in office@
   on the original thread — draft only, Sanjay approves before any send.
   The local mark (LS_FOLLOWUPS) means "requested", nothing more: Jarvis's
   chat confirmation is the completion signal. Marks deliberately live
   OUTSIDE the changes overlay so they never reach the CSVs. */
function fuToday() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function followupBlock(r) {
  return ["Board: " + (r._boardName === "residential" ? "Residential" : "Commercial"),
    "Builder: " + (r.builder || ""),
    "Project: " + (r.project || ""),
    "Contact: " + [r.contact_name, r.contact_email].filter(Boolean).join(" · "),
    "Trade: " + (r.trade || ""),
    "Address: " + (r.address || ""),
    "Status: " + (r.status || ""),
    "Amount: " + (fmtUSD(amountOf(r)) || ""),
    "Date sent: " + (r.date_sent || ""),
    "Due date: " + (r.due_date || ""),
    "Gmail thread ID: " + (r.gmail_thread_id || ""),
    "Next step: " + (r.next_step || ""),
    "Row ID: " + r.id].join("\n");
}
function followupMailto(list) {
  const subject = list.length === 1 ? `FOLLOW UP: ${list[0].project} — ${list[0].builder}` : `FOLLOW UP: ${list.length} bids`;
  const body = "Please draft a follow-up for the bid(s) below — draft only, on the original thread where one exists. Sanjay approves before anything is sent.\n\n"
    + list.map(followupBlock).join("\n---\n");
  return `mailto:${JARVIS_FOLLOWUP_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function openFollowup(candidates) {
  fuTargets = candidates.filter(r => r.contact_email);
  const skipped = candidates.length - fuTargets.length;
  if (fuTargets.length === 1) {
    const r = fuTargets[0];
    $("#fuText").textContent = `Ask Jarvis to draft a follow-up to ${r.contact_name || r.contact_email} at ${r.builder} for ${r.project}?`;
  } else {
    $("#fuText").textContent = `Ask Jarvis to draft follow-ups for ${fuTargets.length} bids?`;
  }
  $("#fuDetails").innerHTML = fuTargets.map(r => `<div class="change-row"><div><strong>${esc(r.project)}</strong><br><small>${esc(r.builder)} · ${esc(r.contact_name || r.contact_email)}${fuMarks[r.id] ? " · already requested " + esc(fmtDate(fuMarks[r.id])) : ""}</small></div></div>`).join("")
    + (skipped ? `<p class="note">${skipped} selected bid${skipped === 1 ? " has" : "s have"} no contact email on record and will be skipped — Jarvis never guesses a contact.</p>` : "")
    + `<p class="note">This opens your Mail with a prefilled request to Jarvis (${esc(JARVIS_FOLLOWUP_EMAIL)}). One tap in Mail sends the request. The button itself sends nothing to the builder.</p>`;
  $("#fu-confirm").disabled = !fuTargets.length;
  $("#followupDlg").showModal();
}
function confirmFollowup() {
  if (!fuTargets.length) return;
  const url = followupMailto(fuTargets);
  const today = fuToday();
  fuTargets.forEach(r => { fuMarks[r.id] = today; });
  lsSet(LS_FOLLOWUPS, fuMarks);
  fuTargets = [];
  $("#followupDlg").close();
  if (state.selected.size) state.selected.clear();
  render();
  toast("Opening Mail — request to Jarvis; marked on this device");
  window.location.href = url;
}

/* ---------- CSV import / export (keeps the folder + archived columns) ---------- */
function parseCSV(text) {
  const out = []; let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  if (!out.length) return [];
  const head = out[0].map(h => h.trim().toLowerCase());
  return out.slice(1).filter(r => r.some(c => String(c).trim() !== "")).map(cells => {
    const o = {};
    BOARD.fields.forEach(k => { const idx = head.indexOf(k); o[k] = idx >= 0 ? String(cells[idx] ?? "").trim() : ""; });
    o.amount_value = amountOf(o);
    o.sqft_living_value = sqftOf(o, "living"); o.sqft_roof_value = sqftOf(o, "roof");
    o.logo = slugify(o.builder);
    o.archived = ["true", "1", "yes"].includes(String(o.archived).toLowerCase());
    o.files = [];
    return o;
  });
}
function toCSV(list) {
  const fields = BOARD.fields;
  const cell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [fields.join(",")].concat(list.map(r => fields.map(f => {
    if (f === "archived") return r.archived ? "true" : "";
    if (f === "amount") return amountOf(r) != null ? amountOf(r) : (r.amount || "");
    return cell(r[f]);
  }).join(","))).join("\r\n") + "\r\n";
}

/* ---------- wiring ---------- */
function fillFilters() {
  const uniq = key => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const fill = (id, vals, allLabel) => { const el = $(id); const cur = el.value; el.innerHTML = `<option value="">${allLabel}</option>` + vals.map(v => `<option>${esc(v)}</option>`).join(""); el.value = cur; };
  fill("#f-status", STATUSES, "All statuses");
  fill("#f-trade", uniq("trade"), "All trades");
  fill("#f-builder", uniq("builder"), "All builders");
}
function wire() {
  $("#f-search").addEventListener("input", e => { state.q = e.target.value.trim().toLowerCase(); render(); });
  const sortSel = $("#sortSel");
  sortSel.value = ["due", "due-desc", "builder", "builder-desc", "amount-desc", "amount-asc", "status", "sent"].includes(state.sort) ? state.sort : "due";
  state.sort = sortSel.value;
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; lsSet(LS_SORT, state.sort); render(); });
  $("#btn-filters").addEventListener("click", () => { const f = $("#filters"); f.hidden = !f.hidden; });
  $("#f-status").addEventListener("change", e => { state.status = e.target.value; render(); });
  $("#f-trade").addEventListener("change", e => { state.trade = e.target.value; render(); });
  $("#f-builder").addEventListener("change", e => { state.builder = e.target.value; render(); });
  $("#f-due").addEventListener("change", e => { state.dueWin = e.target.value; render(); });
  $("#f-sent").addEventListener("change", e => { state.sentWin = e.target.value; render(); });
  $("#statusChips").addEventListener("click", e => { const b = e.target.closest("[data-st]"); if (b) { state.status = b.dataset.st; render(); } });
  $("#side-status").addEventListener("click", e => { const b = e.target.closest("[data-st]"); if (b) { state.status = b.dataset.st; render(); } });
  $("#folderChips").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) { state.view = b.dataset.view; render(); } });
  $("#sidebar").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (b) { state.view = b.dataset.view; render(); } });
  $("#btn-clear").addEventListener("click", () => {
    Object.assign(state, { q: "", status: "", trade: "", builder: "", dueWin: "", sentWin: "", view: "" });
    $("#f-search").value = ""; ["#f-status", "#f-trade", "#f-builder", "#f-due", "#f-sent"].forEach(s => { $(s).value = ""; });
    render();
  });

  const pick = e => {
    if (e.target.closest("a")) return;
    const cb = e.target.closest("[data-sel]");
    if (cb) { toggleSelected(cb.dataset.sel); return; }
    if (e.target.closest("label.sel-hit")) return; /* the label's synthesized input click does it */
    const el = e.target.closest("[data-id]");
    if (!el) return;
    if (state.selectMode) toggleSelected(el.dataset.id); else openDetail(el.dataset.id);
  };
  $("#rows").addEventListener("click", pick);
  $("#cards").addEventListener("click", pick);
  $("#due-list").addEventListener("click", e => { const li = e.target.closest("[data-id]"); if (li && !state.selectMode) openDetail(li.dataset.id); });
  $("#rows").addEventListener("keydown", e => { const tr = e.target.closest("tr[data-id]"); if (tr && e.key === "Enter" && !state.selectMode) openDetail(tr.dataset.id); });

  $("#btn-select").addEventListener("click", () => setSelectMode(!state.selectMode));
  $("#ab-done").addEventListener("click", () => setSelectMode(false));
  $("#ab-clear").addEventListener("click", () => { state.selected.clear(); render(); });
  $("#ab-won").addEventListener("click", () => bulk({ status: "Won" }, "marked Won"));
  $("#ab-lost").addEventListener("click", () => bulk({ status: "Lost" }, "marked Lost"));
  $("#ab-archive").addEventListener("click", () => bulk({ archived: state.view !== "__archived" }, state.view === "__archived" ? "un-archived" : "archived"));
  $("#ab-folder").addEventListener("click", () => openFolderSheet(Array.from(state.selected)));
  $("#ab-followup").addEventListener("click", () => openFollowup(Array.from(state.selected).map(id => rows.find(r => r.id === id)).filter(Boolean)));
  $("#fu-confirm").addEventListener("click", confirmFollowup);
  $("#fu-cancel").addEventListener("click", () => $("#followupDlg").close());

  $("#folderList").addEventListener("click", e => { const b = e.target.closest("[data-folder]"); if (b) assignFolder(b.dataset.folder); });
  $("#createFolderBtn").addEventListener("click", () => { const name = createFolder($("#newFolderName").value); if (name) assignFolder(name); else if (!$("#newFolderName").value.trim()) toast("Type a folder name first"); });
  $("#folderDlgClose").addEventListener("click", () => $("#folderDlg").close());
  $("#side-new-folder").addEventListener("click", () => { renderFolderManager(); $("#more").showModal(); setTimeout(() => $("#mgrNewFolder").focus(), 60); });

  const detailClick = e => { const b = e.target.closest("[data-act]"); if (b) detailAction(b.dataset.act); };
  $("#detailBody").addEventListener("click", detailClick);
  $("#inspectorBody").addEventListener("click", detailClick);
  $("#detail-close").addEventListener("click", closeDetail);
  $("#insp-close").addEventListener("click", closeDetail);
  $("#detail").addEventListener("close", () => { if (detailId) { detailId = null; render(); } });

  $("#btn-more").addEventListener("click", () => { renderFolderManager(); renderChanges(); $("#more").showModal(); });
  $("#more-close").addEventListener("click", () => $("#more").close());
  $("#openChanges").addEventListener("click", () => { $("#more").close(); renderChanges(); $("#changesDlg").showModal(); });
  $("#changesClose").addEventListener("click", () => $("#changesDlg").close());
  $("#changesList").addEventListener("click", e => { const b = e.target.closest("[data-undo]"); if (!b) return; delete overlay[b.dataset.undo]; saveOverlay(); rebuildEffective(); render(); renderChanges(); toast("Change undone"); });
  $("#copyChanges").addEventListener("click", async () => {
    const ta = $("#changesText"); ta.select();
    try { await navigator.clipboard.writeText(ta.value); toast("Summary copied — send it to Jarvis"); }
    catch (e) { if (document.execCommand) document.execCommand("copy"); toast("Summary selected — copy it and send to Jarvis"); }
  });
  $("#folderManager").addEventListener("click", e => {
    const rn = e.target.closest("[data-rename]"), del = e.target.closest("[data-del]");
    if (rn) { const input = $(`#folderManager input[data-fname="${CSS.escape(rn.dataset.rename)}"]`); if (input) renameFolder(rn.dataset.rename, input.value); }
    if (del) {
      if (del.dataset.armed) deleteFolder(del.dataset.del);
      else { del.dataset.armed = "1"; del.textContent = "Tap again to delete"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "Delete"; }, 3000); }
    }
  });
  $("#mgrAddFolder").addEventListener("click", () => { const name = createFolder($("#mgrNewFolder").value); if (name) { $("#mgrNewFolder").value = ""; render(); renderFolderManager(); toast("Folder “" + name + "” created"); } });

  $("#btn-export").addEventListener("click", () => {
    const blob = new Blob([toCSV(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `bids-${BOARD_NAME}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $("#file-import").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    const imported = parseCSV(await f.text());
    if (!imported.length) { $("#import-note").textContent = "No rows found in that CSV."; return; }
    BOARD.rows = imported;
    computeIds(BOARD.rows, BOARD_NAME);
    BOARD.rows.forEach(r => { r._boardName = BOARD_NAME; baseById[r.id] = r; });
    pruneOverlay(); rebuildEffective(); fillFilters(); render();
    $("#import-note").textContent = `Imported ${imported.length} rows from ${f.name} for this view only. To make it permanent, save the CSV with the board data and re-run the encrypt step (tools/encrypt.py).`;
  });
  $("#btn-locknow").addEventListener("click", () => { try { sessionStorage.removeItem("sharma-bids-key:v1"); } catch (e) {} location.reload(); });
}

/* ---------- boot ---------- */
async function init() {
  if (window.SK && SK.scheme && SK.scheme.mountToggle) SK.scheme.mountToggle($("#appearance"));
  wire();
  const bundle = await window.SharmaLock.load("bids.enc.json", {
    appName: "Sharma Bid Boards", logo: "logo.png",
    blurb: "Enter the office code to see the bids."
  });
  Object.keys(bundle.boards || {}).forEach(bn => {
    bundle.boards[bn].rows.forEach(r => { r._boardName = bn; if (r.id) baseById[r.id] = r; });
  });
  BOARD = bundle.boards[BOARD_NAME];
  /* Envelopes published before the Manage build carry no row ids — derive
     them with the same algorithm build_plain.py uses, so the boards keep
     working until the next encrypt publish lands. */
  if (BOARD.rows.some(r => !r.id)) {
    computeIds(BOARD.rows, BOARD_NAME);
    BOARD.rows.forEach(r => { baseById[r.id] = r; });
  }
  AS_OF = BOARD.asOf || AS_OF;
  $("#as-of").textContent = `Data as of ${AS_OF}. Owner-only board. Prices are internal.`;
  pruneOverlay();
  rebuildEffective();
  fillFilters();
  render();
}
document.addEventListener("DOMContentLoaded", init);
