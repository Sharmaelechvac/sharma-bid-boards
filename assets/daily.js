"use strict";
/* Bid Boards — Daily Update view (2026-11-19).
   Renders the trailing-7-days summary that rides inside bids.enc.json as
   bundle.daily_update (+ bundle.daily_update_archive, newest first),
   staged by the daily-update lane in bid-boards/data/daily_update.json
   and carried through tools/build_plain.py. It contains prices, so it
   exists only inside the encrypted envelope — this page unlocks with the
   same office code as the boards. When no summary is published yet, the
   view says so cleanly. The view does not care about cadence: it renders
   the latest summary + archive exactly as published. */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtUSD = v => (v === null || v === undefined || isNaN(v)) ? "" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number(v) % 1 ? 2 : 0 });
function fmtDay(s) {
  if (!s) return "";
  const d = new Date(String(s).slice(0, 10) + "T12:00:00");
  return isNaN(d) ? esc(s) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
const boardName = b => b === "commercial" ? "Commercial" : b === "residential" ? "Residential" : (b || "");

let CURRENT = null, ARCHIVE = [], viewing = -1; // -1 = latest

function bidsSection(s) {
  const items = Array.isArray(s.items) ? s.items : [];
  const sum = (arr) => arr.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const total = s.total != null ? s.total : sum(items);
  const tc = s.total_commercial != null ? s.total_commercial : sum(items.filter(i => i.board === "commercial"));
  const tr = s.total_residential != null ? s.total_residential : sum(items.filter(i => i.board === "residential"));
  const list = items.length ? `<ul class="du-list">${items.map(i => `<li><span class="du-main"><strong>${esc(i.project)}</strong> — ${esc(i.builder)}</span><span class="du-meta">${esc(i.trade)} · ${boardName(i.board)} · sent ${fmtDay(i.date_sent)}</span><span class="du-amt">${fmtUSD(i.amount)}</span></li>`).join("")}</ul>`
    : `<p class="note">No new bids sent in this window.</p>`;
  return `<section class="panel"><h2>Bid in the last 7 days</h2><div class="gold-rule"></div>${list}
  <p class="du-total">Total bid: <strong>${fmtUSD(total)}</strong> — Commercial ${fmtUSD(tc)} · Residential ${fmtUSD(tr)}</p></section>`;
}
function pricesSection(s) {
  const changes = Array.isArray(s.changes) ? s.changes : [];
  const list = changes.length ? `<ul class="du-list">${changes.map(c => `<li><span class="du-main"><strong>${esc(c.project)}</strong> — ${esc(c.builder)}</span><span class="du-meta">${esc(c.change || "Amount set")}${c.board ? " · " + boardName(c.board) : ""}</span><span class="du-amt">${fmtUSD(c.amount)}</span></li>`).join("")}</ul>`
    : `<p class="note">No prices set or changed in this window.</p>`;
  let pipe = "";
  if (s.pipeline_now || s.pipeline_start) {
    const pn = s.pipeline_now || {}, ps = s.pipeline_start || {};
    pipe = `<p class="du-total">Pipeline now: Commercial <strong>${fmtUSD(pn.commercial)}</strong> (was ${fmtUSD(ps.commercial)}) · Residential <strong>${fmtUSD(pn.residential)}</strong> (was ${fmtUSD(ps.residential)})</p>`;
  }
  return `<section class="panel"><h2>Prices</h2><div class="gold-rule"></div>${list}${pipe}</section>`;
}
function emailsSection(list) {
  const items = Array.isArray(list) ? list : [];
  const body = items.length ? items.map(e => `<div class="du-email"><p class="du-main"><strong>${esc(e.builder)}</strong> — ${esc(e.project)}</p>
    ${e.said ? `<p class="du-said">“${esc(e.said)}”</p>` : ""}
    ${e.changed ? `<p class="du-meta">Changed: ${esc(e.changed)}</p>` : ""}</div>`).join("")
    : `<p class="note">No replies on bid threads in this window.</p>`;
  return `<section class="panel"><h2>Emails back</h2><div class="gold-rule"></div>${body}</section>`;
}
function decisionsSection(s) {
  const changes = Array.isArray(s.changes) ? s.changes : [];
  const due = Array.isArray(s.due_next) ? s.due_next : [];
  const held = Array.isArray(s.held) ? s.held : [];
  const heldTxt = h => typeof h === "string" ? esc(h) : `<strong>${esc(h.project)}</strong> — ${esc(h.builder)}${h.note ? " · " + esc(h.note) : ""}`;
  return `<section class="panel"><h2>Decisions &amp; next week</h2><div class="gold-rule"></div>
  <h3 class="du-h3">Status changes</h3>
  ${changes.length ? `<ul class="du-list">${changes.map(c => `<li><span class="du-main"><strong>${esc(c.project)}</strong> — ${esc(c.builder)}</span><span class="du-amt">${esc(c.status)}</span></li>`).join("")}</ul>` : `<p class="note">No Won / Lost / Declined changes in this window.</p>`}
  <h3 class="du-h3">Due next week</h3>
  ${due.length ? `<ul class="du-list">${due.map(d => `<li><span class="du-main"><strong>${esc(d.project)}</strong> — ${esc(d.builder)}</span><span class="du-meta">${esc(d.trade)} · ${boardName(d.board)}</span><span class="du-amt">${fmtDay(d.due_date)}</span></li>`).join("")}</ul>` : `<p class="note">Nothing due next week.</p>`}
  <h3 class="du-h3">Held for Sanjay</h3>
  ${held.length ? `<ul class="du-list">${held.map(h => `<li><span class="du-main">${heldTxt(h)}</span></li>`).join("")}</ul>` : `<p class="note">Nothing held.</p>`}
  </section>`;
}
function renderSummary(sum) {
  const period = sum.period || {};
  const when = period.from || period.to ? `${fmtDay(period.from)} – ${fmtDay(period.to)}` : "";
  const gen = sum.generated_at ? `Generated ${fmtDay(sum.generated_at)}` : "";
  const sec = sum.sections || {};
  $("#du-root").innerHTML = `
    ${sum.sample ? `<section class="panel du-sample"><h2>SAMPLE DATA</h2><p class="note">This summary is sample content for testing only — not a real published update.</p></section>` : ""}
    <section class="panel"><h2>Past 7 days${when ? " · " + esc(when) : ""}</h2><div class="gold-rule"></div>
    <p class="note">One summary across both boards.${gen ? " " + esc(gen) + "." : ""}${viewing >= 0 ? ` You are viewing a past snapshot. <a href="#" id="du-latest">Back to the latest</a>` : ""}</p></section>
    ${sec.bids ? bidsSection(sec.bids) : ""}
    ${sec.prices ? pricesSection(sec.prices) : ""}
    ${sec.emails ? emailsSection(sec.emails) : ""}
    ${sec.decisions ? decisionsSection(sec.decisions) : ""}`;
  const back = $("#du-latest");
  if (back) back.addEventListener("click", e => { e.preventDefault(); viewing = -1; renderSummary(CURRENT); renderArchive(); });
}
function renderArchive() {
  const el = $("#du-archive");
  if (!ARCHIVE.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<section class="panel"><h2>Past updates</h2><div class="gold-rule"></div>
  <ul class="du-list">${ARCHIVE.map((a, i) => { const p = a.period || {}; return `<li><button type="button" class="du-arch-btn" data-arch="${i}"><strong>${esc(fmtDay(p.from))} – ${esc(fmtDay(p.to))}</strong><span class="du-meta">Generated ${esc(fmtDay(a.generated_at))}${a.sample ? " · SAMPLE" : ""}</span></button></li>`; }).join("")}</ul></section>`;
  el.querySelectorAll("[data-arch]").forEach(b => b.addEventListener("click", () => { viewing = +b.dataset.arch; renderSummary(ARCHIVE[viewing]); window.scrollTo({ top: 0, behavior: "smooth" }); }));
}
async function init() {
  const bundle = await window.SharmaLock.load("bids.enc.json", {
    appName: "Sharma Bid Boards", logo: "logo.png",
    blurb: "Enter the office code to see the daily update."
  });
  CURRENT = bundle.daily_update || null;
  ARCHIVE = Array.isArray(bundle.daily_update_archive) ? bundle.daily_update_archive : [];
  if (!CURRENT) {
    $("#du-root").innerHTML = `<section class="panel"><h2>Daily Update</h2><div class="gold-rule"></div>
    <p>No summary yet. The daily update is staged by the daily pass and published inside the boards' encrypted data — once the first one lands, it will show here with the past 7 days of bids, prices, replies and decisions.</p></section>`;
    renderArchive();
    return;
  }
  renderSummary(CURRENT);
  renderArchive();
}
document.addEventListener("DOMContentLoaded", init);
