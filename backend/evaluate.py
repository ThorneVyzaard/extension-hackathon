"""Évaluation du modèle sur un dossier d'images (exigence section 16 du cahier des charges).

Structure attendue :   DATA/real/*.jpg   DATA/fake/*.jpg   (noms de dossiers configurables)

    python evaluate.py --data chemin/vers/test
    python evaluate.py --data chemin/vers/test --jpeg-quality 60     # test de robustesse (S7)
    python evaluate.py --data externes --name externes_midjourney

Utilise exactement le prétraitement et le sens de sortie de model.py : si la config
(FAKELENS_FAKE_IS_POSITIVE...) est inversée, l'accuracy sera très basse (< 10 %).
Les résultats sont écrits dans results/<name>.json : présentez-les tels quels (RG4).
"""
import argparse
import io
import json
import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)

from model import DEVICE, FAKE_HIGH, UNCERTAIN_LOW, fake_probability, load_model, preprocess

EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def list_images(folder: Path, limit: int | None, rng: random.Random):
    files = [p for p in folder.rglob("*") if p.suffix.lower() in EXTS]
    rng.shuffle(files)
    return files[:limit] if limit else files


def find_dir(root: Path, wanted: str) -> Path:
    for d in root.iterdir():
        if d.is_dir() and d.name.lower() == wanted.lower():
            return d
    raise SystemExit(f"Dossier '{wanted}' introuvable dans {root}")


def load(path: Path, jpeg_quality: int | None) -> Image.Image:
    img = Image.open(path).convert("RGB")
    if jpeg_quality:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=jpeg_quality)
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--real-dir", default="real")
    ap.add_argument("--fake-dir", default="fake")
    ap.add_argument("--limit", type=int, help="max d'images par classe")
    ap.add_argument("--jpeg-quality", type=int, help="recompresse en JPEG avant l'inférence")
    ap.add_argument("--threshold", type=float, default=50.0, help="seuil binaire (% IA) pour les métriques")
    ap.add_argument("--name", default=None, help="nom du fichier de résultats")
    args = ap.parse_args()

    rng = random.Random(0)
    items = [(p, 0) for p in list_images(find_dir(args.data, args.real_dir), args.limit, rng)]
    items += [(p, 1) for p in list_images(find_dir(args.data, args.fake_dir), args.limit, rng)]
    if not items:
        raise SystemExit("Aucune image trouvée.")

    model = load_model()
    y_true, scores, failed = [], [], 0
    with torch.no_grad():
        for i, (path, label) in enumerate(items, 1):
            try:
                x = preprocess(load(path, args.jpeg_quality)).unsqueeze(0).to(DEVICE)
            except Exception:
                failed += 1
                continue
            scores.append(fake_probability(model(x)) * 100)
            y_true.append(label)
            if i % 200 == 0:
                print(f"  {i}/{len(items)}")

    y_true, scores = np.array(y_true), np.array(scores)
    y_pred = (scores >= args.threshold).astype(int)
    states = {
        "real": int((scores < UNCERTAIN_LOW).sum()),
        "uncertain": int(((scores >= UNCERTAIN_LOW) & (scores < FAKE_HIGH)).sum()),
        "fake": int((scores >= FAKE_HIGH).sum()),
    }
    results = {
        "data": str(args.data),
        "n_images": int(len(y_true)),
        "n_unreadable": failed,
        "jpeg_quality": args.jpeg_quality,
        "threshold_percent": args.threshold,
        "accuracy": accuracy_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "recall": recall_score(y_true, y_pred, zero_division=0),
        "f1": f1_score(y_true, y_pred, zero_division=0),
        "auc_roc": roc_auc_score(y_true, scores) if len(set(y_true)) == 2 else None,
        "confusion_matrix [[TN, FP], [FN, TP]]": confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist(),
        "verdicts_trois_etats": states,
    }
    print(json.dumps(results, indent=2, ensure_ascii=False))
    if results["accuracy"] < 0.2:
        print("\n⚠️  Accuracy très basse : le sens de la sortie est probablement inversé "
              "(essayez FAKELENS_FAKE_IS_POSITIVE=0).")

    out = Path("results")
    out.mkdir(exist_ok=True)
    name = args.name or args.data.name + (f"_jpeg{args.jpeg_quality}" if args.jpeg_quality else "")
    (out / f"{name}.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nRésultats enregistrés dans results/{name}.json")


if __name__ == "__main__":
    main()
