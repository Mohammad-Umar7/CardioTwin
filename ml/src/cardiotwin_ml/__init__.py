"""CardioTwin prediction pipeline.

Predicts overall coronary artery disease (CAD) and vessel-level stenosis (LAD, LCX, RCA) from routine
clinical data (Extension of Z-Alizadeh Sani dataset), explains every prediction with exact SHAP values
in log-odds space, and exports a portable JSON model that a browser can evaluate bit-for-bit.

Entry points
------------
* ``python -m cardiotwin_ml.train``        - full, deterministic training + evaluation + export run
* ``cardiotwin_ml.inference.CardioTwinPredictor`` - in-process predictor used by the FastAPI backend
* ``cardiotwin_ml.portable``               - dependency-free reference evaluator for ``model.json``
"""

__version__ = "1.0.0"
MODEL_VERSION = "1.0.0"

__all__ = ["__version__", "MODEL_VERSION"]
