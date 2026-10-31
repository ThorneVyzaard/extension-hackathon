const BACKEND = "http://127.0.0.1:8000";
const SCAN_LABEL = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analyser les images de la page';

document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.getElementById("scan-page-btn");
  const resultContainer = document.getElementById("result-container");
  const historyContainer = document.getElementById("history-container");
  const statusEl = document.getElementById("backend-status");

  checkBackend();
  loadHistory();

  // Progression envoyée par le content script pendant l'analyse
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "scan_progress") {
      scanBtn.textContent = `Analyse en cours… ${msg.done}/${msg.total}`;
    }
  });

  scanBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
      return showMessage("Action impossible", "Page système", "Ouvrez un site web (http/https) pour l'analyser.");
    }

    scanBtn.disabled = true;
    scanBtn.textContent = "Analyse en cours…";
    try {
      const summary = await sendScan(tab.id);
      showSummary(summary);
    } catch {
      showMessage("Analyse impossible", "Erreur", "Impossible de communiquer avec la page. Rechargez-la et réessayez.");
    } finally {
      scanBtn.disabled = false;
      scanBtn.innerHTML = SCAN_LABEL;
      loadHistory();
      checkBackend();
    }
  });

  // Envoie le message au content script ; l'injecte s'il n'est pas encore présent.
  async function sendScan(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, { action: "scan_page" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tabId, { action: "scan_page" });
    }
  }

  function showSummary(s) {
    if (!s || !s.success) return showMessage("Analyse impossible", "Erreur", "Aucune réponse de la page.");
    if (s.found === 0) {
      return showMessage("Aucune image", "Rien à analyser", `Aucune image d'au moins 150×150 px sur cette page.`);
    }
    if (s.analyzed === 0) {
      const tag = s.stoppedByConsent ? "Annulé" : "Erreur";
      return showMessage("Analyse impossible", tag, s.firstError || "Aucune image n'a pu être analysée.");
    }

    const { real, uncertain, fake } = s.counts;
    let details = `${real} réelle(s) · ${uncertain} incertaine(s) · ${fake} générée(s)`;
    if (s.errors) details += ` · ${s.errors} en erreur`;
    if (s.truncated) details += ` (limité aux 20 premières sur ${s.found})`;
    if (s.errors && s.firstError) details += `\n${s.firstError}`;

    // Image la plus suspecte
    const top = s.results.reduce((a, b) => (b.score > a.score ? b : a));
    resultContainer.style.display = "block";
    document.getElementById("res-title").textContent = `Analyse (${s.analyzed}/${s.found} images)`;
    const tag = document.getElementById("res-verdict");
    tag.textContent = `Max : ${top.score}% IA`;
    tag.className = `verdict-tag verdict-${top.label === "fake" ? "fake" : top.label === "uncertain" ? "uncertain" : "real"}`;
    document.getElementById("res-details").textContent = details;
    document.getElementById("res-details").style.whiteSpace = "pre-line";
    const fill = document.getElementById("res-bar-fill");
    fill.style.width = `${top.score}%`;
    fill.style.background = `var(--${top.label === "fake" ? "danger" : top.label === "uncertain" ? "warning" : "success"})`;
  }

  function showMessage(title, tagText, details) {
    resultContainer.style.display = "block";
    document.getElementById("res-title").textContent = title;
    const tag = document.getElementById("res-verdict");
    tag.textContent = tagText;
    tag.className = "verdict-tag verdict-uncertain";
    document.getElementById("res-details").textContent = details;
    document.getElementById("res-bar-fill").style.width = "0%";
  }

  async function checkBackend() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const r = await fetch(`${BACKEND}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const ok = r.ok && (await r.json()).status === "ok";
      setStatus(ok);
    } catch {
      setStatus(false);
    }
  }

  function setStatus(ok) {
    statusEl.textContent = ok
      ? "● Backend local connecté (modèle chargé)"
      : "● Backend arrêté : l'analyse nécessite run_backend";
    statusEl.style.color = ok ? "var(--success)" : "var(--danger)";
  }

  function loadHistory() {
    chrome.storage.local.get(["fakelens_history"], (data) => {
      const history = data.fakelens_history || [];
      historyContainer.textContent = "";
      if (!history.length) {
        const empty = document.createElement("div");
        empty.style.cssText = "text-align:center;color:var(--text-muted);font-size:11px;padding:10px;";
        empty.textContent = "Aucune image analysée";
        historyContainer.appendChild(empty);
        return;
      }
      history.forEach((item) => {
        const row = document.createElement("div");
        row.className = "history-item";
        const url = document.createElement("span");
        url.style.cssText = "max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        url.textContent = item.url;
        url.title = item.url;
        const score = document.createElement("span");
        score.style.cssText = `font-weight:600;color:${item.score >= 65 ? "var(--danger)" : item.score >= 40 ? "var(--warning)" : "var(--success)"};`;
        score.textContent = `${item.score}% IA`;
        row.append(url, score);
        historyContainer.appendChild(row);
      });
    });
  }
});
