"""Compose the account-related HTTP routers."""

from fastapi import APIRouter

from app.api import account_routes, llm_connection_routes, password_routes, session_routes

router = APIRouter()
for routes in (session_routes, account_routes, llm_connection_routes, password_routes):
    router.include_router(routes.router)
