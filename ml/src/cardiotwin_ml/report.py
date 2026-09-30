"""Publication figures (``docs/figures/*.png``, 200 dpi) and ``ml/reports/results.md`` from ``metrics.json``.

Everything is drawn from the saved metrics, so figures can be regenerated without retraining:

    ./.venv/Scripts/python -m cardiotwin_ml.report
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

from .paths import ARTIFACTS_DIR, FIGURES_DIR, REPORTS_DIR  # noqa: E402

DPI = 200
# Validated categorical order (blue, orange, aqua, yellow) + recessive ink; see the dataviz palette.
MODEL = "#2a78d6"
BASELINE = "#eb6834"
AQUA = "#1baf7a"
NEUTRAL = "#8a8985"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"
SEQ = LinearSegmentedColormap.from_list("seq_blue", ["#f4f8fd", "#9ec5f4", "#3987e5", "#1c5cab", "#0d366b"])
DIV = LinearSegmentedColormap.from_list("div_blue_red", ["#2a78d6", "#b7d3f6", "#e6e5e1", "#f3b1b0", "#d03b3b"])
GROUP_COLORS = {
    "demographics": "#2a78d6",
    "risk_factors": "#eb6834",
    "symptoms": "#1baf7a",
    "exam": "#eda100",
    "ecg": "#e87ba4",
    "labs": "#008300",
    "echo": "#4a3aa7",
    "derived": "#8a8985",
}
TARGET_TITLES = {"CAD": "CAD (any vessel)", "LAD": "LAD", "LCX": "LCX", "RCA": "RCA"}


def _style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.edgecolor": INK_2,
            "axes.linewidth": 0.8,
            "axes.labelcolor": INK,
            "axes.titlesize": 11,
            "axes.titleweight": "bold",
            "axes.labelsize": 9.5,
            "axes.grid": True,
            "grid.color": GRID,
            "grid.linewidth": 0.6,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "xtick.color": INK_2,
            "ytick.color": INK_2,
            "xtick.labelsize": 8.5,
            "ytick.labelsize": 8.5,
            "legend.fontsize": 8,
            "legend.frameon": False,
            "font.family": "DejaVu Sans",
            "savefig.dpi": DPI,
            "savefig.bbox": "tight",
        }
    )


def _targets(metrics: dict[str, Any]) -> list[str]:
    return list(metrics["targets"])


def _grid(n: int) -> tuple[plt.Figure, np.ndarray]:
    fig, axes = plt.subplots(2, 2, figsize=(9.2, 8.2)) if n == 4 else plt.subplots(1, n, figsize=(4.4 * n, 4.2))
    return fig, np.atleast_1d(axes).ravel()


def _fmt_ci(m: dict[str, Any], digits: int = 2) -> str:
    return f"{m['value']:.{digits}f} [{m['ci'][0]:.{digits}f}–{m['ci'][1]:.{digits}f}]"


def _save(fig: plt.Figure, path: Path, title: str | None = None) -> None:
    if title:
        fig.suptitle(title, fontsize=12.5, fontweight="bold", color=INK, x=0.01, ha="left")
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, metadata={"Software": None, "CreationDate": None} if path.suffix == ".pdf" else {"Software": None})
    plt.close(fig)


# --------------------------------------------------------------------------- figures


def fig_roc(metrics: dict[str, Any], path: Path) -> None:
    ts = _targets(metrics)
    fig, axes = _grid(len(ts))
    for ax, t in zip(axes, ts, strict=False):
        tr = metrics["targets"][t]
        band = tr["curves"]["roc_band"]
        ax.fill_between(band["fpr"], band["tpr_low"], band["tpr_high"], color=MODEL, alpha=0.16, linewidth=0, label="95% bootstrap band")
        roc = tr["curves"]["roc"]
        ax.plot(roc["fpr"], roc["tpr"], color=MODEL, lw=2, drawstyle="steps-post", label=f"CardioTwin  AUC {_fmt_ci(tr['test']['roc_auc'])}")
        bl = tr["baseline"]["curves"]["roc"]
        ax.plot(bl["fpr"], bl["tpr"], color=BASELINE, lw=1.6, ls="--", drawstyle="steps-post",
                label=f"Clinical baseline  AUC {_fmt_ci(tr['baseline']['test']['roc_auc'])}")
        ax.plot([0, 1], [0, 1], color=NEUTRAL, lw=0.9, ls=":")
        ax.set(xlim=(-0.01, 1.01), ylim=(-0.01, 1.01), xlabel="1 − specificity", ylabel="Sensitivity", title=TARGET_TITLES.get(t, t))
        ax.set_aspect("equal")
        ax.legend(loc="lower right")
    _save(fig, path, f"ROC curves on the locked test set (n = {metrics['dataset']['n_test']})")


def fig_pr(metrics: dict[str, Any], path: Path) -> None:
    ts = _targets(metrics)
    fig, axes = _grid(len(ts))
    for ax, t in zip(axes, ts, strict=False):
        tr = metrics["targets"][t]
        pr = tr["curves"]["pr"]
        prev = metrics["dataset"]["prevalence_test"][t]
        ax.plot(pr["recall"], pr["precision"], color=MODEL, lw=2, drawstyle="steps-pre", label=f"CardioTwin  AP {_fmt_ci(tr['test']['pr_auc'])}")
        ax.axhline(prev, color=NEUTRAL, lw=0.9, ls=":", label=f"Prevalence {prev:.2f}")
        ax.set(xlim=(-0.01, 1.01), ylim=(0, 1.02), xlabel="Recall (sensitivity)", ylabel="Precision (PPV)", title=TARGET_TITLES.get(t, t))
        ax.legend(loc="lower left")
    _save(fig, path, "Precision–recall curves on the locked test set")


def fig_calibration(metrics: dict[str, Any], path: Path) -> None:
    ts = _targets(metrics)
    fig, axes = _grid(len(ts))
    for ax, t in zip(axes, ts, strict=False):
        tr = metrics["targets"][t]
        cal = tr["curves"]["calibration"]
        cs = tr["calibration_summary"]
        ax.plot([0, 1], [0, 1], color=NEUTRAL, lw=0.9, ls=":", label="Perfect calibration")
        n_bin = int(round(float(np.mean(cal["count"]))))
        ax.plot(cal["mean_predicted"], cal["fraction_positive"], color=MODEL, lw=2, marker="o", markersize=6,
                markeredgecolor="white", markeredgewidth=1.5, label=f"Quantile bins (~{n_bin} patients each)")
        ax.text(0.03, 0.97, f"Brier {tr['test']['brier']['value']:.3f}\nECE {cs['ece']:.3f}\nslope {cs['calibration_slope']:.2f}",
                transform=ax.transAxes, va="top", fontsize=8, color=INK)
        ax.set(xlim=(0, 1), ylim=(0, 1.02), xlabel="Predicted probability", ylabel="Observed fraction stenotic", title=TARGET_TITLES.get(t, t))
        ax.set_aspect("equal")
        ax.legend(loc="lower right")
    _save(fig, path, "Calibration (reliability) on the locked test set")


def fig_dca(metrics: dict[str, Any], path: Path) -> None:
    ts = _targets(metrics)
    fig, axes = _grid(len(ts))
    for ax, t in zip(axes, ts, strict=False):
        d = metrics["targets"][t]["curves"]["dca"]
        th = np.asarray(d["thresholds"])
        model, allv = np.asarray(d["model"]), np.asarray(d["treat_all"])
        ax.plot(th, model, color=MODEL, lw=2, label="CardioTwin")
        ax.plot(th, allv, color=BASELINE, lw=1.4, ls="--", label="Treat all")
        ax.plot(th, d["treat_none"], color=NEUTRAL, lw=1.2, ls=":", label="Treat none")
        top = max(float(np.max(model)), float(np.max(allv)), 0.05)
        ax.set(xlim=(th.min(), th.max()), ylim=(-0.05, top * 1.12), xlabel="Threshold probability", ylabel="Net benefit",
               title=TARGET_TITLES.get(t, t))
        ax.axvline(metrics["targets"][t]["threshold"], color=INK_2, lw=0.8, alpha=0.6)
        ax.legend(loc="upper right")
    _save(fig, path, "Decision-curve analysis (test set); vertical line = deployed threshold")


def fig_confusion(metrics: dict[str, Any], path: Path) -> None:
    ts = _targets(metrics)
    fig, axes = plt.subplots(1, len(ts), figsize=(3.2 * len(ts), 3.3))
    for ax, t in zip(np.atleast_1d(axes), ts, strict=False):
        cm = metrics["targets"][t]["confusion_matrix"]
        mat = np.array([[cm["tn"], cm["fp"]], [cm["fn"], cm["tp"]]])
        rates = mat / mat.sum(axis=1, keepdims=True)
        ax.imshow(rates, cmap=SEQ, vmin=0, vmax=1)
        for i in range(2):
            for j in range(2):
                ax.text(j, i, f"{mat[i, j]}\n{rates[i, j]:.0%}", ha="center", va="center", fontsize=10,
                        color="white" if rates[i, j] > 0.55 else INK)
        ax.set_xticks([0, 1], ["Pred. normal", "Pred. stenotic"])
        ax.set_yticks([0, 1], ["Normal", "Stenotic"])
        ax.grid(False)
        ax.set_title(f"{TARGET_TITLES.get(t, t)}  (t = {metrics['targets'][t]['threshold']:.2f})")
    _save(fig, path, "Confusion matrices at the deployed (Youden) thresholds — test set")


def fig_importance(metrics: dict[str, Any], path: Path, top: int = 12) -> None:
    ts = _targets(metrics)
    groups = metrics["dataset"].get("feature_groups", {})
    fig, axes = _grid(len(ts))
    for ax, t in zip(axes, ts, strict=False):
        imp = metrics["targets"][t]["global_importance"][:top][::-1]
        names = [r["feature"] for r in imp]
        vals = [r["mean_abs_shap"] for r in imp]
        colors = [GROUP_COLORS.get(groups.get(n, "derived"), NEUTRAL) for n in names]
        ax.barh(names, vals, color=colors, height=0.68, edgecolor="white", linewidth=1)
        ax.set(xlabel="mean |SHAP| (log-odds)", title=TARGET_TITLES.get(t, t))
        ax.grid(axis="y", visible=False)
        ax.tick_params(axis="y", labelsize=8)
    used = sorted({groups.get(r["feature"], "derived") for t in ts for r in metrics["targets"][t]["global_importance"][:top]})
    handles = [plt.Rectangle((0, 0), 1, 1, color=GROUP_COLORS.get(g, NEUTRAL)) for g in used]
    fig.legend(handles, [g.replace("_", " ") for g in used], loc="lower center", ncol=len(used), bbox_to_anchor=(0.5, -0.02))
    _save(fig, path, "Global feature importance — mean |SHAP| on the development set")
    fig.subplots_adjust(bottom=0.08)


def fig_beeswarm(metrics: dict[str, Any], path: Path, top: int = 10) -> None:
    ts = _targets(metrics)
    fig, axes = plt.subplots(2, 2, figsize=(11.5, 9.0), layout="constrained") if len(ts) == 4 else _grid(len(ts))
    axes = np.atleast_1d(axes).ravel()
    rng = np.random.default_rng(0)
    sc = None
    for ax, t in zip(axes, ts, strict=False):
        rows = metrics["targets"][t]["beeswarm"][:top]
        for k, row in enumerate(rows[::-1]):
            s = np.array([p["s"] for p in row["points"]])
            v = np.array([p["v"] for p in row["points"]])
            jitter = rng.uniform(-0.28, 0.28, size=len(s))
            sc = ax.scatter(s, np.full(len(s), k) + jitter, c=v, cmap=DIV, vmin=0, vmax=1, s=7, linewidths=0, alpha=0.9)
        ax.set_yticks(range(len(rows)), [r["feature"] for r in rows[::-1]], fontsize=8)
        ax.axvline(0, color=INK_2, lw=0.8)
        ax.grid(axis="y", visible=False)
        ax.set(xlabel="SHAP value (log-odds)", title=TARGET_TITLES.get(t, t))
    if sc is not None:
        cb = fig.colorbar(sc, ax=list(axes), shrink=0.45, pad=0.01)
        cb.set_label("Feature value (low → high)", fontsize=8)
        cb.set_ticks([0, 1], labels=["low", "high"])
    fig.suptitle("SHAP beeswarm — each dot is one development-set patient", fontsize=12.5, fontweight="bold", color=INK, x=0.01, ha="left")
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, metadata={"Software": None})
    plt.close(fig)


def fig_leaderboard(metrics: dict[str, Any], path: Path) -> None:
    ts = _targets(metrics)
    fig, axes = plt.subplots(1, len(ts), figsize=(3.4 * len(ts), 4.6), sharey=False)
    for ax, t in zip(np.atleast_1d(axes), ts, strict=False):
        lb = metrics["targets"][t]["leaderboard"][::-1]
        y = np.arange(len(lb))
        means = np.array([r["roc_auc_mean"] for r in lb])
        sds = np.array([r["roc_auc_std"] for r in lb])
        colors = [MODEL if r["model"] == "ensemble" else (NEUTRAL if r["model"] == "dummy_prior" else INK_2) for r in lb]
        ax.errorbar(means, y, xerr=sds, fmt="none", ecolor=GRID, elinewidth=2.2, capsize=0)
        ax.scatter(means, y, c=colors, s=40, zorder=3, edgecolors="white", linewidths=1.2)
        ax.set_yticks(y, [r["model"] for r in lb], fontsize=8)
        ax.set(xlim=(0.4, 1.0), xlabel="CV ROC-AUC (mean ± sd)", title=TARGET_TITLES.get(t, t))
        ax.grid(axis="y", visible=False)
    p = metrics["protocol"]
    _save(fig, path, f"Development-set leaderboard — repeated stratified {p['cv_splits']}-fold × {p['cv_repeats']}, nested tuning")


def fig_test_forest(metrics: dict[str, Any], path: Path) -> None:
    ts = _targets(metrics)
    fig, ax = plt.subplots(figsize=(7.6, 3.6))
    for i, t in enumerate(ts[::-1]):
        tr = metrics["targets"][t]
        for off, m, col, lab in ((0.14, tr["test"]["roc_auc"], MODEL, "CardioTwin"),
                                 (-0.14, tr["baseline"]["test"]["roc_auc"], BASELINE, "Clinical baseline (5 features)")):
            ax.plot(m["ci"], [i + off] * 2, color=col, lw=2.2, solid_capstyle="round")
            ax.scatter([m["value"]], [i + off], color=col, s=42, zorder=3, edgecolors="white", linewidths=1.2, label=lab if i == 0 else None)
        cv = tr["cv"]["roc_auc"]
        ax.scatter([cv["mean"]], [i + 0.14], marker="|", color=INK, s=120, zorder=4, label="Dev-CV mean" if i == 0 else None)
    ax.set_yticks(range(len(ts)), [TARGET_TITLES.get(t, t) for t in ts[::-1]])
    ax.axvline(0.5, color=NEUTRAL, lw=0.9, ls=":")
    ax.set(xlim=(0.35, 1.0), xlabel="Test ROC-AUC with 95% bootstrap CI")
    ax.grid(axis="y", visible=False)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=3, fontsize=7.5)
    _save(fig, path, "Held-out discrimination: full model vs clinical baseline")


def fig_cooccurrence(metrics: dict[str, Any], path: Path) -> None:
    co = metrics["dataset"]["label_cooccurrence"]
    names, mat = co["targets"], np.array(co["counts"])
    pats = metrics["dataset"]["label_patterns"]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.5, 4.0), gridspec_kw={"width_ratios": [1, 1.5]})
    ax1.imshow(mat, cmap=SEQ)
    for i in range(len(names)):
        for j in range(len(names)):
            ax1.text(j, i, str(mat[i, j]), ha="center", va="center", fontsize=9, color="white" if mat[i, j] > mat.max() * 0.55 else INK)
    ax1.set_xticks(range(len(names)), names)
    ax1.set_yticks(range(len(names)), names)
    ax1.grid(False)
    ax1.set_title("Label co-occurrence (patients)")
    items = sorted(pats.items(), key=lambda kv: -kv[1])
    labels = []
    for p, _ in items:
        vessels = [n for n, b in zip(names[1:], p[1:], strict=True) if b == "1"]
        label = " + ".join(vessels) or "none"
        if p[0] == "0" and vessels:
            label += " (Cath normal)"
        labels.append(label)
    ax2.bar(range(len(items)), [c for _, c in items], color=MODEL, width=0.68, edgecolor="white")
    for k, (_, c) in enumerate(items):
        ax2.text(k, c + 1, str(c), ha="center", fontsize=8, color=INK_2)
    ax2.set_xticks(range(len(items)), labels, rotation=35, ha="right", fontsize=8)
    ax2.set(ylabel="Patients", title="Joint stenosis patterns (vessels stenotic)")
    ax2.grid(axis="x", visible=False)
    _save(fig, path, f"Label structure of the cohort (n = {metrics['dataset']['n']})")


def fig_ablations(metrics: dict[str, Any], path: Path) -> None:
    abl = metrics["ablations"]["variants"]
    variants = list(abl)
    ts = _targets(metrics)
    fig, ax = plt.subplots(figsize=(7.6, 3.4))
    width = 0.8 / len(variants)
    palette = [MODEL, BASELINE, AQUA]
    for v_i, v in enumerate(variants):
        xs, ys = [], []
        for t_i, t in enumerate(ts):
            r = abl[v]["targets"].get(t)
            if r is None:
                continue
            xs.append(t_i + (v_i - (len(variants) - 1) / 2) * width)
            ys.append(r["delta_auc_mean"])
        tag = "adopted" if abl[v]["adopted"] else "rejected"
        ax.bar(xs, ys, width=width * 0.92, color=palette[v_i % 3], label=f"{v} (mean {abl[v]['mean_delta_auc']:+.3f}, {tag})",
               edgecolor="white", linewidth=1)
    ax.axhline(0, color=INK_2, lw=0.8)
    gain = float(metrics["ablations"]["min_gain"])
    ax.axhline(gain, color=NEUTRAL, lw=0.9, ls=":", label=f"adoption bar (+{gain:.3f})")
    ax.set_xticks(range(len(ts)), ts)
    ax.set(ylabel="Δ CV ROC-AUC vs raw features")
    ax.grid(axis="x", visible=False)
    ax.legend(fontsize=7.5, loc="lower left")
    _save(fig, path, "Evidence-driven extras (paired dev-CV ablations)")


FIGURES = {
    "roc_curves.png": fig_roc,
    "pr_curves.png": fig_pr,
    "calibration.png": fig_calibration,
    "decision_curves.png": fig_dca,
    "confusion_matrices.png": fig_confusion,
    "shap_importance.png": fig_importance,
    "shap_beeswarm.png": fig_beeswarm,
    "cv_leaderboard.png": fig_leaderboard,
    "test_auc_forest.png": fig_test_forest,
    "label_cooccurrence.png": fig_cooccurrence,
    "ablations.png": fig_ablations,
}


def make_figures(metrics: dict[str, Any], out_dir: Path = FIGURES_DIR) -> list[Path]:
    _style()
    out = []
    for name, fn in FIGURES.items():
        path = out_dir / name
        fn(metrics, path)
        out.append(path)
    return out


# --------------------------------------------------------------------------- results.md


def _ci(m: dict[str, Any]) -> str:
    return f"{m['value']:.3f} ({m['ci'][0]:.3f}–{m['ci'][1]:.3f})"


def _cv(m: dict[str, Any]) -> str:
    return f"{m['mean']:.3f} ± {m['std']:.3f}"


def results_markdown(metrics: dict[str, Any]) -> str:
    ts = _targets(metrics)
    ds = metrics["dataset"]
    lines = [
        "# CardioTwin — model results",
        "",
        f"Dataset: {ds['name']} (n = {ds['n']}; development {ds['n_dev']}, locked test {ds['n_test']}). "
        "Test metrics are point estimates with 95% stratified-bootstrap CIs "
        f"({metrics['protocol']['n_bootstrap']} resamples) at the deployed threshold (Youden's J on out-of-fold "
        f"development predictions). CV = development-set repeated stratified {metrics['protocol']['cv_splits']}-fold × "
        f"{metrics['protocol']['cv_repeats']} (mean ± sd over folds).",
        "",
        "## Held-out test set (deployed LR + XGBoost ensemble)",
        "",
        "| Target | ROC-AUC | PR-AUC | F1 | Sensitivity | Specificity | Accuracy | Balanced acc. | MCC | Brier |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for t in ts:
        m = metrics["targets"][t]["test"]
        lines.append(
            f"| {t} | {_ci(m['roc_auc'])} | {_ci(m['pr_auc'])} | {_ci(m['f1'])} | {_ci(m['recall'])} | {_ci(m['specificity'])} "
            f"| {_ci(m['accuracy'])} | {_ci(m['balanced_accuracy'])} | {_ci(m['mcc'])} | {_ci(m['brier'])} |"
        )
    lines += [
        "",
        "## Development-set cross-validation (same ensemble, out-of-fold)",
        "",
        "| Target | ROC-AUC | PR-AUC | F1 | Sensitivity | Specificity | Accuracy | Brier |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for t in ts:
        m = metrics["targets"][t]["cv"]
        lines.append(
            f"| {t} | {_cv(m['roc_auc'])} | {_cv(m['pr_auc'])} | {_cv(m['f1'])} | {_cv(m['recall'])} | {_cv(m['specificity'])} "
            f"| {_cv(m['accuracy'])} | {_cv(m['brier'])} |"
        )
    lines += [
        "",
        "## What the full panel adds over a clinical baseline (test set)",
        "",
        "Baseline = logistic regression on age, sex, typical angina, diabetes and hypertension.",
        "",
        "| Target | Full model ROC-AUC | Baseline ROC-AUC | Δ ROC-AUC (paired bootstrap 95% CI) |",
        "| --- | --- | --- | --- |",
    ]
    for t in ts:
        tr = metrics["targets"][t]
        d = tr["baseline"]["delta_roc_auc_test"]
        lines.append(
            f"| {t} | {_ci(tr['test']['roc_auc'])} | {_ci(tr['baseline']['test']['roc_auc'])} | "
            f"{d['value']:+.3f} ({d['ci'][0]:+.3f} to {d['ci'][1]:+.3f}) |"
        )
    lines += ["", "## Cross-validation leaderboard (top 5 by ROC-AUC per target)", ""]
    for t in ts:
        lines += [f"**{t}**", "", "| Rank | Model | CV ROC-AUC | CV F1 @ 0.5 | CV Brier |", "| --- | --- | --- | --- | --- |"]
        for k, r in enumerate(metrics["targets"][t]["leaderboard"][:5], 1):
            lines.append(f"| {k} | {r['label']} | {r['roc_auc_mean']:.3f} ± {r['roc_auc_std']:.3f} | {r['f1_mean']:.3f} | {r['brier_mean']:.3f} |")
        lines.append("")
    lines += ["## Deployed configuration", "", "| Target | Logistic variant | w (LR) | Platt a, b | Threshold (Youden) | Threshold (F1) | Top-3 features (mean \\|SHAP\\|) |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for t in ts:
        tr = metrics["targets"][t]
        c = tr["components"]
        top = ", ".join(r["feature"] for r in tr["global_importance"][:3])
        lines.append(
            f"| {t} | {c['logistic']['name']} | {c['logistic']['weight']:.2f} | {c['platt']['a']:.3f}, {c['platt']['b']:.3f} | "
            f"{tr['threshold']:.3f} | {tr['threshold_f1']:.3f} | {top} |"
        )
    abl = metrics["ablations"]["variants"]
    lines += ["", "## Ablations (development CV, paired folds)", "", "| Variant | Mean Δ ROC-AUC | Adopted |", "| --- | --- | --- |"]
    for v, r in abl.items():
        lines.append(f"| {v} | {r['mean_delta_auc']:+.4f} | {'yes' if r['adopted'] else 'no'} |")
    lines += ["", f"_Generated from `ml/artifacts/metrics.json` ({metrics['generated_at']})._", ""]
    return "\n".join(lines)


def write_results_md(metrics: dict[str, Any], path: Path = REPORTS_DIR / "results.md") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(results_markdown(metrics), encoding="utf-8", newline="\n")


def main() -> None:
    metrics = json.loads((ARTIFACTS_DIR / "metrics.json").read_text(encoding="utf-8"))
    make_figures(metrics, FIGURES_DIR)
    write_results_md(metrics, REPORTS_DIR / "results.md")
    print(f"figures -> {FIGURES_DIR}; results -> {REPORTS_DIR / 'results.md'}")


if __name__ == "__main__":
    main()
