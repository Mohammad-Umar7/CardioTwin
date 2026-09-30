"""The predictor boundary between the API and the ML package.

The API depends only on this structural :class:`Predictor` protocol. The production
implementation is ``cardiotwin_ml.inference.CardioTwinPredictor`` (see ``docs/CONTRACTS.md`` §1);
:class:`~app.predictors.fake.FakePredictor` implements it for tests and UI development.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Predictor(Protocol):
    """In-process model interface (contract §1).

    ``schema``/``metrics``/``cohort`` return the JSON documents of contract §2, §4 and §3.3;
    ``predict`` returns the §3.2 response body with ``engine == "server"``.
    """

    @property
    def schema(self) -> dict[str, Any]: ...

    @property
    def metrics(self) -> dict[str, Any]: ...

    @property
    def cohort(self) -> dict[str, Any]: ...

    @property
    def version(self) -> str: ...

    def predict(self, features: Mapping[str, Any]) -> dict[str, Any]: ...


REQUIRED_MEMBERS: tuple[str, ...] = ("schema", "metrics", "cohort", "version", "predict")


class PredictorLoadError(RuntimeError):
    """The model could not be loaded. The message explains what is missing and how to fix it."""


class PredictorContractError(RuntimeError):
    """The predictor returned data that violates ``docs/CONTRACTS.md``."""


def missing_members(obj: object) -> list[str]:
    """Names of protocol members ``obj`` does not provide (empty when it conforms)."""
    missing = [name for name in REQUIRED_MEMBERS if not hasattr(obj, name)]
    if "predict" not in missing and not callable(getattr(obj, "predict", None)):
        missing.append("predict (not callable)")
    return missing
