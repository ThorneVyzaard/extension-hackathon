# FakeLens – détecteur d'images générées par IA

Extension Chrome/Edge (Manifest V3) + backend FastAPI local. Un modèle PyTorch (`.pt`) estime la probabilité qu'une image soit générée par IA ; une carte de chaleur Grad-CAM montre où le modèle « regarde ».

> ⚠️ Le résultat est un **score de probabilité, pas une preuve**.

## Architecture

```
Page web → content script ─┐
Clic droit → service worker ┴→ backend FastAPI (localhost:8000) → modèle model.pt
                                   /health  /predict  /explain (Grad-CAM)
```

- **Clic droit sur une image** → `/explain` : verdict, score et heatmap superposée à l'image.
- **Bouton « Analyser les images de la page »** (popup) → `/predict` sur chaque image ≥ 150 px (20 max) : badge vert / orange / rouge.
- Verdict à trois états : `< 40 %` Réel · `40–65 %` Incertain · `≥ 65 %` Probablement généré (réglable, voir ci-dessous).
- Confidentialité : le backend écoute sur `127.0.0.1`, ne stocke aucune image, et l'extension demande l'accord de l'utilisateur avant le premier envoi.

## Installation

1. Copier le modèle entraîné dans **`backend/model.pt`**.
2. Lancer le backend : `run_backend.bat` (Windows) ou `./run_backend.sh` (Linux/macOS). Il crée un environnement virtuel, installe les dépendances et démarre `uvicorn`. Vérifier : http://127.0.0.1:8000/health
3. Charger l'extension : `chrome://extensions` (ou `edge://extensions`) → **Mode développeur** → **Charger l'extension non empaquetée** → dossier `extension/`.

## Configuration (variables d'environnement)

Doit refléter l'entraînement (notebook).

| Variable | Défaut | Rôle |
|---|---|---|
| `FAKELENS_MODEL` | `backend/model.pt` | chemin du modèle |
| `FAKELENS_NUM_OUTPUTS` | `1` | 1 logit (BCE) ou 2 logits (softmax) |
| `FAKELENS_FAKE_IS_POSITIVE` | `1` | 1 logit : `1` si sigmoid > 0.5 signifie « généré ». **Avec `ImageFolder` (fake=0, real=1) mettre `0`** |
| `FAKELENS_FAKE_INDEX` | `0` | 2 logits : indice de la classe « généré » |
| `FAKELENS_UNCERTAIN_LOW` / `FAKELENS_FAKE_HIGH` | `40` / `65` | bornes de la zone « Incertain » (en %) |

Exemple (Windows) : `set FAKELENS_FAKE_IS_POSITIVE=0` avant `run_backend.bat`.
Si l'architecture n'est pas EfficientNet-B0, adapter `build_architecture()` dans `backend/model.py` (et la couche Grad-CAM dans `backend/gradcam.py`).

## API

| Méthode | Route | Entrée | Sortie |
|---|---|---|---|
| GET | `/health` | – | `{status, device}` |
| POST | `/predict` | `image` (multipart) | `{label, score}` |
| POST | `/explain` | `image` (multipart) | `{label, score, heatmap_png_base64}` |

`label` ∈ `real`, `uncertain`, `fake` ; `score` = probabilité « généré » en %. Limites : 5 Mo, JPEG/PNG/WebP, côté min. 64 px (erreurs 413 / 415 / 422). CORS limité aux extensions.

## Tests et évaluation

```bash
cd backend
pip install -r requirements-dev.txt
pytest -q                                              # plomberie de l'API (modèle aléatoire)
python evaluate.py --data chemin/test                  # dossiers real/ et fake/
python evaluate.py --data chemin/test --jpeg-quality 60   # robustesse (S7)
```

`evaluate.py` calcule accuracy, précision, rappel, F1, AUC-ROC, matrice de confusion et la répartition des trois verdicts.

## Étape suivante : inférence dans le navigateur (F4)

`python export_onnx.py` (dossier `backend`) produit `fakelens.onnx` et `fakelens.int8.onnx` et compare leurs sorties à PyTorch. Il reste à charger le modèle avec onnxruntime-web dans l'extension (même prétraitement : 224×224, normalisation ImageNet).

## Résultats mesurés

_À remplir avec les chiffres réels de `evaluate.py`, y compris les mauvais._

| Jeu de test | Accuracy | F1 | AUC-ROC | Remarque |
|---|---|---|---|---|
| 140K Faces (test) | | | | objectif > 95 % |
| CIFAKE / AI vs Human | | | | objectif > 85 % |
| Images externes (Midjourney / SD) | | | | résultat honnête, même faible |
| JPEG qualité 60 | | | | baisse < 10 points (stretch) |

## Dépannage

- **« Backend injoignable »** : lancer `run_backend`, vérifier `/health`.
- **Vraies photos classées « générées » (ou l'inverse)** : sens de sortie inversé → `FAKELENS_FAKE_IS_POSITIVE`.
- **`load_state_dict` : clés manquantes** : l'architecture de `build_architecture()` ne correspond pas à votre modèle.
- **Image non analysée** : URL `blob:`/protégée, format GIF/SVG, ou image < 64 px / > 5 Mo.
