const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const readableEl = document.getElementById("readable");
const frontmatterEl = document.getElementById("frontmatter");

function setStatus(msg, kind) {
  statusEl.textContent = msg || "";
  statusEl.className = kind || "";
}

function sanitizeFilename(name) {
  const cleaned = (name || "page")
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "page";
}

function buildFrontMatter({ title, url }) {
  const esc = (s) => String(s).replace(/"/g, '\\"');
  return [
    "---",
    `title: "${esc(title)}"`,
    `source: "${esc(url)}"`,
    `saved: "${new Date().toISOString()}"`,
    "---",
    "",
    "",
  ].join("\n");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function run() {
  saveBtn.disabled = true;
  setStatus("Extracting page…");
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error("No active tab.");
    if (!/^https?:/.test(tab.url || "")) {
      throw new Error("This page can't be converted (only http/https).");
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["converter.js"],
    });
    if (!injection) throw new Error("Failed to inject converter.");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (opts) => extractPageAsMarkdown(opts),
      args: [{ readable: readableEl.checked }],
    });
    if (!result || !result.markdown) throw new Error("No content extracted.");

    const header = frontmatterEl.checked ? buildFrontMatter(result) : "";
    const heading = `# ${result.title}\n\n`;
    const body = result.markdown.startsWith("# ") ? result.markdown : heading + result.markdown;
    const md = header + body;

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const filename = sanitizeFilename(result.title) + ".md";

    await chrome.downloads.download({ url, filename, saveAs: true });
    setStatus("Saved.", "ok");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener("click", run);
