"""Étape suivante (exigence F4) : .pt -> ONNX -> INT8, pour tourner dans le navigateur.

    python export_onnx.py
Produit fakelens.onnx et fakelens.int8.onnx, puis compare les sorties avec PyTorch.
Dépendances : pip install onnx onnxruntime
"""
import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic

from model import IMG_SIZE, fake_probability, load_model

model = load_model()
dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE)
torch.onnx.export(
    model, dummy, "fakelens.onnx",
    input_names=["input"], output_names=["logits"],
    dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    opset_version=17,
)
quantize_dynamic("fakelens.onnx", "fakelens.int8.onnx", weight_type=QuantType.QUInt8)

with torch.no_grad():
    ref = fake_probability(model(dummy))
for path in ("fakelens.onnx", "fakelens.int8.onnx"):
    sess = ort.InferenceSession(path)
    out = sess.run(None, {"input": dummy.numpy()})[0]
    p = fake_probability(torch.from_numpy(np.asarray(out)))
    print(f"{path}: p_fake={p:.4f} (PyTorch: {ref:.4f}, écart {abs(p - ref):.4f})")
