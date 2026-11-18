"use strict";
/* Shared bid board app — one codebase renders both boards.
   GitHub build: data comes from the decrypted bids.enc.json envelope via lock.js
   (the local private build in the parent folder still uses data/<board>.json).
   The app never sends anything; contact emails are mailto: links only. */
const OPEN_STATUSES = ["Sent", "Pending", "In progress"];
const STATUSES = ["Sent", "Won", "Lost", "Declined", "Pending", "In progress"];
const FIELDS = ["builder","contact_name","contact_email","project","address","plan_name",
  "trade","amount","amount_notes","terms","date_sent","due_date","status",
  "gmail_account","gmail_thread_id","jobber","houses","next_step","notes","source"];

let state = { board: null, title: "", asOf: "2026-11-18", rows: [], filtered: [] };

function parseDatePart(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function fmtDate(d) { return d ? d.toISOString().slice(0, 10) : ""; }
function amountOf(r) {
  if (typeof r.amount_value === "number") return r.amount_value;
  const s = String(r.amount || "").replace(/[$,]/g, "").trim();
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}
function fmtUSD(v) {
  if (v === null || v === undefined) return "";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v % 1 ? 2 : 0 });
}
function isMutual(r) { return /mutually exclusive/i.test((r.amount_notes || "") + " " + (r.notes || "")); }

function computeTotals(rows, asOfStr) {
  const asOf = parseDatePart(asOfStr);
  const day = 86400000;
  // Mutually exclusive groups: builder|project|trade among open rows flagged mutual.
  const groups = {};
  rows.forEach((r, i) => {
    if (isMutual(r) && OPEN_STATUSES.includes(r.status)) {
      const k = [r.builder, r.project, r.trade].join("|");
      (groups[k] = groups[k] || []).push(i);
    }
  });
  const excludedIdx = new Set();
  Object.values(groups).forEach(idxs => {
    if (idxs.length < 2) return;
    let maxI = idxs[0];
    idxs.forEach(i => { if ((amountOf(rows[i]) || 0) > (amountOf(rows[maxI]) || 0)) maxI = i; });
    idxs.forEach(i => { if (i !== maxI) excludedIdx.add(i); });
  });
  let pipeline = 0, won = 0, lost = 0, wonN = 0, lostN = 0, due7 = 0;
  const dueList = [];
  rows.forEach((r, i) => {
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

function chip(status) {
  const cls = { "Sent": "chip-sent", "Won": "chip-won", "Lost": "chip-lost",
    "Declined": "chip-declined", "Pending": "chip-pending", "In progress": "chip-inprogress" }[status] || "";
  return `<span class="chip ${cls}">${escapeHtml(status)}</span>`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderTotals() {
  const t = computeTotals(state.rows, state.asOf);
  document.getElementById("totals").innerHTML = `
    <div class="total"><div class="label">Open pipeline</div><div class="value">${fmtUSD(t.pipeline)}</div>
      <div class="note">Sent, Pending and In progress${t.excludedCount ? `; mutually exclusive options count highest only (${t.excludedCount} option row${t.excludedCount > 1 ? "s" : ""} not summed)` : ""}</div></div>
    <div class="total"><div class="label">Won total</div><div class="value">${fmtUSD(t.won)}</div><div class="note">${t.wonN} won bid${t.wonN === 1 ? "" : "s"}</div></div>
    <div class="total"><div class="label">Lost total</div><div class="value">${fmtUSD(t.lost)}</div><div class="note">${t.lostN} lost bid${t.lostN === 1 ? "" : "s"}</div></div>
    <div class="total"><div class="label">Due in next 7 days</div><div class="value">${t.due7}</div><div class="note">From ${state.asOf} (date part of due date)</div></div>
    <div class="total"><div class="label">Win rate</div><div class="value">${t.winRate === null ? "—" : t.winRate.toFixed(1) + "%"}</div>
      <div class="note">Won + Lost rows only (${t.wonN} won, ${t.lostN} lost)</div></div>
    <div class="total"><div class="label">Bids on board</div><div class="value">${state.rows.length}</div><div class="note">All rows from the data file</div></div>`;
  const ul = document.getElementById("due-list");
  if (!t.dueList.length) {
    ul.innerHTML = `<li class="empty" style="border:none">No open bids due today or overdue as of ${state.asOf}.</li>`;
  } else {
    ul.innerHTML = t.dueList.map(({ r, due, diff }) => `
      <li><span class="due-when">${diff < 0 ? "Overdue — due " + fmtDate(due) : diff === 0 ? "Due today — " + escapeHtml(r.due_date) : "Due " + fmtDate(due)}</span>
      <span class="due-builder">${escapeHtml(r.builder)}</span><span>${escapeHtml(r.project)}</span>
      <span>${escapeHtml(r.trade)}</span><span class="mono">${fmtUSD(amountOf(r))}</span>${chip(r.status)}</li>`).join("");
  }
}

function uniqueSorted(key) { return [...new Set(state.rows.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function fillFilters() {
  const fill = (id, vals, allLabel) => {
    const el = document.getElementById(id);
    el.innerHTML = `<option value="">${allLabel}</option>` + vals.map(v => `<option>${escapeHtml(v)}</option>`).join("");
  };
  fill("f-status", STATUSES, "All statuses");
  fill("f-trade", uniqueSorted("trade"), "All trades");
  fill("f-builder", uniqueSorted("builder"), "All builders");
}

function applyFilters() {
  const q = document.getElementById("f-search").value.trim().toLowerCase();
  const st = document.getElementById("f-status").value, tr = document.getElementById("f-trade").value,
        bu = document.getElementById("f-builder").value, dw = document.getElementById("f-due").value,
        sw = document.getElementById("f-sent").value, sort = document.getElementById("f-sort").value;
  const asOf = parseDatePart(state.asOf), day = 86400000;
  let rows = state.rows.filter(r => {
    if (st && r.status !== st) return false;
    if (tr && r.trade !== tr) return false;
    if (bu && r.builder !== bu) return false;
    if (q) {
      const hay = [r.builder, r.project, r.address, r.contact_name, r.contact_email, r.jobber, r.plan_name].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (dw) {
      const due = parseDatePart(r.due_date);
      if (dw === "none") { if (due) return false; }
      else if (!due) return false;
      else {
        const diff = Math.round((due - asOf) / day);
        if (dw === "today" && diff !== 0) return false;
        if (dw === "overdue" && diff >= 0) return false;
        if (dw === "7" && !(diff >= 0 && diff <= 7)) return false;
        if (dw === "30" && !(diff >= 0 && diff <= 30)) return false;
      }
    }
    if (sw) {
      const sent = parseDatePart(r.date_sent);
      if (!sent) return false;
      const diff = Math.round((asOf - sent) / day);
      if (diff < 0 || diff > +sw) return false;
    }
    return true;
  });
  const byDue = (a, b) => (parseDatePart(a.due_date) || new Date(8640000000000000)) - (parseDatePart(b.due_date) || new Date(8640000000000000));
  const sorters = {
    due: byDue,
    sent: (a, b) => (parseDatePart(b.date_sent) || 0) - (parseDatePart(a.date_sent) || 0),
    amount: (a, b) => (amountOf(b) || 0) - (amountOf(a) || 0),
    builder: (a, b) => a.builder.localeCompare(b.builder) || byDue(a, b),
    status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || byDue(a, b)
  };
  rows.sort(sorters[sort] || byDue);
  state.filtered = rows;
  renderTable();
}

function renderTable() {
  const tb = document.getElementById("rows");
  document.getElementById("row-count").textContent = `${state.filtered.length} of ${state.rows.length} bids shown`;
  if (!state.filtered.length) { tb.innerHTML = `<tr><td colspan="8" class="empty">No bids match these filters.</td></tr>`; return; }
  tb.innerHTML = state.filtered.map(r => {
    const i = state.rows.indexOf(r);
    const email = r.contact_email ? `<a href="mailto:${escapeHtml(r.contact_email.split(";")[0].trim())}" onclick="event.stopPropagation()">${escapeHtml(r.contact_email)}</a>` : "";
    return `<tr data-idx="${i}" tabindex="0">
      <td data-label="Builder"><strong>${escapeHtml(r.builder)}</strong><br>${escapeHtml(r.contact_name)}<br>${email}</td>
      <td data-label="Project">${escapeHtml(r.project)}${r.plan_name ? "<br>" + escapeHtml(r.plan_name) : ""}<br><span style="color:var(--gray)">${escapeHtml(r.address)}</span></td>
      <td data-label="Trade">${escapeHtml(r.trade)}</td>
      <td data-label="Amount" class="amount">${fmtUSD(amountOf(r))}</td>
      <td data-label="Sent" class="mono">${escapeHtml(r.date_sent)}</td>
      <td data-label="Due" class="mono">${escapeHtml(r.due_date)}</td>
      <td data-label="Status">${chip(r.status)}</td>
      <td data-label="Jobber" class="mono">${escapeHtml(r.jobber)}</td></tr>`;
  }).join("");
  tb.querySelectorAll("tr[data-idx]").forEach(tr => {
    tr.addEventListener("click", () => openDetail(+tr.dataset.idx));
    tr.addEventListener("keydown", e => { if (e.key === "Enter") openDetail(+tr.dataset.idx); });
  });
}

function openDetail(i) {
  const r = state.rows[i];
  const labels = { builder:"Builder", contact_name:"Contact", contact_email:"Contact email", project:"Project",
    address:"Address", plan_name:"Plan", trade:"Trade", amount:"Amount", amount_notes:"Amount notes", terms:"Terms",
    date_sent:"Date sent", due_date:"Due date", status:"Status", gmail_account:"Gmail account",
    gmail_thread_id:"Gmail thread ID", jobber:"Jobber", houses:"Houses", next_step:"Next step", notes:"Notes", source:"Source" };
  document.getElementById("detail-title").textContent = `${r.builder} — ${r.project}`;
  document.getElementById("detail-body").innerHTML = "<dl>" + FIELDS.map(k => {
    let v = k === "amount" ? (fmtUSD(amountOf(r)) || "") : r[k];
    if (k === "contact_email" && v) v = `<a href="mailto:${escapeHtml(String(v).split(";")[0].trim())}">${escapeHtml(v)}</a>`;
    else v = escapeHtml(v || "");
    return `<dt>${labels[k]}</dt><dd>${v || '<span style="color:var(--gray)">—</span>'}</dd>`;
  }).join("") + "</dl>";
  document.getElementById("detail").showModal();
}

/* CSV parse/serialize — same header as the source files. */
function parseCSV(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).filter(r => r.some(c => String(c).trim() !== "")).map(r => {
    const o = {};
    FIELDS.forEach(k => { const idx = head.indexOf(k); o[k] = idx >= 0 ? String(r[idx] ?? "").trim() : ""; });
    const s = String(o.amount || "").replace(/[$,]/g, "").trim(); const v = parseFloat(s);
    o.amount_value = isNaN(v) ? null : v;
    return o;
  });
}
function toCSV(rows) {
  const esc = v => { v = String(v ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [FIELDS.join(",")].concat(rows.map(r => FIELDS.map(k => esc(k === "amount" ? (r.amount || (r.amount_value ?? "")) : r[k])).join(","))).join("\r\n") + "\r\n";
}

async function init() {
  const board = document.body.dataset.board;
  state.board = board;
  // GitHub build: data comes only from the decrypted bids.enc.json envelope
  // via the Sharma lock. There is no plaintext data file on the site.
  const bundle = await window.SharmaLock.load("bids.enc.json", {
    appName: "Sharma Bid Boards", logo: "logo.png",
    blurb: "Enter the office code to see the bids."
  });
  const data = bundle.boards[board];
  state.title = data.board; state.asOf = data.asOf || state.asOf; state.rows = data.rows;
  document.getElementById("as-of").textContent = `Data as of ${state.asOf}. Owner-only board. Prices are internal.`;
  fillFilters(); renderTotals(); applyFilters();
  ["f-status","f-trade","f-builder","f-due","f-sent","f-sort"].forEach(id =>
    document.getElementById(id).addEventListener("change", applyFilters));
  document.getElementById("f-search").addEventListener("input", applyFilters);
  document.getElementById("btn-export").addEventListener("click", () => {
    const blob = new Blob([toCSV(state.rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `bids-${state.board}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("file-import").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    const rows = parseCSV(await f.text());
    if (!rows.length) { alert("No rows found in that CSV."); return; }
    state.rows = rows; fillFilters(); renderTotals(); applyFilters();
    document.getElementById("import-note").textContent = `Imported ${rows.length} rows from ${f.name} for this view only. To make it permanent, save the CSV with the board data and re-run the encrypt step (tools/encrypt.py).`;
  });
  document.getElementById("detail-close").addEventListener("click", () => document.getElementById("detail").close());
}
document.addEventListener("DOMContentLoaded", init);
