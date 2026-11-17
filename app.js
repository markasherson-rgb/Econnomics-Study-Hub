import { THEMES, TOPICS, SUBS, LEVELS, CLS } from "./data.js";

const STORE_KEY = "econHub.v1";
const PREFS_KEY = "econHub.prefs";
const CLAUDE_NEW = "https://claude.ai/new?q=";

/* ---------- storage ---------- */
function readJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

const blank = () => ({ version: 1, topics: {}, activity: [] });
let data = normalise(readJSON(STORE_KEY, blank()));
let prefs = { theme: "auto", openClaude: true, ...readJSON(PREFS_KEY, {}) };
let storageOK = true;

function normalise(d) {
  const out = blank();
  if (d && typeof d === "object") {
    if (d.topics && typeof d.topics === "object") {
      for (const [ref, v] of Object.entries(d.topics)) {
        if (!SUBS.some(s => s[0] === ref) || !v) continue;
        out.topics[ref] = {
          confidence: LEVELS.includes(v.confidence) ? v.confidence : "Not started",
          covered: !!v.covered,
          updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null
        };
      }
    }
    if (Array.isArray(d.activity)) {
      out.activity = d.activity.filter(a => a && typeof a === "object").map(a => ({
        id: String(a.id || Math.random().toString(36).slice(2)),
        kind: ["quiz", "mark", "lesson"].includes(a.kind) ? a.kind : "quiz",
        ref: typeof a.ref === "string" ? a.ref : "",
        title: typeof a.title === "string" ? a.title : "",
        score: Number.isFinite(+a.score) && a.score !== "" && a.score != null ? +a.score : null,
        outOf: Number.isFinite(+a.outOf) && +a.outOf > 0 ? +a.outOf : null,
        note: typeof a.note === "string" ? a.note : "",
        at: typeof a.at === "string" ? a.at : new Date().toISOString()
      }));
    }
  }
  return out;
}

function persist() {
  storageOK = writeJSON(STORE_KEY, data);
  renderSync();
}

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const conf = ref => data.topics[ref]?.confidence || "Not started";
const covered = ref => !!data.topics[ref]?.covered;
const topicOf = ref => ref.split(".").slice(0, 2).join(".");
const subName = ref => (SUBS.find(s => s[0] === ref) || [])[1] || "";

let filterTheme = "all", filterStatus = "all", query = "";
const openRefs = new Set();
const openGroups = new Set(["1.1"]);

function renderSync() {
  const dot = $("syncDot"), txt = $("syncText");
  if (!storageOK) { dot.className = "dot bad"; txt.textContent = "This browser is blocking storage, so changes won't be kept. Export a backup before closing."; return; }
  const n = Object.keys(data.topics).length + data.activity.length;
  dot.className = "dot ok";
  txt.textContent = n ? "Progress saved on this device." : "Ready. Your progress will be saved on this device.";
}

/* ---------- progress ---------- */
function counts(list) {
  const c = { "Not started": 0, "Shaky": 0, "Getting there": 0, "Confident": 0 };
  let cov = 0;
  list.forEach(s => { c[conf(s[0])]++; if (covered(s[0])) cov++; });
  return { c, covered: cov, total: list.length };
}
function barHTML(c, total) {
  const w = k => (100 * c[k] / total).toFixed(2) + "%";
  return `<span class="c" style="width:${w("Confident")}"></span><span class="g" style="width:${w("Getting there")}"></span><span class="s" style="width:${w("Shaky")}"></span>`;
}
function renderProgress() {
  const all = counts(SUBS);
  $("confCount").textContent = all.c["Confident"];
  $("subTotal").textContent = all.total;
  $("allBar").innerHTML = barHTML(all.c, all.total);
  $("covTotal").textContent = `${all.covered} of ${all.total} covered in class`;
  $("themes").innerHTML = Object.keys(THEMES).map(t => {
    const k = counts(SUBS.filter(s => s[0].startsWith(t + ".")));
    return `<div class="theme-row"><div class="top"><span>${esc(THEMES[t].short)} <span class="muted" style="font-weight:400">· ${THEMES[t].year}</span></span><span class="muted num">${k.c["Confident"]}/${k.total} confident · ${k.covered} covered</span></div><div class="bar" role="img" aria-label="${esc(THEMES[t].name)}: ${k.c["Confident"]} confident, ${k.c["Getting there"]} getting there, ${k.c["Shaky"]} shaky of ${k.total}">${barHTML(k.c, k.total)}</div></div>`;
  }).join("");
}

/* ---------- next up ---------- */
function pickNext() {
  const rank = s => {
    const c = conf(s[0]), cov = covered(s[0]);
    if (cov && c === "Shaky") return 0;
    if (cov && c === "Not started") return 1;
    if (cov && c === "Getting there") return 2;
    if (!cov && c === "Shaky") return 3;
    if (!cov && c === "Getting there") return 4;
    return 9;
  };
  let picks = SUBS.map((s, i) => ({ s, r: rank(s), i })).filter(x => x.r < 9).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, 3);
  if (!picks.length) picks = SUBS.map((s, i) => ({ s, r: 5, i })).filter(x => conf(x.s[0]) === "Not started").slice(0, 3);
  return picks;
}
function topicButtons(ref, name, extra = false) {
  return `<button class="btn primary" data-ask="Teach me ${ref} ${esc(name)}">Teach me</button><button class="btn" data-ask="Quiz me on ${ref} ${esc(name)}">Quiz me</button>` +
    (extra ? `<button class="btn" data-ask="Teach me ${ref} ${esc(name)}: just the diagram">Just the diagram</button>` : "");
}
function renderNext() {
  const picks = pickNext();
  if (!picks.length) { $("next").innerHTML = `<p class="empty">Everything is marked Confident. Try a mixed quiz to keep it fresh.</p>`; return; }
  $("next").innerHTML = picks.map(p => {
    const [ref, name] = p.s, c = conf(ref);
    const why = p.r === 5 ? "Not started yet. Next in spec order" : `${covered(ref) ? "Covered in class" : "Not covered in class yet"} · ${c}`;
    return `<div class="card ${CLS[c]}"><div><span class="ref">${ref}</span> <span class="t">${esc(name)}</span></div><div class="why">${esc(why)}</div><div class="btns">${topicButtons(ref, name)}</div></div>`;
  }).join("");
}

/* ---------- topic list ---------- */
function renderChips() {
  const opts = [["all", "All"]].concat(Object.keys(THEMES).map(t => [t, "Theme " + t]));
  $("themeChips").innerHTML = opts.map(([v, l]) => `<button class="chip" data-theme-f="${v}" aria-pressed="${filterTheme === v}">${l}</button>`).join("");
}
function matches([ref, name, key]) {
  if (filterTheme !== "all" && !ref.startsWith(filterTheme + ".")) return false;
  if (filterStatus === "covered-not-conf") { if (!(covered(ref) && conf(ref) !== "Confident")) return false; }
  else if (filterStatus !== "all" && conf(ref) !== filterStatus) return false;
  if (query) {
    const q = query.toLowerCase();
    if (!(ref.includes(q) || name.toLowerCase().includes(q) || key.toLowerCase().includes(q) || (TOPICS[topicOf(ref)] || "").toLowerCase().includes(q))) return false;
  }
  return true;
}
function rowHTML([ref, name, key]) {
  const c = conf(ref), t = ref.split(".")[0], open = openRefs.has(ref);
  return `<li class="trow" data-ref="${ref}">
    <div class="tmain"><span class="ref">${ref}</span><button class="tname" data-toggle="${ref}" aria-expanded="${open}">${esc(name)}</button></div>
    <div class="tctl">
      <select class="conf ${CLS[c]}" data-conf="${ref}" aria-label="Confidence for ${esc(name)}">${LEVELS.map(l => `<option${l === c ? " selected" : ""}>${l}</option>`).join("")}</select>
      <label class="cov"><input type="checkbox" data-cov="${ref}"${covered(ref) ? " checked" : ""}> Covered in class</label>
    </div>
    <div class="more"${open ? "" : " hidden"}>
      <div>${esc(key)}</div>
      <div class="muted" style="font-size:13px">${THEMES[t].papers} · ${THEMES[t].year}</div>
      <div class="btns">${topicButtons(ref, name, true)}</div>
    </div>
  </li>`;
}
function renderList() {
  const groups = {};
  SUBS.filter(matches).forEach(s => (groups[topicOf(s[0])] ||= []).push(s));
  const keys = Object.keys(groups);
  if (!keys.length) { $("list").innerHTML = `<p class="empty">No topics match. Clear the search or filters.</p>`; return; }
  const filtered = filterTheme !== "all" || filterStatus !== "all" || query;
  $("list").innerHTML = keys.map(tp => {
    const all = SUBS.filter(s => s[0].startsWith(tp + "."));
    const confN = all.filter(s => conf(s[0]) === "Confident").length;
    const open = filtered || openGroups.has(tp) ? " open" : "";
    return `<details class="group" data-group="${tp}"${open}><summary><span>${tp} ${esc(TOPICS[tp])}</span><span class="cnt num">${confN}/${all.length} confident</span></summary><ul class="tl">${groups[tp].map(rowHTML).join("")}</ul></details>`;
  }).join("");
}

/* ---------- activity ---------- */
const KIND = { quiz: "Quiz", mark: "Marked answer", lesson: "Lesson" };
function renderActs() {
  const list = [...data.activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  if (!list.length) { $("acts").innerHTML = `<li class="empty">Nothing logged yet. After a quiz, marked answer or lesson with Claude, tap Log a result.</li>`; return; }
  $("acts").innerHTML = list.map(a => {
    const d = new Date(a.at);
    const date = isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const score = a.score != null && a.outOf ? `${a.score}/${a.outOf}` : "";
    const title = a.title || (a.ref ? subName(a.ref) : "");
    return `<li><span><b>${esc(KIND[a.kind] || "Activity")}</b>${a.ref ? " · " + esc(a.ref) : ""} ${esc(title)}${a.note ? `<br><span class="muted" style="font-size:13px">${esc(a.note)}</span>` : ""}</span><span class="right"><span class="score num">${esc(score)}<br><span class="muted" style="font-weight:400;font-size:12px">${esc(date)}</span></span><button class="x" data-del="${esc(a.id)}" aria-label="Delete this entry">×</button></span></li>`;
  }).join("");
}
function fillRefSelect() {
  $("lRef").innerHTML = `<option value="">Mixed / not one topic</option>` +
    SUBS.map(([ref, name]) => `<option value="${ref}">${ref} ${esc(name)}</option>`).join("");
}

function renderAll() { renderProgress(); renderNext(); renderList(); renderActs(); renderSync(); }

/* ---------- writes ---------- */
function setTopic(ref, patch) {
  const prev = data.topics[ref] || { confidence: "Not started", covered: false };
  data.topics[ref] = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  persist();
  renderProgress(); renderNext(); renderList();
}

/* ---------- Ask Claude ---------- */
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }

function weakPrompt() {
  const weak = SUBS.filter(s => ["Shaky", "Getting there"].includes(conf(s[0])));
  if (!weak.length) return "Quiz me on my weak topics";
  return "Quiz me on my weak topics. These are the ones I've marked Shaky or Getting there:\n" +
    weak.map(([ref, name]) => `- ${ref} ${name} (${conf(ref)})`).join("\n");
}

async function ask(text) {
  if (text === "weak") text = weakPrompt();
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; $("copybox").hidden = true; } catch { /* handled below */ }
  if (prefs.openClaude) {
    window.open(CLAUDE_NEW + encodeURIComponent(text), "_blank", "noopener");
    toast(copied ? "Opening Claude. The request is also on your clipboard." : "Opening Claude with your request.");
    return;
  }
  if (copied) toast("Copied. Paste it into your chat with Claude.");
  else { $("copyText").value = text; $("copybox").hidden = false; $("copyText").focus(); $("copyText").select(); toast("Copy was blocked. The text is in the Ask Claude box."); }
}

/* ---------- theme ---------- */
function applyTheme() {
  const t = prefs.theme;
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  $("themeBtn").textContent = "Theme: " + t[0].toUpperCase() + t.slice(1);
}

/* ---------- backup ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `econ-study-hub-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup downloaded.");
}
async function importData(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || (!parsed.topics && !parsed.activity)) throw new Error("bad");
    if (!confirm("Replace the progress on this device with this backup?")) return;
    data = normalise(parsed);
    persist(); renderAll();
    toast("Backup imported.");
  } catch { toast("That file isn't a Study Hub backup."); }
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const a = e.target.closest("[data-ask]"); if (a) { ask(a.getAttribute("data-ask")); return; }
  const tg = e.target.closest("[data-toggle]");
  if (tg) {
    const ref = tg.getAttribute("data-toggle");
    openRefs.has(ref) ? openRefs.delete(ref) : openRefs.add(ref);
    tg.closest(".trow").querySelector(".more").hidden = !openRefs.has(ref);
    tg.setAttribute("aria-expanded", openRefs.has(ref));
    return;
  }
  const ch = e.target.closest("[data-theme-f]"); if (ch) { filterTheme = ch.getAttribute("data-theme-f"); renderChips(); renderList(); return; }
  const del = e.target.closest("[data-del]");
  if (del && confirm("Delete this entry?")) { data.activity = data.activity.filter(x => x.id !== del.getAttribute("data-del")); persist(); renderActs(); }
});
document.addEventListener("change", e => {
  const s = e.target.closest("[data-conf]"); if (s) { setTopic(s.getAttribute("data-conf"), { confidence: s.value }); return; }
  const cb = e.target.closest("[data-cov]"); if (cb) setTopic(cb.getAttribute("data-cov"), { covered: cb.checked });
});
document.addEventListener("toggle", e => {
  const g = e.target.closest?.("details.group");
  if (g) { const tp = g.getAttribute("data-group"); g.open ? openGroups.add(tp) : openGroups.delete(tp); }
}, true);
$("fStatus").addEventListener("change", e => { filterStatus = e.target.value; renderList(); });
let qT; $("q").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { query = e.target.value.trim(); renderList(); }, 150); });

$("openClaude").checked = prefs.openClaude;
$("openClaude").addEventListener("change", e => { prefs.openClaude = e.target.checked; writeJSON(PREFS_KEY, prefs); });
$("themeBtn").addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  prefs.theme = order[(order.indexOf(prefs.theme) + 1) % order.length];
  writeJSON(PREFS_KEY, prefs); applyTheme();
});

function toggleLog(show) {
  $("logForm").hidden = !show;
  $("logBtn").setAttribute("aria-expanded", show);
  if (show) $("lKind").focus();
}
$("logBtn").addEventListener("click", () => toggleLog($("logForm").hidden));
$("logCancel").addEventListener("click", () => toggleLog(false));
$("logForm").addEventListener("submit", e => {
  e.preventDefault();
  const score = $("lScore").value, outOf = $("lOut").value;
  if (score !== "" && outOf === "") { toast("Add what the score is out of."); $("lOut").focus(); return; }
  if (score !== "" && +score > +outOf) { toast("The score can't be more than the total."); $("lScore").focus(); return; }
  const ref = $("lRef").value;
  data.activity.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: $("lKind").value, ref, title: ref ? subName(ref) : "Mixed topics",
    score: score === "" ? null : +score, outOf: outOf === "" ? null : +outOf,
    note: $("lNote").value.trim(), at: new Date().toISOString()
  });
  persist(); renderActs();
  e.target.reset(); toggleLog(false);
  toast("Saved. Update your confidence for that topic below if it changed.");
});

$("exportBtn").addEventListener("click", exportData);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", e => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ""; });
$("resetBtn").addEventListener("click", () => {
  if (!confirm("Clear all your progress and activity on this device? Export a backup first if you might want it back.")) return;
  data = blank(); persist(); renderAll(); toast("Everything has been reset.");
});

/* Keep multiple tabs in sync */
window.addEventListener("storage", e => { if (e.key === STORE_KEY) { data = normalise(readJSON(STORE_KEY, blank())); renderAll(); } });

/* ---------- install / offline ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; $("installBtn").hidden = false; });
$("installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; $("installBtn").hidden = true;
});
window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; toast("Installed. Find Econ Hub on your home screen."); });
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------- boot ---------- */
applyTheme(); fillRefSelect(); renderChips(); renderAll();
