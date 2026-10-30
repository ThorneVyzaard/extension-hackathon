// Injection de styles pour les badges visuels (Stretch S1) et overlays Grad-CAM (F5)
const style = document.createElement('style');
style.innerHTML = `
  .fakelens-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 999999;
    padding: 6px 12px;
    border-radius: 20px;
    font-family: 'Plus Jakarta Sans', sans-serif;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    backdrop-filter: blur(8px);
    animation: fadeIn 0.3s ease-in-out;
  }
  .fakelens-badge.real { background: rgba(16, 185, 129, 0.9); color: white; }
  .fakelens-badge.fake { background: rgba(239, 68, 68, 0.9); color: white; }
  .fakelens-badge.uncertain { background: rgba(245, 158, 11, 0.9); color: white; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
`;
document.head.appendChild(style);

// Écouteur des messages venant du popup ou background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scan_page") {
    const images = document.querySelectorAll('img');
    images.forEach((img, index) => {
      if (img.width > 150 && img.height > 150) {
        addBadgeToImage(img, 'fake', 91); // Exemple visuel simulé pour la démo
      }
    });
    sendResponse({ success: true, count: images.length });
  }
});

function addBadgeToImage(img, status, score) {
  // S'assurer que le parent est en position relative pour positionner le badge
  if (window.getComputedStyle(img).position === 'static') {
    img.style.position = 'relative';
  }
  
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';
  
  // Création du badge coloré (Vert, Orange, Rouge - S1)
  const badge = document.createElement('div');
  badge.className = `fakelens-badge ${status}`;
  badge.innerHTML = `<i class="fa-solid fa-robot"></i> ${score}% IA`;
  
  // Insertion dans le DOM
  if(img.parentNode && !img.parentNode.classList.contains('fakelens-wrapper')) {
    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);
    wrapper.appendChild(badge);
  }
}