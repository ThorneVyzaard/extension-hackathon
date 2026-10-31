// FakeLens - content script : analyse réelle des images de la page (via background -> backend -> modèle).
// Les badges (S1) sont posés dans le <body>, sans modifier la structure de la page.
if (!window.__fakelensLoaded) {
  window.__fakelensLoaded = true;

  const MAX_IMAGES = 20; // limite de taille de la file d'attente (S2)
  const MIN_SIDE = 150; // on ignore icônes et vignettes
  const LABEL = { real: "Réel", uncertain: "Incertain", fake: "Généré" };

  const style = document.createElement("style");
  style.textContent = `
    .fakelens-badge {
      position: absolute; z-index: 2147483646; padding: 5px 10px; border-radius: 20px;
      font: 700 12px system-ui, sans-serif; color: #fff; pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
    }
    .fakelens-badge.real { background: rgba(16,185,129,.92); }
    .fakelens-badge.fake { background: rgba(239,68,68,.92); }
    .fakelens-badge.uncertain { background: rgba(245,158,11,.92); }
  `;
  document.head.appendChild(style);

  function clearBadges() {
    document.querySelectorAll(".fakelens-badge").forEach((b) => b.remove());
  }

  function addBadge(img, label, score) {
    const r = img.getBoundingClientRect();
    const badge = document.createElement("div");
    badge.className = `fakelens-badge ${label}`;
    badge.textContent = `${score}% IA • ${LABEL[label]}`;
    badge.title = "Résultat probabiliste, pas une preuve.";
    badge.style.left = Math.max(0, r.left + window.scrollX + r.width - 150) + "px";
    badge.style.top = r.top + window.scrollY + 8 + "px";
    document.body.appendChild(badge);
  }

  function candidateImages() {
    const seen = new Set();
    return Array.from(document.querySelectorAll("img")).filter((img) => {
      const url = img.currentSrc || img.src;
      if (!url || seen.has(url)) return false;
      const r = img.getBoundingClientRect();
      if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
      seen.add(url);
      return true;
    });
  }

  function progress(done, total) {
    chrome.runtime.sendMessage({ action: "scan_progress", done, total }).catch(() => {});
  }

  async function scanPage() {
    clearBadges();
    const all = candidateImages();
    const queue = all.slice(0, MAX_IMAGES);
    const summary = {
      success: true,
      found: all.length,
      analyzed: 0,
      truncated: all.length > queue.length,
      counts: { real: 0, uncertain: 0, fake: 0 },
      results: [],
      errors: 0,
      firstError: null,
      stoppedByConsent: false,
    };

    for (let i = 0; i < queue.length; i++) {
      const img = queue[i];
      const url = img.currentSrc || img.src;
      progress(i, queue.length);
      let res;
      try {
        res = await chrome.runtime.sendMessage({ action: "analyze", url });
      } catch {
        res = { ok: false, message: "Extension indisponible." };
      }
      if (res?.ok) {
        const { label, score } = res.result;
        summary.analyzed++;
        summary.counts[label]++;
        summary.results.push({ url, label, score });
        addBadge(img, label, score);
      } else {
        summary.errors++;
        summary.firstError = summary.firstError || res?.message || "Erreur inconnue.";
        if (res?.code === "consent" || res?.code === "backend") {
          summary.stoppedByConsent = res.code === "consent";
          break; // inutile de continuer si le backend est arrêté ou si l'accord est refusé
        }
      }
    }
    progress(queue.length, queue.length);
    return summary;
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "scan_page") {
      scanPage().then(sendResponse);
      return true; // réponse asynchrone
    }
  });
}
