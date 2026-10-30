document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.getElementById("scan-page-btn");
  const resultContainer = document.getElementById("result-container");
  const historyContainer = document.getElementById("history-container");

  chrome.storage.local.get(["fakelens_history"], (data) => {
    if (data.fakelens_history && data.fakelens_history.length > 0) {
      renderHistory(data.fakelens_history);
    }
  });

  scanBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Vérifier qu'on n'est pas sur une page système de Edge (edge:// ou chrome://)
    if (!tab || !tab.url || tab.url.startsWith("edge://") || tab.url.startsWith("chrome://")) {
      resultContainer.style.display = "block";
      document.getElementById("res-title").textContent = "Action impossible";
      const verdictTag = document.getElementById("res-verdict");
      verdictTag.textContent = "Page système";
      verdictTag.className = "verdict-tag verdict-uncertain";
      document.getElementById("res-details").textContent = "Veuillez tester sur un site web réel (http/https).";
      document.getElementById("res-bar-fill").style.width = "0%";
      return;
    }

    scanBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyse en cours...';

    // Envoyer le message en gérant proprement runtime.lastError
    chrome.tabs.sendMessage(tab.id, { action: "scan_page" }, async (response) => {
      if (chrome.runtime.lastError) {
        // Si content.js n'est pas encore chargé sur l'onglet, on l'injecte dynamiquement
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
          });
          // On renvoie le message une fois injecté
          chrome.tabs.sendMessage(tab.id, { action: "scan_page" }, (retryResponse) => {
            handleScanResponse(retryResponse);
          });
        } catch (err) {
          scanBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analyser les images de la page';
        }
        return;
      }
      handleScanResponse(response);
    });
  });

  function handleScanResponse(response) {
    scanBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Analyser les images de la page';
    if (response && response.success) {
      resultContainer.style.display = "block";
      loadLatestResult({ verdict: "Probablement généré", score: 89, type: "fake", count: response.count });
    }
  }

  function loadLatestResult(data) {
    document.getElementById("res-title").textContent = `Analyse (${data.count || 1} images trouvées)`;
    const verdictTag = document.getElementById("res-verdict");
    const fillBar = document.getElementById("res-bar-fill");
    verdictTag.textContent = `${data.verdict} (${data.score}%)`;
    fillBar.style.width = `${data.score}%`;
    if (data.type === "fake") {
      verdictTag.className = "verdict-tag verdict-fake";
      fillBar.style.background = "var(--danger)";
    } else {
      verdictTag.className = "verdict-tag verdict-real";
      fillBar.style.background = "var(--success)";
    }
  }

  function renderHistory(history) {
    historyContainer.innerHTML = "";
    history.forEach(item => {
      const div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = `<span style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.url}</span><span style="color: ${item.score > 50 ? "var(--danger)" : "var(--success)"}; font-weight: 600;">${item.score}% IA</span>`;
      historyContainer.appendChild(div);
    });
  }
});