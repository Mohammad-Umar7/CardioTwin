"""API routers, all mounted under ``/api``."""

from fastapi import APIRouter

from app.routers import cohort, meta, predict

api_router = APIRouter(prefix="/api")
api_router.include_router(meta.router)
api_router.include_router(predict.router)
api_router.include_router(cohort.router)

__all__ = ["api_router"]
