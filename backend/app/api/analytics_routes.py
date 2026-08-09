"""
API routes for Dashboard usage analytics.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.models.schemas import DashboardStatsResponse
from app.models.user import User
from app.services.analytics_service import AnalyticsService

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/dashboard", response_model=DashboardStatsResponse)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregate the calling user's Dashboard usage stats: runs this month
    (+ % change vs last month), average Playground latency, success rate,
    a 7-day request-volume series, and top prompts by Playground usage.

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        The user's Dashboard analytics summary
    """
    return AnalyticsService.dashboard_summary(db, current_user.id)
