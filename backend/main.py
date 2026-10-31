"""Backend FastAPI de FakeLens (local uniquement, aucune image conservée - RG5/RG6).

Lancer :  uvicorn main:app --host 127.0.0.1 --port 8000
"""
import io
import logging
import threading

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from gradcam import compute_gradcam, heatmap_png_base64
from model import DEVICE, MODEL_PATH, fake_probability, load_model, preprocess, verdict

MAX_BYTES = 5 * 1024 * 1024
MIN_SIDE = 64
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

app = FastAPI(title="FakeLens API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://.*$",  # limité aux extensions
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

log = logging.getLogger("fakelens")
model = load_model()  # chargé une seule fois au démarrage
log.info("Modèle chargé : %s (%s)", MODEL_PATH, DEVICE)

# Le Grad-CAM pose des hooks sur le modèle partagé : on sérialise les inférences.
model_lock = threading.Lock()


def read_image(upload: UploadFile) -> Image.Image:
    data = upload.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image trop lourde (maximum 5 Mo).")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(415, "Format non supporté (JPEG, PNG ou WebP uniquement).")
    if img.format not in ALLOWED_FORMATS:
        raise HTTPException(415, f"Format {img.format} non supporté (JPEG, PNG ou WebP uniquement).")
    if min(img.size) < MIN_SIDE:
        raise HTTPException(422, f"Image trop petite (minimum {MIN_SIDE}×{MIN_SIDE} px).")
    return img.convert("RGB")


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE}


@app.post("/predict")
def predict(image: UploadFile = File(...)):
    img = read_image(image)
    x = preprocess(img).unsqueeze(0).to(DEVICE)
    with model_lock, torch.no_grad():
        p = fake_probability(model(x))
    score = round(p * 100, 1)
    return {"label": verdict(score), "score": score}


@app.post("/explain")
def explain(image: UploadFile = File(...)):
    img = read_image(image)
    x = preprocess(img).unsqueeze(0).to(DEVICE)
    with model_lock:
        with torch.no_grad():
            p = fake_probability(model(x))
        cam = compute_gradcam(model, x)
    score = round(p * 100, 1)
    return {
        "label": verdict(score),
        "score": score,
        "heatmap_png_base64": heatmap_png_base64(cam, img.size),
    }
