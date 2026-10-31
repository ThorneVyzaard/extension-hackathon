"""Chargement du modèle .pt et prétraitement.

⚠️ Tout ce qui est dans la section CONFIG doit correspondre à ce que vous avez
fait dans le notebook d'entraînement (RG3 : prétraitement identique).
"""
import os
from pathlib import Path

import torch
import torch.nn as nn
from torchvision import models, transforms

# ---------------------------------------------------------------- CONFIG ----
MODEL_PATH = Path(os.getenv("FAKELENS_MODEL", Path(__file__).parent / "model.pt"))
IMG_SIZE = 224
MEAN = (0.485, 0.456, 0.406)  # normalisation ImageNet
STD = (0.229, 0.224, 0.225)

# Nombre de sorties de la tête : 1 (BCE, un seul logit) ou 2 (softmax).
NUM_OUTPUTS = int(os.getenv("FAKELENS_NUM_OUTPUTS", "1"))

# Cas 1 logit : la classe "positive" (sigmoid > 0.5) est-elle "fake" ?
# ATTENTION : avec torchvision ImageFolder, les classes sont triées par ordre
# alphabétique : fake=0, real=1  -> le logit représente "real" => mettre 0.
FAKE_IS_POSITIVE = os.getenv("FAKELENS_FAKE_IS_POSITIVE", "1") == "1"

# Cas 2 logits : indice de la classe "fake" (ImageFolder : fake=0).
FAKE_INDEX = int(os.getenv("FAKELENS_FAKE_INDEX", "0"))

# Seuils du verdict à trois états (RG2), en % de probabilité "généré".
UNCERTAIN_LOW = float(os.getenv("FAKELENS_UNCERTAIN_LOW", "40"))
FAKE_HIGH = float(os.getenv("FAKELENS_FAKE_HIGH", "65"))
# -------------------------------------------------------------------------

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

preprocess = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
])


def build_architecture() -> nn.Module:
    """EfficientNet-B0 avec une tête à NUM_OUTPUTS sorties.
    Adaptez si votre architecture est différente (ex. ViT-Tiny, CNN perso)."""
    m = models.efficientnet_b0(weights=None)
    m.classifier[1] = nn.Linear(m.classifier[1].in_features, NUM_OUTPUTS)
    return m


def load_model(path: Path = MODEL_PATH, device: str = DEVICE) -> nn.Module:
    if not Path(path).is_file():
        raise FileNotFoundError(
            f"Modèle introuvable : {path}\nCopiez votre fichier dans backend/model.pt "
            "ou définissez FAKELENS_MODEL=chemin/vers/modele.pt"
        )
    # weights_only=False autorise un modèle complet picklé : ne chargez que
    # vos propres fichiers .pt (jamais un fichier venu d'une source inconnue).
    obj = torch.load(path, map_location=device, weights_only=False)
    if isinstance(obj, nn.Module):
        model = obj
    else:
        sd = obj
        for key in ("state_dict", "model_state_dict", "model"):
            if isinstance(obj, dict) and isinstance(obj.get(key), dict):
                sd = obj[key]
                break
        sd = {k.removeprefix("module."): v for k, v in sd.items()}
        model = build_architecture()
        model.load_state_dict(sd, strict=True)
    return model.to(device).eval()


def fake_logit(output: torch.Tensor) -> torch.Tensor:
    """Scalaire différentiable : plus il est grand, plus 'fake' est probable."""
    if output.shape[-1] == 1:
        z = output.reshape(-1)[0]
        return z if FAKE_IS_POSITIVE else -z
    return output[0, FAKE_INDEX]


def fake_probability(output: torch.Tensor) -> float:
    """Probabilité (0-1) que l'image soit générée."""
    if output.shape[-1] == 1:
        return torch.sigmoid(fake_logit(output)).item()
    return torch.softmax(output, dim=-1)[0, FAKE_INDEX].item()


def verdict(score_percent: float) -> str:
    if score_percent >= FAKE_HIGH:
        return "fake"
    if score_percent >= UNCERTAIN_LOW:
        return "uncertain"
    return "real"
