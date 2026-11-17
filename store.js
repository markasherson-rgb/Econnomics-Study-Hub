// Shared app state: topic progress, activity log, notes. Saved to localStorage.
import { SUBS, LEVELS } from "./data.js";

const STORE_KEY = "econHub.v1";

export function readJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

const blank = () => ({ version: 1, topics: {}, activity: [] });
const isRef = ref => SUBS.some(s => s[0] === ref);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function normalise(d) {
  const out = blank();
  if (!d || typeof d !== "object") return out;
  if (d.topics && typeof d.topics === "object") {
    for (const [ref, v] of Object.entries(d.topics)) {
      if (!isRef(ref) || !v) continue;
      out.topics[ref] = {
        confidence: LEVELS.includes(v.confidence) ? v.confidence : "Not started",
        covered: !!v.covered,
        notes: Array.isArray(v.notes) ? v.notes.filter(n => n && typeof n.text === "string").map(n => ({ id: String(n.id || uid()), text: n.text, at: String(n.at || "") })) : [],
        updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null
      };
    }
  }
  if (Array.isArray(d.activity)) {
    out.activity = d.activity.filter(a => a && typeof a === "object").map(a => ({
      id: String(a.id || uid()),
      kind: ["quiz", "mark", "lesson"].includes(a.kind) ? a.kind : "quiz",
      ref: typeof a.ref === "string" ? a.ref : "",
      title: typeof a.title === "string" ? a.title : "",
      score: a.score !== "" && a.score != null && Number.isFinite(+a.score) ? +a.score : null,
      outOf: Number.isFinite(+a.outOf) && +a.outOf > 0 ? +a.outOf : null,
      note: typeof a.note === "string" ? a.note : "",
      by: a.by === "claude" ? "claude" : "you",
      at: typeof a.at === "string" ? a.at : new Date().toISOString()
    }));
  }
  return out;
}

export let data = normalise(readJSON(STORE_KEY, blank()));
export let storageOK = true;
const listeners = new Set();

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() {
  storageOK = writeJSON(STORE_KEY, data);
  listeners.forEach(fn => fn());
}

export const conf = ref => data.topics[ref]?.confidence || "Not started";
export const covered = ref => !!data.topics[ref]?.covered;
export const notes = ref => data.topics[ref]?.notes || [];
export const subName = ref => (SUBS.find(s => s[0] === ref) || [])[1] || "";

function topic(ref) {
  return data.topics[ref] ||= { confidence: "Not started", covered: false, notes: [], updatedAt: null };
}

export function setTopic(ref, patch) {
  if (!isRef(ref)) return false;
  Object.assign(topic(ref), patch, { updatedAt: new Date().toISOString() });
  changed();
  return true;
}

export function addNote(ref, text) {
  if (!isRef(ref)) return false;
  topic(ref).notes.push({ id: uid(), text: String(text).slice(0, 500), at: new Date().toISOString() });
  changed();
  return true;
}
export function deleteNote(ref, id) {
  const t = data.topics[ref]; if (!t) return;
  t.notes = t.notes.filter(n => n.id !== id);
  changed();
}

export function logActivity(entry) {
  data.activity.push({
    id: uid(), kind: "quiz", ref: "", title: "", score: null, outOf: null, note: "", by: "you",
    ...entry, at: new Date().toISOString()
  });
  changed();
}
export function deleteActivity(id) {
  data.activity = data.activity.filter(x => x.id !== id);
  changed();
}

export function replaceAll(raw) { data = normalise(raw); changed(); }
export function resetAll() { data = blank(); changed(); }
export function exportJSON() { return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2); }

/* Keep multiple tabs in sync */
window.addEventListener("storage", e => {
  if (e.key === STORE_KEY) { data = normalise(readJSON(STORE_KEY, blank())); listeners.forEach(fn => fn()); }
});
