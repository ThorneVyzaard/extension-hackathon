// FakeLens - service worker : menu contextuel -> backend local (modèle .pt) -> affichage.
const BACKEND = "http://127.0.0.1:8000";
const MAX_BYTES = 5 * 1024 * 1024;
const MENU_ID = "verify-image";

function initMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create(
      { id: MENU_ID, title: "🔍 Vérifier cette image avec FakeLens", contexts: ["image"] },
      () => void chrome.runtime.lastError
    );
  });
}
chrome.runtime.onInstalled.addListener(initMenu);
chrome.runtime.onStartup.addListener(initMenu);

class UserError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // "consent" | "backend" | undefined
  }
}

// Pipeline commun : consentement -> récupération de l'image -> backend -> historique.
async function analyze(tabId, imageUrl, route) {
  if (!(await ensureConsent(tabId))) {
    throw new UserError(
      "Analyse annulée : sans votre accord, l'image n'est pas envoyée au backend local.",
      "consent"
    );
  }
  const blob = await fetchImage(imageUrl);
  const result = await callBackend(route, blob);
  await saveHistory(imageUrl, result.score);
  return result;
}

// Analyse de page (popup -> content script -> ici) : /predict, sans heatmap.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== "analyze" || !sender.tab?.id) return;
  analyze(sender.tab.id, msg.url, "/predict")
    .then((result) => sendResponse({ ok: true, result }))
    .catch((e) =>
      sendResponse({
        ok: false,
        code: e.code,
        message: e instanceof UserError ? e.message : "Erreur inattendue : " + e.message,
      })
    );
  return true; // réponse asynchrone
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !/^https?:/.test(tab.url || "")) return;
  const imageUrl = info.srcUrl;
  try {
    await show(tab.id, { type: "loading", imageUrl });
    const result = await analyze(tab.id, imageUrl, "/explain");
    await show(tab.id, { type: "result", imageUrl, ...result });
  } catch (e) {
    const message = e instanceof UserError ? e.message : "Erreur inattendue : " + e.message;
    await show(tab.id, { type: "error", imageUrl, message });
  }
});

// ---- Consentement (RG1) : demandé une seule fois, mémorisé dans chrome.storage
async function ensureConsent(tabId) {
  const { fakelens_consent } = await chrome.storage.local.get("fakelens_consent");
  if (fakelens_consent) return true;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () =>
      window.confirm(
        "FakeLens\n\nPour calculer la carte de chaleur, l'image sera envoyée à votre backend " +
          "local (localhost). Elle n'est ni stockée ni envoyée sur Internet.\n\nAutoriser ?"
      ),
  });
  const ok = !!res?.result;
  if (ok) await chrome.storage.local.set({ fakelens_consent: true });
  return ok;
}

// ---- Récupération de l'image (le service worker n'est pas soumis au CORS grâce à host_permissions)
async function fetchImage(url) {
  let resp;
  try {
    resp = await fetch(url);
  } catch {
    throw new UserError("Impossible de récupérer l'image (URL blob: ou accès refusé).");
  }
  if (!resp.ok) throw new UserError(`Impossible de récupérer l'image (HTTP ${resp.status}).`);
  const blob = await resp.blob();
  if (blob.size > MAX_BYTES) throw new UserError("Image trop lourde (maximum 5 Mo).");
  if (blob.type && !/^image\/(jpeg|png|webp)$/.test(blob.type)) {
    throw new UserError(`Format non supporté (${blob.type}). Formats acceptés : JPEG, PNG, WebP.`);
  }
  return blob;
}

// ---- Appel au backend FastAPI
async function callBackend(route, blob) {
  const form = new FormData();
  form.append("image", blob, "image");
  let resp;
  try {
    resp = await fetch(BACKEND + route, { method: "POST", body: form });
  } catch {
    throw new UserError(
      "Backend injoignable. Lancez-le (run_backend.bat ou run_backend.sh) puis réessayez.",
      "backend"
    );
  }
  if (!resp.ok) {
    let detail = `Erreur du backend (HTTP ${resp.status}).`;
    try { detail = (await resp.json()).detail || detail; } catch {}
    throw new UserError(detail);
  }
  return resp.json(); // { label, score, heatmap_png_base64 }
}

async function saveHistory(url, score) {
  const { fakelens_history = [] } = await chrome.storage.local.get("fakelens_history");
  fakelens_history.unshift({ url, score });
  await chrome.storage.local.set({ fakelens_history: fakelens_history.slice(0, 20) });
}

function show(tabId, state) {
  return chrome.scripting.executeScript({ target: { tabId }, func: renderCard, args: [state] });
}

// ---- Injectée dans la page : doit être autonome (aucune variable externe).
function renderCard(state) {
  const COLORS = { real: "#10b981", uncertain: "#f59e0b", fake: "#ef4444", error: "#64748b" };
  const TEXT = {
    real: "Réel (photo probablement authentique)",
    uncertain: "Incertain (zone médiane)",
    fake: "Probablement généré par IA",
  };
  const el = (tag, css, text) => {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // Nettoyage des éléments d'une analyse précédente
  document.querySelectorAll(".fakelens-overlay, .fakelens-badge-x").forEach((n) => n.remove());
  document.getElementById("fakelens-modal-result")?.remove();

  const color = COLORS[state.type === "result" ? state.label : "error"];
  const target = Array.from(document.querySelectorAll("img")).find(
    (i) => i.currentSrc === state.imageUrl || i.src === state.imageUrl
  );

  // Heatmap + badge sur l'image de la page (positionnés sans modifier la mise en page)
  if (state.type === "result" && target) {
    const r = target.getBoundingClientRect();
    const place = (n) => {
      n.style.left = r.left + window.scrollX + "px";
      n.style.top = r.top + window.scrollY + "px";
    };
    const heat = el("img", `position:absolute;width:${r.width}px;height:${r.height}px;pointer-events:none;z-index:2147483645;`);
    heat.className = "fakelens-overlay";
    heat.src = "data:image/png;base64," + state.heatmap_png_base64;
    place(heat);
    document.body.appendChild(heat);

    const badge = el("div",
      `position:absolute;z-index:2147483646;background:${color};color:#fff;padding:4px 10px;border-radius:20px;` +
      "font:700 12px system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none;",
      `${state.score}% IA`);
    badge.className = "fakelens-badge-x";
    place(badge);
    badge.style.left = r.left + window.scrollX + r.width - 70 + "px";
    badge.style.top = r.top + window.scrollY + 8 + "px";
    document.body.appendChild(badge);
  }

  // Carte de résultat (bas droite)
  const modal = el("div",
    `position:fixed;bottom:24px;right:24px;width:340px;background:#0f172a;color:#f8fafc;` +
    `border:1px solid rgba(255,255,255,.15);border-left:5px solid ${color};border-radius:16px;padding:16px;` +
    "z-index:2147483647;font-family:system-ui,sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.6);");
  modal.id = "fakelens-modal-result";

  const head = el("div", "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;");
  head.appendChild(el("strong", "font-size:14px;", "🛡️ FakeLens • Analyse locale"));
  const close = el("span", "cursor:pointer;font-size:16px;color:#94a3b8;", "✕");
  close.onclick = () => {
    modal.remove();
    document.querySelectorAll(".fakelens-overlay, .fakelens-badge-x").forEach((n) => n.remove());
  };
  head.appendChild(close);
  modal.appendChild(head);

  if (state.type === "loading") {
    modal.appendChild(el("div", "font-size:13px;color:#cbd5e1;", "⏳ Analyse en cours…"));
  } else if (state.type === "error") {
    modal.appendChild(el("div", "font-size:13px;font-weight:700;color:#f87171;margin-bottom:4px;", "Analyse impossible"));
    modal.appendChild(el("div", "font-size:12px;color:#cbd5e1;line-height:1.4;", state.message));
  } else {
    const row = el("div", "display:flex;align-items:center;gap:10px;margin-bottom:10px;");
    const thumb = el("div", "position:relative;width:64px;height:64px;flex:none;border-radius:8px;overflow:hidden;");
    const t1 = el("img", "position:absolute;inset:0;width:100%;height:100%;object-fit:fill;");
    t1.src = state.imageUrl;
    const t2 = el("img", "position:absolute;inset:0;width:100%;height:100%;object-fit:fill;");
    t2.src = "data:image/png;base64," + state.heatmap_png_base64;
    thumb.append(t1, t2);

    const info = el("div", "flex:1;");
    info.appendChild(el("div", `font-size:13px;font-weight:700;color:${color};`, TEXT[state.label]));
    const sc = el("div", "font-size:11px;color:#cbd5e1;margin-top:2px;");
    sc.append("Probabilité IA : ");
    sc.appendChild(el("b", "", state.score + "%"));
    info.appendChild(sc);
    const bar = el("div", "width:100%;height:6px;background:rgba(255,255,255,.1);border-radius:3px;margin-top:5px;overflow:hidden;");
    bar.appendChild(el("div", `width:${state.score}%;height:100%;background:${color};`));
    info.appendChild(bar);
    row.append(thumb, info);
    modal.appendChild(row);

    modal.appendChild(el("div",
      "font-size:11px;color:#94a3b8;background:rgba(255,255,255,.04);padding:8px;border-radius:8px;line-height:1.4;",
      "⚠️ Résultat probabiliste, pas une preuve. La carte de chaleur (Grad-CAM) montre où le modèle « regarde »."));
  }
  document.body.appendChild(modal);
}
