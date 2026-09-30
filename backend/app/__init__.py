"""CardioTwin FastAPI service.

Serves the trained CardioTwin models (overall CAD + per-vessel LAD/LCX/RCA stenosis) with
per-prediction SHAP explanations, following the REST contract in ``docs/CONTRACTS.md`` §3.
"""

__version__ = "1.0.0"

CLINICAL_DISCLAIMER = (
    "CardioTwin is a decision-support and educational prototype. Its outputs are statistical "
    "estimates at the vessel level, not lesion localisation, and are not a substitute for formal "
    "diagnostic imaging (e.g. invasive or CT coronary angiography) or clinical judgement."
)
