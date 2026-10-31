"""Grad-CAM sur la dernière couche convolutive (model.features[-1] pour EfficientNet)."""
import base64
import io

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from model import fake_logit


def compute_gradcam(model: torch.nn.Module, x: torch.Tensor) -> np.ndarray:
    """x : tenseur (1,3,H,W) prétraité. Retourne une carte (H,W) normalisée dans [0,1]."""
    store = {}
    layer = model.features[-1]  # adaptez pour une autre architecture

    def forward_hook(_, __, output):
        store["act"] = output
        output.register_hook(lambda g: store.__setitem__("grad", g))

    handle = layer.register_forward_hook(forward_hook)
    try:
        model.zero_grad(set_to_none=True)
        with torch.enable_grad():
            # requires_grad garantit un graphe même si les poids sont gelés
            inp = x.clone().requires_grad_(True)
            out = model(inp)
            fake_logit(out).backward()
    finally:
        handle.remove()

    act, grad = store["act"][0], store["grad"][0]
    weights = grad.mean(dim=(1, 2), keepdim=True)
    cam = torch.relu((weights * act).sum(dim=0))
    cam = cam / (cam.max() + 1e-8)
    cam = F.interpolate(cam[None, None], size=x.shape[-2:], mode="bilinear", align_corners=False)
    return cam[0, 0].detach().cpu().numpy()


def heatmap_png_base64(cam: np.ndarray, size: tuple[int, int], max_side: int = 512) -> str:
    """Transforme la carte en PNG RGBA (jet, transparent là où l'activation est faible)."""
    w, h = size
    scale = min(1.0, max_side / max(w, h))
    size = (max(1, int(w * scale)), max(1, int(h * scale)))
    cam_img = Image.fromarray((cam * 255).astype(np.uint8)).resize(size, Image.BILINEAR)
    x = np.asarray(cam_img, dtype=np.float32) / 255.0
    r = np.clip(1.5 - np.abs(4 * x - 3), 0, 1)
    g = np.clip(1.5 - np.abs(4 * x - 2), 0, 1)
    b = np.clip(1.5 - np.abs(4 * x - 1), 0, 1)
    a = np.clip(x * 0.75, 0, 1)
    rgba = (np.stack([r, g, b, a], axis=-1) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")
