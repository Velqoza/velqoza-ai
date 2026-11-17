const $ = (id) => document.getElementById(id);
const state = {
  files: {},
  messages: [],
  activeFile: "index.html",
  busy: false,
  selectedModel: null,
  modelOptions: []
};

const chatLog = $("chatLog");
const promptInput = $("promptInput");
const sendBtn = $("sendBtn");
const previewView = $("previewView");
const codeView = $("codeView");
const codeEditor = $("codeEditor");
const modelSelect = $("modelSelect");
const modelHelp = $("modelHelp");

function addMessage(role, content, modelId = null) {
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const title = document.createElement("strong");
  const modelInfo = state.modelOptions.find(option => option.id === modelId);
  title.textContent = role === "user" ? "YOU" : `VELQOZA AI${modelInfo ? " · " + modelInfo.label : ""}`;
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

function explainSelectedModel() {
  const option = state.modelOptions.find(item => item.id === modelSelect.value);
  state.selectedModel = option?.available ? option.id : null;
  modelHelp.textContent = option
    ? option.description + (option.id === "gpt-6.2-astra"
        ? " · Advanced model; higher API cost."
        : option.id === "gpt-6.2-sol" ? " · Standard API charges apply." : "")
    : "No available model. Ask the site owner to configure API access.";
}

async function loadModels() {
  try {
    const response = await fetch("/api/models", { cache: "no-store" });
    if (!response.ok) throw new Error("Models endpoint unavailable");
    const data = await response.json();
    if (!Array.isArray(data.models)) throw new Error("Invalid models response");
    state.modelOptions = data.models;
    modelSelect.replaceChildren();
    for (const model of data.models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label + (model.available ? "" : " · Not configured");
      option.disabled = !model.available;
      modelSelect.append(option);
    }
    let previous = null;
    try { previous = localStorage.getItem("velqoza-ai-model-v1"); } catch {}
    const preferred = data.models.find(m => m.id === previous && m.available);
    const fallback = data.models.find(m => m.id === data.defaultModel && m.available)
      || data.models.find(m => m.available);
    const chosen = preferred || fallback;
    modelSelect.disabled = !chosen;
    modelSelect.value = chosen?.id || "";
    explainSelectedModel();
  } catch {
    state.modelOptions = [];
    state.selectedModel = null;
    modelSelect.disabled = true;
    modelHelp.textContent = "Unable to load models. Check the backend connection.";
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
  modelSelect.disabled = true;
  promptInput.value = "";
  state.messages.push({ role: "user", content: prompt });
  addMessage("user", prompt);
  const requestedModel = state.selectedModel;
  const typing = document.createElement("div");
  typing.className = "typing";
  typing.textContent = "VELQOZA AI is building your website…";
  chatLog.append(typing);
  chatLog.scrollTop = chatLog.scrollHeight;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages, files: state.files, model: requestedModel })
    });
    const data = await response.json();
    typing.remove();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    state.files = data.files;
    state.messages.push({ role: "assistant", content: data.assistant || "Your website is ready." });
    addMessage("assistant", data.assistant || "Your website is ready. Open Preview to see it.", data.model);
    showPreview();
    loadEditor();
  } catch (err) {
    typing.remove();
    state.messages.pop(); // A failed request must not pollute later chat history.
    addMessage("assistant", `I couldn't build the website: ${err.message}`);
  } finally {
    state.busy = false;
    sendBtn.disabled = false;
    modelSelect.disabled = !state.modelOptions.some(option => option.available);
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

modelSelect.addEventListener("change", () => {
  explainSelectedModel();
  if (state.selectedModel) {
    try { localStorage.setItem("velqoza-ai-model-v1", state.selectedModel); } catch {}
  }
});
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
loadModels();
