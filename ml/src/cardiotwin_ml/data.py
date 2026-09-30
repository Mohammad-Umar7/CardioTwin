"""Reproducible acquisition of the *Extension of Z-Alizadeh Sani* dataset (UCI id 411).

The spreadsheet is committed under ``data/raw/`` so the pipeline works offline; :func:`ensure_dataset`
re-downloads it from UCI only when the file is missing, and always verifies its SHA-256 digest so a
silently changed upstream file can never alter published results.

Run ``python -m cardiotwin_ml.data`` to (re)download and verify.
"""

from __future__ import annotations

import hashlib
import io
import logging
import shutil
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from .paths import RAW_DATA_DIR

log = logging.getLogger(__name__)

UCI_DATASET_ID = 411
UCI_PAGE = "https://archive.ics.uci.edu/dataset/411/extention+of+z+alizadeh+sani+dataset"
UCI_ZIP_URL = "https://archive.ics.uci.edu/static/public/411/extention+of+z+alizadeh+sani+dataset.zip"
UCI_DOI = "10.24432/C5461K"
XLSX_NAME = "extention of Z-Alizadeh sani dataset.xlsx"
SHEET_NAME = "Sheet 1 - Table 1"

#: Digest of the spreadsheet itself - the authoritative integrity check.
XLSX_SHA256 = "739343245c2ba578b541370217531750d8e936022f928b83e0d91756caa3ff0b"
#: Digest of the UCI zip as downloaded on 2026-09-30 (informational: UCI may re-pack the archive).
ZIP_SHA256 = "e97af1a18733d64fa88caa0628e5fe7ce6b2e26ec4c7ee03baade92a6f1470e8"

EXPECTED_SHAPE = (303, 59)


class DatasetIntegrityError(RuntimeError):
    """Raised when the dataset on disk or from UCI does not match the pinned digest/shape."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def download_dataset(dest_dir: Path = RAW_DATA_DIR, timeout: float = 60.0) -> Path:
    """Download the UCI zip, verify it and extract the spreadsheet into ``dest_dir``."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    log.info("Downloading %s", UCI_ZIP_URL)
    request = urllib.request.Request(UCI_ZIP_URL, headers={"User-Agent": "cardiotwin-ml/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as resp:  # noqa: S310 - fixed https URL
        payload = resp.read()
    zip_digest = sha256_bytes(payload)
    if zip_digest != ZIP_SHA256:
        # UCI occasionally re-packs archives; the spreadsheet digest below is the binding check.
        log.warning("UCI zip digest changed (%s); verifying the spreadsheet itself", zip_digest)
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        member = next((n for n in zf.namelist() if n.lower().endswith(".xlsx")), None)
        if member is None:
            raise DatasetIntegrityError("UCI archive does not contain an .xlsx file")
        content = zf.read(member)
    digest = sha256_bytes(content)
    if digest != XLSX_SHA256:
        raise DatasetIntegrityError(
            f"Spreadsheet digest mismatch: expected {XLSX_SHA256}, got {digest}. "
            "The upstream file changed; results would not be reproducible."
        )
    target = dest_dir / XLSX_NAME
    tmp = target.with_suffix(".part")
    tmp.write_bytes(content)
    shutil.move(str(tmp), str(target))
    log.info("Saved %s (%d bytes, sha256 verified)", target, len(content))
    return target


def ensure_dataset(dest_dir: Path = RAW_DATA_DIR, allow_download: bool = True) -> Path:
    """Return the verified local spreadsheet path, downloading it only if absent."""
    path = dest_dir / XLSX_NAME
    if not path.exists():
        if not allow_download:
            raise FileNotFoundError(path)
        return download_dataset(dest_dir)
    digest = sha256_file(path)
    if digest != XLSX_SHA256:
        raise DatasetIntegrityError(f"{path} has sha256 {digest}, expected {XLSX_SHA256}")
    return path


def load_raw(path: Path | None = None) -> pd.DataFrame:
    """Load the untouched spreadsheet (303 x 59) exactly as published by UCI."""
    path = path or ensure_dataset()
    df = pd.read_excel(path, sheet_name=SHEET_NAME, engine="openpyxl")
    if df.shape != EXPECTED_SHAPE:
        raise DatasetIntegrityError(f"Unexpected shape {df.shape}, expected {EXPECTED_SHAPE}")
    # Strip incidental whitespace from headers and string cells without changing any value.
    df.columns = [str(c).strip() for c in df.columns]
    for col in df.columns:
        if df[col].dtype == object or pd.api.types.is_string_dtype(df[col]):
            df[col] = df[col].astype(str).str.strip()
    return df


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    path = download_dataset() if not (RAW_DATA_DIR / XLSX_NAME).exists() else ensure_dataset()
    df = load_raw(path)
    print(f"OK {path} sha256={XLSX_SHA256} shape={df.shape}")


if __name__ == "__main__":
    main()
