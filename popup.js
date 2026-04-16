const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const readableEl = document.getElementById("readable");
const frontmatterEl = document.getElementById("frontmatter");
const imageModeEl = document.getElementById("imageMode");

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

function downloadOnce(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (id) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
    });
  });
}

async function downloadImages(images, folderName) {
  let ok = 0;
  let failed = 0;
  for (const img of images) {
    try {
      await downloadOnce({
        url: img.url,
        filename: `${folderName}/${img.localName}`,
        conflictAction: "overwrite",
        saveAs: false,
      });
      ok += 1;
    } catch (e) {
      console.warn("Image failed:", img.url, e);
      failed += 1;
    }
  }
  return { ok, failed };
}

async function run() {
  saveBtn.disabled = true;
  setStatus("Extracting page…");
  let blobUrl;
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error("No active tab.");
    if (!/^https?:/.test(tab.url || "")) {
      throw new Error("This page can't be converted (only http/https).");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["converter.js"],
    });

    const imageMode = imageModeEl.value === "sidecar" ? "sidecar" : "link";

    const titleProbe = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.title || "Untitled").trim(),
    });
    const pageTitle = (titleProbe[0] && titleProbe[0].result) || "Untitled";
    const baseName = sanitizeFilename(pageTitle);
    const assetsFolder = imageMode === "sidecar" ? `${baseName}.assets` : "assets";

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (opts) => extractPageAsMarkdown(opts),
      args: [{ readable: readableEl.checked, imageMode, assetsFolder }],
    });
    if (!result || !result.markdown) throw new Error("No content extracted.");

    const header = frontmatterEl.checked ? buildFrontMatter(result) : "";
    const heading = `# ${result.title}\n\n`;
    const body = result.markdown.startsWith("# ") ? result.markdown : heading + result.markdown;
    const md = header + body;

    if (imageMode === "sidecar" && result.images.length) {
      setStatus(`Saving ${result.images.length} image(s)…`);
      const { ok, failed } = await downloadImages(result.images, assetsFolder);
      if (failed && !ok) throw new Error("All image downloads failed.");
      if (failed) setStatus(`${ok} saved, ${failed} failed. Saving markdown…`);
    }

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    blobUrl = URL.createObjectURL(blob);
    const filename = `${baseName}.md`;
    await downloadOnce({ url: blobUrl, filename, saveAs: true });
    setStatus("Saved.", "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), "error");
  } finally {
    if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener("click", run);
