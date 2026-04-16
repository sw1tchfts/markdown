// Runs in the context of the inspected page via chrome.scripting.executeScript.
// Returns { title, url, markdown } for the current document.
function extractPageAsMarkdown(options) {
  const opts = Object.assign({ readable: true }, options || {});

  const BLOCK_SKIP = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME",
    "SVG", "CANVAS", "VIDEO", "AUDIO", "OBJECT", "EMBED",
    "NAV", "FOOTER", "ASIDE", "FORM"
  ]);

  function pickRoot() {
    if (!opts.readable) return document.body;
    const candidates = [
      document.querySelector("article"),
      document.querySelector("main"),
      document.querySelector('[role="main"]'),
      document.querySelector("#content"),
      document.querySelector(".content"),
      document.querySelector("#main"),
    ].filter(Boolean);
    if (candidates.length) {
      candidates.sort((a, b) => b.textContent.length - a.textContent.length);
      return candidates[0];
    }
    return document.body;
  }

  function resolveUrl(url) {
    if (!url) return "";
    try { return new URL(url, document.baseURI).href; } catch { return url; }
  }

  function escapeInline(text) {
    return text.replace(/([\\`*_{}\[\]()#+\-!>])/g, "\\$1");
  }

  function collapseWs(text) {
    return text.replace(/[\t\n\r ]+/g, " ");
  }

  function isBlock(node) {
    if (node.nodeType !== 1) return false;
    const display = window.getComputedStyle(node).display;
    return /block|flex|grid|list-item|table/.test(display);
  }

  function processChildren(node, ctx) {
    let out = "";
    node.childNodes.forEach((c) => { out += processNode(c, ctx); });
    return out;
  }

  function renderList(node, ordered, ctx) {
    const items = Array.from(node.children).filter((c) => c.tagName === "LI");
    const lines = items.map((li, i) => {
      const marker = ordered ? `${i + 1}. ` : "- ";
      const content = processChildren(li, Object.assign({}, ctx, { inList: true }))
        .replace(/^\s+|\s+$/g, "");
      const indented = content.replace(/\n/g, "\n" + " ".repeat(marker.length));
      return marker + indented;
    });
    return "\n" + lines.join("\n") + "\n\n";
  }

  function renderTable(node) {
    const rows = Array.from(node.querySelectorAll("tr"));
    if (!rows.length) return "";
    const matrix = rows.map((tr) =>
      Array.from(tr.children).map((cell) =>
        collapseWs(cell.textContent || "").trim().replace(/\|/g, "\\|")
      )
    );
    const width = Math.max(...matrix.map((r) => r.length));
    matrix.forEach((r) => { while (r.length < width) r.push(""); });
    const header = matrix[0];
    const body = matrix.slice(1);
    const sep = new Array(width).fill("---");
    const fmt = (r) => "| " + r.join(" | ") + " |";
    return "\n" + [fmt(header), fmt(sep), ...body.map(fmt)].join("\n") + "\n\n";
  }

  function processNode(node, ctx) {
    if (node.nodeType === 3) {
      const raw = node.textContent;
      if (ctx.pre) return raw;
      return escapeInline(collapseWs(raw));
    }
    if (node.nodeType !== 1) return "";
    const tag = node.tagName;
    if (BLOCK_SKIP.has(tag)) return "";

    switch (tag) {
      case "H1": case "H2": case "H3":
      case "H4": case "H5": case "H6": {
        const level = Number(tag[1]);
        const text = collapseWs(processChildren(node, ctx)).trim();
        return `\n${"#".repeat(level)} ${text}\n\n`;
      }
      case "P": {
        const text = processChildren(node, ctx).trim();
        return text ? `\n${text}\n\n` : "";
      }
      case "BR": return "  \n";
      case "HR": return "\n---\n\n";
      case "STRONG": case "B": {
        const t = processChildren(node, ctx).trim();
        return t ? `**${t}**` : "";
      }
      case "EM": case "I": {
        const t = processChildren(node, ctx).trim();
        return t ? `*${t}*` : "";
      }
      case "DEL": case "S": case "STRIKE": {
        const t = processChildren(node, ctx).trim();
        return t ? `~~${t}~~` : "";
      }
      case "CODE": {
        if (ctx.pre) return node.textContent;
        const t = node.textContent.replace(/`/g, "\\`");
        return `\`${t}\``;
      }
      case "PRE": {
        const code = node.querySelector("code");
        const lang = code && (code.className.match(/language-([\w-]+)/) || [])[1] || "";
        const text = (code ? code.textContent : node.textContent).replace(/\n$/, "");
        return `\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      }
      case "BLOCKQUOTE": {
        const inner = processChildren(node, ctx).trim();
        if (!inner) return "";
        const quoted = inner.split("\n").map((l) => `> ${l}`).join("\n");
        return `\n${quoted}\n\n`;
      }
      case "A": {
        const href = resolveUrl(node.getAttribute("href"));
        const text = processChildren(node, ctx).trim() || href;
        return href ? `[${text}](${href})` : text;
      }
      case "IMG": {
        const alt = (node.getAttribute("alt") || "").replace(/\]/g, "\\]");
        const src = resolveUrl(node.getAttribute("src"));
        return src ? `![${alt}](${src})` : "";
      }
      case "UL": return renderList(node, false, ctx);
      case "OL": return renderList(node, true, ctx);
      case "LI": return processChildren(node, ctx);
      case "TABLE": return renderTable(node);
      case "THEAD": case "TBODY": case "TFOOT": case "TR":
      case "TD": case "TH": case "COLGROUP": case "COL":
        return "";
      case "DIV": case "SECTION": case "ARTICLE":
      case "MAIN": case "HEADER": case "FIGURE":
      case "FIGCAPTION": {
        const text = processChildren(node, ctx);
        return isBlock(node) ? `\n${text.trim()}\n\n` : text;
      }
      default:
        return processChildren(node, ctx);
    }
  }

  function clean(md) {
    return md
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+|\s+$/g, "") + "\n";
  }

  const root = pickRoot();
  const body = clean(processNode(root, { pre: false, inList: false }));
  const title = (document.title || "Untitled").trim();
  return { title, url: location.href, markdown: body };
}
