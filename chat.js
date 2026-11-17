// In-app tutor chat. Talks to the Claude API directly from the browser with the student's own API key.
import { readJSON, writeJSON } from "./store.js";
import { SYSTEM_PROMPT, TRACKER_TOOLS, runTool } from "./tutor.js";

const SETTINGS_KEY = "econHub.settings";
const CHAT_KEY = "econHub.chat";

export const MODELS = {
  "claude-opus-5-5": { label: "Opus 5.5 (best)", price: { in: 4, out: 20, cw: 5, cr: 0.2 } },
  "claude-sonnet-5-5": { label: "Sonnet 5.5 (cheaper)", price: { in: 2, out: 10, cw: 2.5, cr: 0.1 } }
};
const WEB_SEARCH_PER_USE = 0.01; // $10 per 1,000 searches

export const settings = {
  apiKey: "", model: "claude-opus-5-5", webSearch: true, spent: 0,
  ...readJSON(SETTINGS_KEY, {})
};
if (!MODELS[settings.model]) settings.model = "claude-opus-5-5";
export function saveSettings(patch) { Object.assign(settings, patch); writeJSON(SETTINGS_KEY, settings); }
export const hasKey = () => typeof settings.apiKey === "string" && settings.apiKey.trim().length > 20;

/* ---------- lazy libraries ---------- */
let libs = null;
async function loadLibs() {
  if (libs) return libs;
  const [{ default: Anthropic }, { Marked, DOMPurify }] = await Promise.all([
    import("./vendor/anthropic-sdk.js"),
    import("./vendor/markdown.js")
  ]);
  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    renderer: {
      code(token) {
        if ((token.lang || "").trim().toLowerCase() === "svg" && /<svg[\s>]/i.test(token.text)) {
          return `<figure class="diagram">${token.text}</figure>`;
        }
        return false; // default rendering
      }
    }
  });
  DOMPurify.addHook("afterSanitizeAttributes", node => {
    if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
  });
  libs = { Anthropic, md, DOMPurify };
  return libs;
}

/* ---------- conversation state ---------- */
function newConversation() {
  const tools = [...TRACKER_TOOLS];
  if (settings.webSearch) {
    tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "GB" } });
  }
  // Model, system prompt and tools are frozen per conversation: changing them mid-chat would edit history.
  return { model: settings.model, system: SYSTEM_PROMPT, tools, messages: [], summaries: {}, cost: 0 };
}
let conv = readJSON(CHAT_KEY, null);
if (!conv || !Array.isArray(conv.messages) || !MODELS[conv.model]) conv = newConversation();
let convSaveOK = true;
function saveConv() { convSaveOK = writeJSON(CHAT_KEY, conv); }

/* ---------- DOM ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let busy = false, currentStream = null, live = null, pendingImages = [], lastFailed = null;
let onNeedKey = () => {};

export function initChat({ needKey }) {
  onNeedKey = needKey;
  $("chatBack").addEventListener("click", closeChat);
  $("chatNew").addEventListener("click", () => {
    if (busy) return;
    if (conv.messages.length && !confirm("Start a new chat? This one will be cleared.")) return;
    resetConversation();
  });
  $("chatForm").addEventListener("submit", e => { e.preventDefault(); sendFromComposer(); });
  $("chatInput").addEventListener("input", autosize);
  $("chatInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendFromComposer(); }
  });
  $("chatStop").addEventListener("click", () => currentStream?.abort());
  $("chatPhoto").addEventListener("click", () => $("chatFile").click());
  $("chatFile").addEventListener("change", async e => {
    for (const f of [...e.target.files].slice(0, 4)) {
      try { pendingImages.push(await resizeImage(f)); } catch { flash("Couldn't read that image."); }
    }
    e.target.value = "";
    renderAttachments();
  });
  $("chatAttach").addEventListener("click", e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    pendingImages.splice(+b.getAttribute("data-rm"), 1); renderAttachments();
  });
  $("chatLog").addEventListener("click", e => {
    const s = e.target.closest("[data-starter]");
    if (s) { const t = s.getAttribute("data-starter"); s.hasAttribute("data-send") ? send(t) : prefill(t); return; }
    if (e.target.closest("#retryBtn") && lastFailed) { const f = lastFailed; lastFailed = null; sendContent(f.content, f.text); }
  });
  window.addEventListener("keydown", e => { if (e.key === "Escape" && !$("chatPanel").hidden && !busy) closeChat(); });
}

function resetConversation() {
  conv = newConversation(); saveConv(); lastFailed = null; pendingImages = [];
  renderAttachments(); render(); updateHeader();
}

export function openChat({ text = "", send: autoSend = false, fresh = false } = {}) {
  if (!hasKey()) { onNeedKey({ text, send: autoSend }); return; }
  if (fresh && conv.messages.length && !busy) {
    if (confirm("Start a new chat for this? Your current chat will be cleared.")) resetConversation();
  }
  $("chatPanel").hidden = false;
  document.body.classList.add("chat-open");
  updateHeader();
  render();
  if (text && autoSend && !busy) send(text);
  else if (text) prefill(text);
  else if (window.matchMedia("(min-width: 700px)").matches) $("chatInput").focus();
}
export function closeChat() {
  $("chatPanel").hidden = true;
  document.body.classList.remove("chat-open");
}
export const chatHasMessages = () => conv.messages.length > 0;

function prefill(t) {
  const el = $("chatInput"); el.value = t; autosize();
  el.focus(); el.setSelectionRange(t.length, t.length);
}
function autosize() { const el = $("chatInput"); el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 220) + "px"; }
function flash(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => (t.hidden = true), 3000); }

function updateHeader() {
  $("chatModel").textContent = MODELS[conv.model].label.split(" (")[0] + (settings.webSearch && conv.tools.some(t => t.name === "web_search") ? " · web search" : "");
  $("chatCost").textContent = conv.cost > 0 ? `This chat ≈ $${conv.cost.toFixed(2)}` : "";
}

/* ---------- rendering ---------- */
const STARTERS = [
  ["Quiz me on my weak topics", true],
  ["Quick quiz on a topic I've covered in class", true],
  ["Teach me ", false],
  ["Mark my answer.\nQuestion: \nMarks: \nExtract (if any): \nMy answer: ", false]
];

function textOf(content) {
  if (typeof content === "string") return content;
  return content.filter(b => b.type === "text").map(b => b.text).join("\n\n");
}

function prepMarkdown(text, streaming) {
  if (!streaming) return text;
  // Hide an unfinished svg block while it streams in
  const fences = [...text.matchAll(/^```(\w*)/gm)];
  if (fences.length % 2 === 1) {
    const open = fences[fences.length - 1];
    if (open[1].toLowerCase() === "svg") return text.slice(0, open.index) + "\n\n*Drawing diagram…*";
  }
  return text;
}
function mdHTML(text, streaming = false) {
  if (!libs) return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
  const html = libs.md.parse(prepMarkdown(text, streaming));
  return libs.DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: true } });
}

function chipsFor(blocks) {
  return blocks.map(b => {
    if (b.type === "tool_use") {
      const s = conv.summaries[b.id] || (b.name === "get_tracker" ? "Read your tracker" : "Updated your tracker");
      return `<div class="chip-act">✓ ${esc(s)}</div>`;
    }
    if (b.type === "server_tool_use" && b.name === "web_search") {
      const q = b.input && typeof b.input.query === "string" ? b.input.query : "";
      return `<div class="chip-act">🔎 Searched the web${q ? ": " + esc(q) : ""}</div>`;
    }
    return "";
  }).join("");
}

function assistantHTML(blocks, streaming = false) {
  let out = "", textBuf = "";
  const flushText = () => { if (textBuf.trim()) out += `<div class="md">${mdHTML(textBuf, streaming)}</div>`; textBuf = ""; };
  for (const b of blocks) {
    if (b.type === "text") textBuf += (textBuf ? "\n\n" : "") + b.text;
    else { const c = chipsFor([b]); if (c) { flushText(); out += c; } }
  }
  flushText();
  return out;
}

function render() {
  const log = $("chatLog");
  const parts = [];
  if (!conv.messages.length && !live) {
    parts.push(`<div class="starter"><p class="muted">Ask your tutor anything about 9EC0 economics, or start with:</p><div class="starter-btns">${STARTERS.map(([t, s]) => `<button class="btn" data-starter="${esc(t)}"${s ? " data-send" : ""}>${esc(t.split("\n")[0].replace(/ $/, "…"))}</button>`).join("")}</div><p class="muted" style="font-size:13px">Tip: tap 📷 to send a photo of a handwritten answer.</p></div>`);
  }
  for (const m of conv.messages) {
    if (m.role === "user") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
      if (blocks.every(b => b.type === "tool_result")) continue;
      const imgs = blocks.filter(b => b.type === "image" && b.source?.type === "base64")
        .map(b => `<img src="data:${esc(b.source.media_type)};base64,${b.source.data}" alt="Attached photo">`).join("");
      const t = textOf(blocks);
      parts.push(`<div class="msg user">${imgs ? `<div class="imgs">${imgs}</div>` : ""}${t ? `<div>${esc(t).replace(/\n/g, "<br>")}</div>` : ""}</div>`);
    } else if (m.role === "assistant" && Array.isArray(m.content)) {
      const h = assistantHTML(m.content);
      if (h) parts.push(`<div class="msg bot">${h}</div>`);
    }
  }
  if (live) {
    const h = assistantHTML(live.blocks, true);
    parts.push(`<div class="msg bot">${h}${live.status ? `<div class="status"><span class="spin" aria-hidden="true"></span>${esc(live.status)}</div>` : ""}</div>`);
  }
  if (lastFailed && !busy) {
    parts.push(`<div class="msg err" role="alert">${esc(lastFailed.error)}${lastFailed.retry ? ` <button class="btn small" id="retryBtn">Try again</button>` : ""}</div>`);
  }
  if (!convSaveOK && conv.messages.length) parts.push(`<p class="muted" style="font-size:12px;text-align:center">This chat is too big to save on the device, so it will be lost if you close the app.</p>`);
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  log.innerHTML = parts.join("");
  if (nearBottom || busy) log.scrollTop = log.scrollHeight;
  $("chatSend").hidden = busy; $("chatStop").hidden = !busy;
  $("chatInput").disabled = false;
}
let rafPending = false;
function renderSoon() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; render(); }); }

function renderAttachments() {
  $("chatAttach").innerHTML = pendingImages.map((im, i) =>
    `<span class="thumb"><img src="data:${im.media_type};base64,${im.data}" alt=""><button type="button" data-rm="${i}" aria-label="Remove photo">×</button></span>`).join("");
  $("chatAttach").hidden = !pendingImages.length;
}

/* ---------- images ---------- */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1568, scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

/* ---------- sending ---------- */
function sendFromComposer() {
  if (busy) return;
  const text = $("chatInput").value.trim();
  if (!text && !pendingImages.length) return;
  const content = [
    ...pendingImages.map(im => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    ...(text ? [{ type: "text", text }] : [])
  ];
  $("chatInput").value = ""; autosize();
  pendingImages = []; renderAttachments();
  sendContent(content, text);
}
function send(text) { if (!busy) sendContent([{ type: "text", text }], text); }

function addCost(usage) {
  if (!usage) return;
  const p = MODELS[conv.model].price;
  const c = ((usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out +
    (usage.cache_creation_input_tokens || 0) * p.cw + (usage.cache_read_input_tokens || 0) * p.cr) / 1e6 +
    (usage.server_tool_use?.web_search_requests || 0) * WEB_SEARCH_PER_USE;
  conv.cost += c;
  saveSettings({ spent: (settings.spent || 0) + c });
  updateHeader();
}

function friendlyError(err, Anthropic) {
  if (err instanceof Anthropic.AuthenticationError) return { msg: "Your API key isn't working. Check it in Settings.", retry: false, key: true };
  if (err instanceof Anthropic.PermissionDeniedError) return { msg: "This API key isn't allowed to do that. Check your account at console.anthropic.com.", retry: false };
  if (err instanceof Anthropic.RateLimitError) return { msg: "Too many requests right now. Wait a minute and try again.", retry: true };
  if (err instanceof Anthropic.BadRequestError) return { msg: "Claude couldn't take that request: " + (err.error?.error?.message || err.message), retry: true };
  if (err instanceof Anthropic.InternalServerError) return { msg: "Claude's service had a problem. Try again in a moment.", retry: true };
  if (err instanceof Anthropic.APIConnectionError) return { msg: navigator.onLine ? "Couldn't reach Claude. Check your connection and try again." : "You're offline. The tutor needs an internet connection.", retry: true };
  if (err instanceof Anthropic.APIError) return { msg: `Something went wrong (${err.status ?? "error"}). Try again.`, retry: true };
  return { msg: "Something went wrong. Try again.", retry: true };
}

async function sendContent(content, text) {
  if (busy) return;
  busy = true; lastFailed = null;
  const startLen = conv.messages.length;
  conv.messages.push({ role: "user", content });
  live = { blocks: [], status: "Thinking…" };
  render();

  let Anthropic;
  try { ({ Anthropic } = await loadLibs()); }
  catch { conv.messages.length = startLen; busy = false; live = null; lastFailed = { content, text, error: "Couldn't load the chat. Check your connection and reload the app.", retry: true }; render(); return; }
  const client = new Anthropic({ apiKey: settings.apiKey.trim(), dangerouslyAllowBrowser: true });

  const rollback = () => { conv.messages.length = startLen; };
  try {
    for (let step = 0; step < 12; step++) {
      live = { blocks: [], status: "Thinking…" };
      renderSoon();
      const stream = client.beta.messages.stream({
        model: conv.model,
        max_tokens: 32000,
        system: conv.system,
        tools: conv.tools,
        messages: conv.messages,
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default"
      });
      currentStream = stream;
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          live.blocks.push({ ...b, text: b.type === "text" ? "" : b.text });
          live.status = b.type === "text" ? "" :
            b.type === "server_tool_use" ? "Searching the web…" :
            b.type === "tool_use" ? (b.name === "get_tracker" ? "Reading your tracker…" : "Updating your tracker…") :
            b.type === "web_search_tool_result" ? "Reading results…" : "Thinking…";
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          const last = live.blocks[live.blocks.length - 1];
          if (last && last.type === "text") last.text += ev.delta.text;
        } else if (ev.type === "content_block_stop") {
          const last = live.blocks[live.blocks.length - 1];
          if (last && last.type === "text") live.status = "";
        }
        renderSoon();
      }
      const msg = await stream.finalMessage();
      currentStream = null;
      addCost(msg.usage);

      if (msg.stop_reason === "refusal") {
        rollback();
        lastFailed = { content, text, error: "Claude couldn't answer that one. Try rewording your message.", retry: false };
        if (text) prefill(text);
        break;
      }
      if (msg.stop_reason === "pause_turn") {
        conv.messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      const toolUses = msg.content.filter(b => b.type === "tool_use");
      if (msg.stop_reason === "tool_use" && toolUses.length) {
        conv.messages.push({ role: "assistant", content: msg.content });
        const results = toolUses.map(tu => {
          const r = runTool(tu.name, tu.input);
          if (r.summary) conv.summaries[tu.id] = r.summary;
          return { type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
        });
        conv.messages.push({ role: "user", content: results });
        saveConv();
        continue;
      }
      // end_turn, or max_tokens on a text answer: keep what we got
      conv.messages.push({ role: "assistant", content: msg.content });
      break;
    }
  } catch (err) {
    currentStream = null;
    rollback();
    if (err instanceof Anthropic.APIUserAbortError) {
      if (text) prefill(text);
    } else {
      const f = friendlyError(err, Anthropic);
      lastFailed = { content, text, error: f.msg, retry: f.retry };
      if (f.key) setTimeout(() => onNeedKey({}), 0);
    }
  } finally {
    busy = false; live = null;
    saveConv(); render(); updateHeader();
  }
}

/** Render the stored conversation once libraries are loaded (for markdown/diagrams). */
export async function warmUp() {
  if (conv.messages.length) { try { await loadLibs(); render(); } catch { /* offline */ } }
}
export function settingsChanged() { updateHeader(); }
