"""Unauthenticated endpoints behind the free tools for signed-out visitors."""

from fastapi import APIRouter, Request

from app.limiter import limiter
from app.schemas.public import PublicModelPrice
from app.services import public_tools

router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/model-prices", response_model=list[PublicModelPrice])
@limiter.limit("60/minute")
def get_model_prices(request: Request):
    """Curated hosted models with estimated per-million-token prices. Public data."""
    return public_tools.hosted_model_prices()
