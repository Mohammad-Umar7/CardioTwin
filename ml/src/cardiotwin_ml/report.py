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


# --------------------------------------------------------------------------- validation-analysis figures
# Drawn only when python -m cardiotwin_ml.analysis has added the corresponding keys to metrics.json.

GROUP_SHORT = {
    "demographics": "Demogr.",
    "risk_factors": "+Risk f.",
    "symptoms": "+Sympt.",
    "exam": "+Exam",
    "ecg": "+ECG",
    "labs": "+Labs",
    "echo": "+Echo",
}


def fig_robustness(metrics: dict[str, Any], path: Path) -> None:
    rob = metrics["robustness"]
    ts = [t for t in _targets(metrics) if t in rob]
    panels = (("roc_auc", "ROC-AUC  (higher is better)"), ("f1", "F1 at the deployed threshold"), ("brier", "Brier score  (lower is better)"))
    fig, axes = plt.subplots(1, 3, figsize=(13.2, 4.3), sharey=True)
    rng = np.random.default_rng(0)
    for ax, (key, xlabel) in zip(axes, panels, strict=True):
        for i, t in enumerate(ts):
            y = len(ts) - 1 - i
            d = rob[t][key]
            s = np.asarray(rob[t]["samples"][key])
            ax.scatter(s, y + rng.uniform(-0.22, 0.22, size=len(s)), s=6, color=MODEL, alpha=0.22, linewidths=0, zorder=1)
            ax.plot([d["p05"], d["p95"]], [y, y], color=INK_2, lw=1.2, zorder=2, solid_capstyle="round")
            ax.plot([d["p25"], d["p75"]], [y, y], color=MODEL, lw=7, zorder=3, solid_capstyle="butt")
            ax.scatter([d["p50"]], [y], marker="|", s=160, color="white", linewidths=2.2, zorder=4)
            ax.scatter([d["fixed_split"]], [y + 0.34], marker="D", s=46, color=BASELINE, edgecolors="white", linewidths=1.2, zorder=5)
            ax.annotate(f"P{d['fixed_split_percentile']:.0f}", (d["fixed_split"], y + 0.34), xytext=(7, -3),
                        textcoords="offset points", fontsize=7.5, color=INK_2)
            if key == "roc_auc":
                cv = rob[t]["cv_estimate"]["roc_auc"]
                ax.scatter([cv], [y - 0.34], marker="^", s=34, color=INK, zorder=5)
        ax.set(xlabel=xlabel)
        ax.set_ylim(-0.7, len(ts) - 0.3)
        ax.grid(axis="y", visible=False)
    axes[0].set_yticks(range(len(ts)), [TARGET_TITLES.get(t, t) for t in ts[::-1]])
    handles = [
        plt.Line2D([], [], color=MODEL, marker="o", ls="", alpha=0.5, markersize=4, label=f"one of {rob[ts[0]]['n_splits']} random 80/20 splits"),
        plt.Line2D([], [], color=MODEL, lw=7, label="interquartile range (white tick = median)"),
        plt.Line2D([], [], color=INK_2, lw=1.2, label="5th–95th percentile"),
        plt.Line2D([], [], color=BASELINE, marker="D", ls="", markersize=6, label="locked test split (P = its percentile)"),
        plt.Line2D([], [], color=INK, marker="^", ls="", markersize=6, label="cross-fitted dev-CV mean"),
    ]
    fig.legend(handles=handles, loc="lower center", ncol=5, bbox_to_anchor=(0.5, -0.07), fontsize=7.8)
    mode = metrics.get("analysis", {}).get("robustness", {}).get("hyperparameters", "search")
    _save(fig, path, f"Monte-Carlo repeated hold-out of the frozen recipe ({'hyper-parameters re-searched' if mode == 'search' else 'deployed hyper-parameters'} in every split)")


def fig_modality(metrics: dict[str, Any], path: Path) -> None:
    mod = metrics["modality_ablation"]
    ts = [t for t in _targets(metrics) if t in mod]
    fig, axes = plt.subplots(2, len(ts), figsize=(3.6 * len(ts), 7.4), sharey="row", sharex="row",
                             gridspec_kw={"height_ratios": [1.15, 1]})
    axes = np.atleast_2d(axes)
    for c, t in enumerate(ts):
        m = mod[t]
        ax = axes[0, c]
        cum = m["cumulative"]
        xs = np.arange(len(cum))
        means = np.array([r["roc_auc"]["mean"] for r in cum])
        lo = means - np.array([r["roc_auc"]["ci"][0] for r in cum])
        hi = np.array([r["roc_auc"]["ci"][1] for r in cum]) - means
        first_test = next((k for k, r in enumerate(cum) if r["group"] not in ("demographics", "risk_factors", "symptoms", "exam")), None)
        if first_test is not None:
            ax.axvspan(first_test - 0.5, len(cum) - 0.5, color="#f4f8fd", zorder=0, lw=0)
            ax.text(first_test - 0.4, 0.515, "instrumental tests", fontsize=7.2, color=INK_2)
        ax.errorbar(xs, means, yerr=[lo, hi], fmt="none", ecolor=GRID, elinewidth=2.4, capsize=0, zorder=1)
        ax.plot(xs, means, color=INK_2, lw=1.2, zorder=2)
        ax.scatter(xs, means, s=46, zorder=3, edgecolors="white", linewidths=1.3,
                   c=[GROUP_COLORS.get(r["group"], NEUTRAL) for r in cum])
        ax.set_xticks(xs, [GROUP_SHORT.get(r["group"], r["group"]) for r in cum], rotation=40, ha="right", fontsize=7.8)
        ax.set(ylim=(0.5, 1.0), title=TARGET_TITLES.get(t, t))
        ax.grid(axis="x", visible=False)
        if "instrumental" in m:
            d = m["instrumental"]["delta"]
            ax.text(0.03, 0.96, f"ECG+labs+echo vs bedside\nΔ {d['mean']:+.3f} [{d['ci'][0]:+.3f}, {d['ci'][1]:+.3f}]",
                    transform=ax.transAxes, va="top", fontsize=7.6, color=INK)
        if c == 0:
            ax.set_ylabel("Dev-CV ROC-AUC (95% corrected-t CI)")

        ax2 = axes[1, c]
        loo = m["leave_one_out"]
        ys = np.arange(len(loo))[::-1]
        dm = np.array([r["delta_vs_full"]["mean"] for r in loo])
        dlo = dm - np.array([r["delta_vs_full"]["ci"][0] for r in loo])
        dhi = np.array([r["delta_vs_full"]["ci"][1] for r in loo]) - dm
        ax2.barh(ys, dm, height=0.62, color=[GROUP_COLORS.get(r["group"], NEUTRAL) for r in loo], edgecolor="white", linewidth=1)
        ax2.errorbar(dm, ys, xerr=[dlo, dhi], fmt="none", ecolor=INK_2, elinewidth=1.1, capsize=2)
        ax2.axvline(0, color=INK_2, lw=0.8)
        ax2.set_yticks(ys, [r["label"] for r in loo], fontsize=8)
        ax2.grid(axis="y", visible=False)
        ax2.set_xlabel("Δ ROC-AUC if removed (vs full panel)")
    p = metrics.get("analysis", {}).get("modality_ablation", {})
    _save(fig, path, f"What each modality adds — development CV ({p.get('n_folds', 50)} paired folds); "
                     "top: cumulative, bottom: leave-one-modality-out")


def fig_subgroups(metrics: dict[str, Any], path: Path) -> None:
    sub = metrics["subgroups"]
    ts = [t for t in _targets(metrics) if t in sub]
    first = sub[ts[0]]
    rows: list[tuple[str, str | None, str | None]] = [("Overall", None, None)]
    for fid, fac in first["factors"].items():
        for lv in fac["levels"]:
            rows.append((lv["label"], fid, lv["id"]))
    ypos, y, prev = [], 0.0, None
    for _, fid, _ in rows:
        if prev is not None and fid != prev:
            y += 0.6
        ypos.append(y)
        y += 1.0
        prev = fid
    ypos = [max(ypos) - v for v in ypos]
    fig, axes = plt.subplots(1, len(ts), figsize=(3.4 * len(ts) + 1.2, 4.9), sharey=True)
    for ax, t in zip(np.atleast_1d(axes), ts, strict=False):
        for (_label, fid, lid), yv in zip(rows, ypos, strict=True):
            if fid is None:
                blocks = sub[t]["overall"]
            else:
                blocks = next(lv for lv in sub[t]["factors"][fid]["levels"] if lv["id"] == lid)
            for off, name, color, marker in ((0.16, "oof", MODEL, "o"), (-0.16, "test", BASELINE, "D")):
                b = blocks[name]
                if b["roc_auc"] is None:
                    continue
                v, (lo, hi) = b["roc_auc"]["value"], b["roc_auc"]["ci"]
                ax.plot([lo, hi], [yv + off] * 2, color=color, lw=1.8, alpha=0.55 if b["small_n"] else 1.0, solid_capstyle="round")
                ax.scatter([v], [yv + off], marker=marker, s=34, zorder=3, linewidths=1.3,
                           facecolors="white" if b["small_n"] else color, edgecolors=color)
        ax.axvline(0.5, color=NEUTRAL, lw=0.9, ls=":")
        ax.set(xlim=(0.25, 1.02), xlabel="ROC-AUC (95% bootstrap CI)", title=TARGET_TITLES.get(t, t))
        ax.grid(axis="y", visible=False)
    labels = []
    for label, fid, lid in rows:
        if fid is None:
            b = first["overall"]
        else:
            b = next(lv for lv in first["factors"][fid]["levels"] if lv["id"] == lid)
        labels.append(f"{label}  ({b['oof']['n']} / {b['test']['n']})")
    np.atleast_1d(axes)[0].set_yticks(ypos, labels, fontsize=8)
    handles = [
        plt.Line2D([], [], color=MODEL, marker="o", lw=1.8, label="development, cross-fitted out-of-fold"),
        plt.Line2D([], [], color=BASELINE, marker="D", lw=1.8, label="locked test set (deployed model)"),
        plt.Line2D([], [], color=INK_2, marker="o", ls="", markerfacecolor="white", label="hollow = small n (unstable)"),
    ]
    fig.legend(handles=handles, loc="lower center", ncol=3, bbox_to_anchor=(0.5, -0.06), fontsize=8)
    _save(fig, path, "Subgroup discrimination — labels show patients (development / test)")


ANALYSIS_FIGURES = {
    "robustness.png": ("robustness", fig_robustness),
    "modality_ablation.png": ("modality_ablation", fig_modality),
    "subgroups.png": ("subgroups", fig_subgroups),
}


def make_analysis_figures(metrics: dict[str, Any], out_dir: Path = FIGURES_DIR) -> list[Path]:
    """Figures of the validation analyses present in ``metrics`` (``python -m cardiotwin_ml.analysis``)."""
    _style()
    out = []
    for name, (key, fn) in ANALYSIS_FIGURES.items():
        if metrics.get(key):
            path = out_dir / name
            fn(metrics, path)
            out.append(path)
    return out


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
    return out + make_analysis_figures(metrics, out_dir)


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
        f"{metrics['protocol']['cv_repeats']} with nested tuning (mean ± sd over folds).",
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
        "## Calibration on the held-out test set",
        "",
        "Calibration slope/intercept: logistic recalibration of the test outcomes on the predicted log-odds (ideal 1 / 0); "
        "ECE over quantile bins of ~10 patients.",
        "",
        "| Target | Brier | Log-loss | Calibration slope | Calibration intercept | Calibration-in-the-large | ECE |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for t in ts:
        tr = metrics["targets"][t]
        c = tr["calibration_summary"]
        lines.append(
            f"| {t} | {_ci(tr['test']['brier'])} | {_ci(tr['test']['log_loss'])} | {c['calibration_slope']:.2f} | "
            f"{c['calibration_intercept']:+.2f} | {c['calibration_in_the_large']:+.3f} | {c['ece']:.3f} |"
        )
    lines += [
        "",
        "## Development-set cross-validation (ensemble recipe, cross-fitted)",
        "",
        "For every outer fold the logistic variant, ensemble weight, Platt calibration and threshold are re-chosen on the "
        "other folds of that repeat only, so the scored fold never influences a choice (no selection optimism).",
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
    history = metrics["protocol"].get("test_set_history") or []
    if history:
        lines += ["", "## Use of the locked test set", ""]
        lines += [f"* **{h['release']}** — {' '.join(str(h['note']).split())}" for h in history]
    abl = metrics["ablations"]["variants"]
    lines += ["", "## Ablations (development CV, paired folds)", "", "| Variant | Mean Δ ROC-AUC | Adopted |", "| --- | --- | --- |"]
    for v, r in abl.items():
        lines.append(f"| {v} | {r['mean_delta_auc']:+.4f} | {'yes' if r['adopted'] else 'no'} |")
    lines += analysis_markdown(metrics)
    lines += ["", f"_Generated from `ml/artifacts/metrics.json` ({metrics['generated_at']})._", ""]
    return "\n".join(lines)


def _dist(d: dict[str, Any], digits: int = 3) -> str:
    return f"{d['p50']:.{digits}f} ({d['p05']:.{digits}f}–{d['p95']:.{digits}f})"


def _dci(d: dict[str, Any], digits: int = 3) -> str:
    return f"{d['mean']:+.{digits}f} ({d['ci'][0]:+.{digits}f} to {d['ci'][1]:+.{digits}f})"


def analysis_markdown(metrics: dict[str, Any]) -> list[str]:
    """Sections for the validation analyses (only those present in ``metrics``)."""
    ts = _targets(metrics)
    meta = metrics.get("analysis", {})
    lines: list[str] = []
    rob = metrics.get("robustness")
    if rob:
        p = meta.get("robustness", {})
        lines += [
            "",
            "## Robustness: Monte-Carlo repeated hold-out",
            "",
            f"{p.get('method', '')} Median (5th–95th percentile) over the {rob[ts[0]]['n_splits']} splits; *percentile* = "
            "where the locked test split falls in that distribution. The harness reproduces the deployed model on the "
            f"locked split exactly (max |Δp| = {p.get('reproduction', {}).get('max_abs_probability_difference', float('nan')):.1g}).",
            "",
            "| Target | Locked test ROC-AUC | MC ROC-AUC | Percentile | MC F1 | MC Brier | MC calibration slope | Beats baseline | Dev-CV ROC-AUC (percentile) |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for t in ts:
            r = rob[t]
            lines.append(
                f"| {t} | {r['roc_auc']['fixed_split']:.3f} | {_dist(r['roc_auc'])} | {r['fixed_split_percentile']:.0f} | "
                f"{_dist(r['f1'])} | {_dist(r['brier'])} | {_dist(r['calibration_slope'], 2)} | "
                f"{r['delta_roc_auc_vs_baseline']['share_positive']:.0%} of splits | "
                f"{r['cv_estimate']['roc_auc']:.3f} ({r['cv_estimate']['percentile']:.0f}) |"
            )
        if all("hyperparameter_sensitivity" in rob[t] for t in ts):
            parts = [
                f"{t} {rob[t]['hyperparameter_sensitivity']['roc_auc_mean_alternative']:.3f} vs "
                f"{rob[t]['hyperparameter_sensitivity']['roc_auc_mean_primary']:.3f}"
                for t in ts
            ]
            lines += [
                "",
                f"Tuning-optimism check (same splits, {rob[ts[0]]['hyperparameter_sensitivity']['compared']}): mean ROC-AUC "
                "with the deployed hyper-parameters reused vs re-searched per split — " + "; ".join(parts) + ".",
            ]
    mod = metrics.get("modality_ablation")
    if mod:
        p = meta.get("modality_ablation", {})
        cum_groups = [r["group"] for r in mod[ts[0]]["cumulative"]]
        labels = {r["group"]: r["label"] for r in mod[ts[0]]["cumulative"]}
        lines += [
            "",
            "## Modality ablation (development CV)",
            "",
            f"{p.get('method', '')} Model: {p.get('model', '')}. CIs: {p.get('ci', '')}.",
            "",
            "Cumulative ROC-AUC (mean over folds):",
            "",
            "| Target | " + " | ".join(("" if k == 0 else "+") + labels[g] for k, g in enumerate(cum_groups)) + " |",
            "| --- | " + " | ".join("---" for _ in cum_groups) + " |",
        ]
        for t in ts:
            lines.append(f"| {t} | " + " | ".join(f"{r['roc_auc']['mean']:.3f}" for r in mod[t]["cumulative"]) + " |")
        if all("instrumental" in mod[t] for t in ts):
            lines += [
                "",
                "What the instrumental modalities add to bedside information (demographics, history, symptoms, examination):",
                "",
                "| Target | Bedside ROC-AUC | + ECG, labs, echo | Δ (95% CI) | p | Folds improved |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
            for t in ts:
                i = mod[t]["instrumental"]
                lines.append(
                    f"| {t} | {i['bedside_roc_auc']['mean']:.3f} | {i['full_roc_auc']['mean']:.3f} | {_dci(i['delta'])} | "
                    f"{i['delta']['p_value']:.3f} | {i['delta']['share_folds_improved']:.0%} |"
                )
        lines += [
            "",
            "Leave-one-modality-out: Δ ROC-AUC when the modality is removed from the full panel (negative = unique information; "
            "Holm-adjusted p in brackets):",
            "",
            "| Modality | " + " | ".join(ts) + " |",
            "| --- | " + " | ".join("---" for _ in ts) + " |",
        ]
        for k, r0 in enumerate(mod[ts[0]]["leave_one_out"]):
            cells = []
            for t in ts:
                d = mod[t]["leave_one_out"][k]["delta_vs_full"]
                cells.append(f"{_dci(d)} [{d['p_holm']:.2f}]")
            lines.append(f"| {r0['label']} | " + " | ".join(cells) + " |")
    sub = metrics.get("subgroups")
    if sub:
        p = meta.get("subgroups", {})
        lines += [
            "",
            "## Subgroups (exploratory)",
            "",
            f"{p.get('method', '')} {p.get('ci', '')}. † = small n ({p.get('small_n', '')}); — = not estimable.",
            "",
            "| Subgroup | n (dev / test) | " + " | ".join(f"{t} OOF ROC-AUC | {t} test" for t in ts) + " |",
            "| --- | --- | " + " | ".join("--- | ---" for _ in ts) + " |",
        ]

        def cell(b: dict[str, Any], with_ci: bool) -> str:
            if b["roc_auc"] is None:
                return "—"
            v = b["roc_auc"]
            txt = f"{v['value']:.2f} ({v['ci'][0]:.2f}–{v['ci'][1]:.2f})" if with_ci else f"{v['value']:.2f}"
            return txt + (" †" if b["small_n"] else "")

        rows = [("All patients", None, None)] + [
            (f"{fac['label']}: {lv['label']}", fid, lv["id"]) for fid, fac in sub[ts[0]]["factors"].items() for lv in fac["levels"]
        ]
        for label, fid, lid in rows:
            cells, n = [], ""
            for t in ts:
                blk = sub[t]["overall"] if fid is None else next(lv for lv in sub[t]["factors"][fid]["levels"] if lv["id"] == lid)
                n = f"{blk['oof']['n']} / {blk['test']['n']}"
                cells += [cell(blk["oof"], True), cell(blk["test"], False)]
            lines.append(f"| {label} | {n} | " + " | ".join(cells) + " |")
        lines += ["", f"_{p.get('caveat', '')}_"]
    return lines


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
