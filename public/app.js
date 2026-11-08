const $ = (id) => document.getElementById(id);
const state = {
  files: {},
  messages: [],
  activeFile: "index.html",
  busy: false
};

const chatLog = $("chatLog");
const promptInput = $("promptInput");
const sendBtn = $("sendBtn");
const previewView = $("previewView");
const codeView = $("codeView");
const codeEditor = $("codeEditor");

function addMessage(role, content) {
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const title = document.createElement("strong");
  title.textContent = role === "user" ? "YOU" : "VELQOZA AI";
  const p = document.createElement("p");
  p.textContent = content;
  bubble.append(title, p);
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "bot-avatar";
    avatar.textContent = "V✳";
    wrap.append(avatar, bubble);
  } else wrap.append(bubble);
  chatLog.append(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function checkConnection() {
  try {
    const r = await fetch("/api/health");
    const data = await r.json();
    $("connectionLabel").textContent = data.configured ? "AI CONNECTED" : "API KEY NEEDED";
    $("connectionLabel").style.color = data.configured ? "#62d8a3" : "#e7b66c";
  } catch {
    $("connectionLabel").textContent = "SERVER OFFLINE";
    $("connectionLabel").style.color = "#e58b8b";
  }
}

function showPreview() {
  const html = state.files["index.html"] || "";
  const css = state.files["style.css"] || "";
  const js = state.files["script.js"] || "";
  const doc = html
    .replace(/<link[^>]+href=["']style\.css["'][^>]*>/i, `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`)
    .replace(/<script[^>]+src=["']script\.js["'][^>]*><\/script>/i, `<script>${js.replace(/<\/script/gi, "<\\/script")}<\/script>`);
  const frame = document.createElement("iframe");
  frame.title = "Generated website preview";
  frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals");
  frame.srcdoc = doc;
  previewView.replaceChildren(frame);
  $("downloadBtn").disabled = false;
  $("previewLabel").textContent = "LIVE PREVIEW";
}

function switchTab(view) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  previewView.classList.toggle("hidden", view !== "preview");
  codeView.classList.toggle("hidden", view !== "code");
  $("previewLabel").textContent = view === "preview" ? "LIVE PREVIEW" : "SOURCE CODE";
  if (view === "code") loadEditor();
}

function loadEditor() {
  codeEditor.value = state.files[state.activeFile] || "";
  document.querySelectorAll(".file-tab").forEach(t => t.classList.toggle("active", t.dataset.file === state.activeFile));
  $("codeStatus").textContent = state.files[state.activeFile] ? `${state.activeFile} · ${state.files[state.activeFile].length.toLocaleString()} characters` : "No project generated yet";
}

async function generate() {
  const prompt = promptInput.value.trim();
  if (!prompt || state.busy) return;
  state.busy = true;
  sendBtn.disabled = true;
  promptInput.value = "";
  state.messages.push({ role: "user", content: prompt });
  addMessage("user", prompt);
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.textContent = "VELQOZA AI is building your website…";
  chatLog.append(typing);
  chatLog.scrollTop = chatLog.scrollHeight;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages, files: state.files })
    });
    const data = await response.json();
    typing.remove();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    state.files = data.files;
    state.messages.push({ role: "assistant", content: data.assistant || "Your website is ready." });
    addMessage("assistant", data.assistant || "Your website is ready. Open Preview to see it.");
    showPreview();
    loadEditor();
  } catch (err) {
    typing.remove();
    addMessage("assistant", `I couldn't build the website: ${err.message}`);
  } finally {
    state.busy = false;
    sendBtn.disabled = false;
    promptInput.focus();
  }
}

function downloadFile(name, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

$("sendBtn").addEventListener("click", generate);
promptInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(); }
});
document.querySelectorAll(".suggestion").forEach(btn => btn.addEventListener("click", () => {
  promptInput.value = `Build a complete, polished website for ${btn.textContent.toLowerCase()}. Make it responsive and visually impressive.`;
  promptInput.focus();
}));
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.view)));
document.querySelectorAll(".file-tab").forEach(btn => btn.addEventListener("click", () => {
  state.activeFile = btn.dataset.file; loadEditor();
}));
$("refreshBtn").addEventListener("click", () => { if (state.files["index.html"]) showPreview(); });
$("saveCodeBtn").addEventListener("click", () => {
  if (!state.files["index.html"]) return;
  state.files[state.activeFile] = codeEditor.value;
  loadEditor();
  showPreview();
  switchTab("preview");
});
$("downloadBtn").addEventListener("click", () => {
  for (const [name, content] of Object.entries(state.files)) downloadFile(name, content);
});
checkConnection();
