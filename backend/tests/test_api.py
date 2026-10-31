"""Tests de l'API avec un modèle aléatoire (vérifie la plomberie, pas la qualité du modèle).

    pip install -r requirements-dev.txt
    cd backend && pytest -q
"""
import base64
import io
import os
import sys
from pathlib import Path

import pytest
import torch
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    path = tmp_path_factory.mktemp("model") / "model.pt"
    os.environ["FAKELENS_MODEL"] = str(path)
    os.environ["FAKELENS_NUM_OUTPUTS"] = "1"
    from model import build_architecture

    torch.manual_seed(0)
    torch.save(build_architecture().state_dict(), path)

    from fastapi.testclient import TestClient

    import main

    return TestClient(main.app)


def make_image(size=(300, 200), fmt="PNG"):
    buf = io.BytesIO()
    Image.effect_noise(size, 64).convert("RGB").save(buf, format=fmt)
    return buf.getvalue()


def post(client, route, data, name="img"):
    return client.post(route, files={"image": (name, data, "application/octet-stream")})


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_predict_accepts_supported_formats(client, fmt):
    r = post(client, "/predict", make_image(fmt=fmt))
    assert r.status_code == 200
    body = r.json()
    assert body["label"] in {"real", "uncertain", "fake"}
    assert 0 <= body["score"] <= 100


def test_explain_returns_heatmap_matching_aspect_ratio(client):
    r = post(client, "/explain", make_image(size=(300, 200)))
    assert r.status_code == 200
    body = r.json()
    heat = Image.open(io.BytesIO(base64.b64decode(body["heatmap_png_base64"])))
    assert heat.mode == "RGBA"
    assert abs(heat.width / heat.height - 300 / 200) < 0.02


def test_image_too_small(client):
    r = post(client, "/predict", make_image(size=(32, 32)))
    assert r.status_code == 422 and "petite" in r.json()["detail"]


def test_unsupported_format(client):
    r = post(client, "/predict", make_image(fmt="GIF"))
    assert r.status_code == 415


def test_not_an_image(client):
    r = post(client, "/predict", b"ceci n'est pas une image")
    assert r.status_code == 415


def test_image_too_large(client):
    r = post(client, "/predict", os.urandom(6 * 1024 * 1024))
    assert r.status_code == 413


def test_verdict_thresholds():
    from model import FAKE_HIGH, UNCERTAIN_LOW, verdict

    assert verdict(UNCERTAIN_LOW - 0.1) == "real"
    assert verdict(UNCERTAIN_LOW) == "uncertain"
    assert verdict(FAKE_HIGH - 0.1) == "uncertain"
    assert verdict(FAKE_HIGH) == "fake"
