"""
MCP endpoint exposing the saved-prompt library as tools for ChatGPT and other MCP clients.

The tools call the existing prompt route handlers, so ownership checks, version
snapshots, and edit-conflict detection behave exactly as they do on the REST API.
The client's own model writes the prompt text; nothing here calls an LLM.

Authentication is the same bearer JWT the REST API accepts. OAuth account
linking, which ChatGPT needs to obtain that token for an end user, is not
implemented yet.
"""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
import os

import anyio.to_thread
from fastapi import HTTPException
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api import routes
from app.auth.dependencies import user_from_token
from app.branding import APP_NAME
from app.database.connection import SessionLocal
from app.metrics import prompts_generated_total, prompts_saved_total
from app.models.prompt import Prompt
from app.models.schemas import (
    PromptField,
    PromptHistoryResponse,
    PromptRequest,
    PromptUpdateRequest,
    PromptVersionResponse,
)
from app.models.user import User
from app.services.prompt_generator import PromptGeneratorService
from app.services.prompt_id_service import PromptIdService

MCP_PATH = "/api/mcp"

INSTRUCTIONS = f"""\
Tools for the user's {APP_NAME} prompt library. You write and refine the prompt
text in conversation; these tools only store and retrieve it.

A prompt is a list of named fields (for example role, task, context,
constraints, output_format), each rendered as an XML-tagged section. Save only
when the user asks to. Before updating a prompt, fetch it with get_prompt and
pass its updated_at (or created_at when updated_at is null) as last_updated_at,
so edits made elsewhere in the meantime are not overwritten.
"""


class PromptSummary(BaseModel):
    """A saved prompt without its text, for browsing the library."""

    id: int
    name: str
    folder: str | None
    tags: list[str] | None
    is_favorite: bool
    updated_at: datetime


class PromptList(BaseModel):
    prompts: list[PromptSummary]


class VersionList(BaseModel):
    versions: list[PromptVersionResponse]


class _SessionTokenVerifier:
    """Accept the same JWTs as the REST API, including their revocation checks."""

    async def verify_token(self, token: str) -> AccessToken | None:
        user_id = await anyio.to_thread.run_sync(_user_id_for_token, token)
        if user_id is None:
            return None
        return AccessToken(token=token, client_id="session", scopes=[], subject=str(user_id))


def _user_id_for_token(token: str) -> int | None:
    db = SessionLocal()
    try:
        user = user_from_token(token, db)
        return user.id if user else None
    finally:
        db.close()


@contextmanager
def _user_session() -> Iterator[tuple[Session, User]]:
    """Open a database session for the authenticated caller, translating the
    route handlers' HTTP errors into tool errors the model can read."""
    db = SessionLocal()
    try:
        user = db.get(User, int(get_access_token().subject))
        if user is None:
            msg = "Account not found"
            raise ToolError(msg)
        yield db, user
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc
    except ValidationError as exc:
        raise ToolError(str(exc)) from exc
    finally:
        db.close()


mcp_server = MCPServer(
    name="prompt-library",
    title=f"{APP_NAME} prompt library",
    instructions=INSTRUCTIONS,
    # The SDK calls logging.basicConfig at this level. The app configures no
    # logging of its own, so WARNING keeps the root output what it was before.
    log_level="WARNING",
    token_verifier=_SessionTokenVerifier(),
    # Bearer-only for now: issuer_url is required by the SDK but not advertised
    # anywhere until resource_server_url is set alongside the OAuth endpoints.
    auth=AuthSettings(
        issuer_url=os.getenv("FRONTEND_URL", "http://localhost:3000"),
        resource_server_url=None,
    ),
)

_READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)


@mcp_server.tool(annotations=_READ_ONLY)
def list_saved_prompts(
    tag: str | None = None, folder: str | None = None, favorite_only: bool = False
) -> PromptList:
    """List the user's saved prompts, newest first, optionally filtered by tag,
    folder, or favorite status. Returns names and metadata, not prompt text."""
    with _user_session() as (db, user):
        prompts = routes.get_saved_prompts(
            tag=tag, folder=folder, favorite_only=favorite_only, db=db, current_user=user
        )
        return PromptList(
            prompts=[
                PromptSummary(
                    id=p.id,
                    name=p.name,
                    folder=p.folder,
                    tags=p.tags,
                    is_favorite=p.is_favorite,
                    updated_at=p.updated_at or p.created_at,
                )
                for p in prompts
            ]
        )


@mcp_server.tool(annotations=_READ_ONLY)
def get_prompt(prompt_id: int) -> PromptHistoryResponse:
    """Get one saved prompt: its fields, rendered prompt text, and timestamps."""
    with _user_session() as (db, user):
        prompt = routes.get_prompt_by_id(prompt_id=prompt_id, db=db, current_user=user)
        return PromptHistoryResponse.model_validate(prompt)


@mcp_server.tool(annotations=_WRITE)
def save_prompt(name: str, fields: list[PromptField]) -> PromptHistoryResponse:
    """Save a new prompt to the user's library under the given name. Field names
    must be unique identifiers (letters, digits, _ or -)."""
    with _user_session() as (db, user):
        body = PromptRequest(name=name, fields=fields)
        # Mirrors POST /generate, minus its per-IP rate limit: every ChatGPT
        # call arrives from OpenAI's addresses, so all users would share one bucket.
        prompt = Prompt(
            id=PromptIdService.next_id(db),
            user_id=user.id,
            fields=[field.model_dump() for field in body.fields],
            generated_prompt=PromptGeneratorService.generate(fields=body.fields),
            name=body.name,
        )
        db.add(prompt)
        db.commit()
        prompts_generated_total.inc()
        prompts_saved_total.inc()
        prompt = routes.get_prompt_by_id(prompt_id=prompt.id, db=db, current_user=user)
        return PromptHistoryResponse.model_validate(prompt)


@mcp_server.tool(annotations=_WRITE)
def update_prompt(
    prompt_id: int,
    last_updated_at: datetime,
    fields: list[PromptField] | None = None,
    name: str | None = None,
    note: str | None = None,
) -> PromptHistoryResponse:
    """Update a saved prompt. The previous content is kept in its version history.

    `fields` replaces the whole field list, so include unchanged fields too.
    `last_updated_at` must be the updated_at (or created_at when updated_at is
    null) from get_prompt; the update is rejected if the prompt changed since.
    `note` is an optional short description of the change for the history."""
    with _user_session() as (db, user):
        body = PromptUpdateRequest(
            name=name,
            fields=fields,
            # PATCH stores the rendered text as given, so render it from the new
            # fields here or it would go stale.
            generated_prompt=(
                PromptGeneratorService.generate(fields=fields) if fields is not None else None
            ),
            note=note,
            last_updated_at=last_updated_at,
        )
        prompt = routes.update_prompt(prompt_id=prompt_id, body=body, db=db, current_user=user)
        return PromptHistoryResponse.model_validate(prompt)


@mcp_server.tool(annotations=_READ_ONLY)
def list_prompt_versions(prompt_id: int) -> VersionList:
    """List the earlier versions of a saved prompt, newest first. The current
    content is not included; get it with get_prompt."""
    with _user_session() as (db, user):
        versions = routes.get_prompt_versions(prompt_id=prompt_id, db=db, current_user=user)
        return VersionList(versions=versions)


class _MCPEndpoint:
    """The ASGI app served at MCP_PATH.

    The SDK's session manager can run only once per instance, so every
    application lifespan builds a fresh MCP app and swaps it in here.
    """

    def __init__(self) -> None:
        self._app: ASGIApp | None = None

    @asynccontextmanager
    async def lifespan(self) -> AsyncIterator[None]:
        self._app = mcp_server.streamable_http_app(
            streamable_http_path=MCP_PATH,
            # Plain request/response: no server-initiated messages are needed,
            # and no per-session state ties a client to one worker process.
            stateless_http=True,
            json_response=True,
            # Host-header checks guard unauthenticated local servers against DNS
            # rebinding. This endpoint answers only bearer-authenticated
            # requests, which a rebinding page cannot make.
            transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
        )
        async with mcp_server.session_manager.run():
            yield

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self._app(scope, receive, send)


mcp_endpoint = _MCPEndpoint()
