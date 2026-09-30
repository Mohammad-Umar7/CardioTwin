"""Model card for ``GET /api/model-card``.

``docs/MODEL_CARD.md`` (or ``<artifacts>/MODEL_CARD.md``) is served verbatim when present.
Otherwise a card is generated from the loaded ``metrics.json`` and ``schema.json`` so the endpoint
always returns an accurate, current summary rather than a 404.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from app import CLINICAL_DISCLAIMER
from app.config import Settings
from app.models import LEAKAGE_KEYS
from app.runtime import Runtime


def load_model_card(settings: Settings, runtime: Runtime) -> tuple[str, str]:
    """Return ``(markdown, source)`` where source is ``"file"`` or ``"generated"``."""
    for candidate in (settings.model_card_path, settings.artifacts_dir / "MODEL_CARD.md"):
        if Path(candidate).is_file():
            return Path(candidate).read_text(encoding="utf-8"), "file"
    return generate_model_card(runtime), "generated"


def _metric(block: Any, name: str) -> str:
    """Format ``{"value": v, "ci": [lo, hi]}`` or ``{"mean": m, "std": s}`` entries."""
    entry = block.get(name) if isinstance(block, dict) else None
    if not isinstance(entry, dict):
        return "–"
    if isinstance(entry.get("value"), (int, float)):
        text = f"{entry['value']:.3f}"
        ci = entry.get("ci")
        if isinstance(ci, list) and len(ci) == 2 and all(isinstance(c, (int, float)) for c in ci):
            text += f" ({ci[0]:.2f}–{ci[1]:.2f})"
        return text
    if isinstance(entry.get("mean"), (int, float)):
        std = entry.get("std")
        return f"{entry['mean']:.3f} ± {std:.3f}" if isinstance(std, (int, float)) else f"{entry['mean']:.3f}"
    return "–"


def generate_model_card(runtime: Runtime) -> str:
    metrics: dict[str, Any] = _loads(runtime.metrics_doc.body)
    dataset = metrics.get("dataset") or {}
    protocol = metrics.get("protocol") or {}
    targets: dict[str, Any] = metrics.get("targets") or {}
    schema = runtime.schema
    group_labels = {g.id: g.label for g in schema.groups}
    per_group = Counter(f.group for f in schema.features)

    lines = [
        "# CardioTwin model card",
        "",
        "_Generated automatically from the loaded `metrics.json` and `schema.json`._",
        "",
        f"- **Model version:** {runtime.model_version}",
        f"- **Predictor:** {runtime.kind}",
        f"- **Metrics generated at:** {metrics.get('generated_at', 'unknown')}",
        "",
        "## Intended use",
        "",
        f"> {CLINICAL_DISCLAIMER}",
        "",
        "Predicts overall coronary artery disease (CAD) and stenosis of the three major vessels "
        "(LAD, LCX, RCA) from demographic, clinical-exam, ECG, laboratory and echocardiographic data. "
        "Risk is reported per vessel; nothing is inferred about where inside a vessel a lesion lies.",
        "",
        "## Data",
        "",
        f"- **Dataset:** {dataset.get('name', 'Extension of Z-Alizadeh Sani')} (UCI id 411, CC BY 4.0)",
        f"- **Patients:** {dataset.get('n', '–')} (development {dataset.get('n_dev', '–')}, "
        f"held-out test {dataset.get('n_test', '–')})",
    ]
    prevalence = dataset.get("prevalence") or {}
    if prevalence:
        lines.append(
            "- **Prevalence:** "
            + ", ".join(f"{t} {v:.1%}" for t, v in prevalence.items() if isinstance(v, (int, float)))
        )
    lines += [
        "",
        "## Inputs",
        "",
        f"{len(schema.features)} raw features: "
        + ", ".join(f"{group_labels.get(g, g)} ({n})" for g, n in per_group.items())
        + f". The angiography outcomes {', '.join(sorted(LEAKAGE_KEYS))} are never model inputs.",
        "",
    ]
    if protocol:
        lines += ["## Validation protocol", ""]
        lines += [f"- **{k}:** {v}" for k, v in protocol.items()]
        lines.append("")
    if targets:
        lines += [
            "## Performance",
            "",
            "Held-out test set (95% CI where available); cross-validated ROC-AUC on the development set.",
            "",
            "| Target | Model | Test ROC-AUC | Test F1 | Recall | Precision | Accuracy | CV ROC-AUC | Threshold |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for target in runtime.targets:
            block = targets.get(target)
            if not isinstance(block, dict):
                continue
            test, cv = block.get("test") or {}, block.get("cv") or {}
            threshold = block.get("threshold")
            threshold_text = f"{threshold:.2f}" if isinstance(threshold, (int, float)) else "–"
            lines.append(
                f"| {target} | {block.get('selected_model', '–')} | {_metric(test, 'roc_auc')} | "
                f"{_metric(test, 'f1')} | {_metric(test, 'recall')} | {_metric(test, 'precision')} | "
                f"{_metric(test, 'accuracy')} | {_metric(cv, 'roc_auc')} | {threshold_text} |"
            )
        lines.append("")
    lines += [
        "## Explanations",
        "",
        "Every prediction carries per-feature SHAP contributions in the log-odds (margin) space of the "
        "uncalibrated ensemble; `base_value + Σ shap = output_value`. Probabilities are calibrated.",
        "",
        "## Limitations",
        "",
        "- Small single-centre cohort; performance on other populations is unknown.",
        "- Vessel-level risk only: the 3D colouring shows a probability per artery, not a lesion location.",
        "- Region RWMA is an echocardiographic wall-motion finding, not a map of coronary lesions.",
        "- Not a medical device; not validated for clinical decision-making.",
        "",
    ]
    return "\n".join(lines)


def _loads(body: bytes) -> dict[str, Any]:
    data = json.loads(body)
    return data if isinstance(data, dict) else {}
