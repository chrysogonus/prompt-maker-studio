"""
MCP endpoint exposing the saved-prompt library as tools for ChatGPT and other MCP clients.

The tools call shared prompt services, so ownership checks, version
snapshots, and edit-conflict detection behave exactly as they do on the REST API.
The client's own model writes the prompt text; nothing here calls an LLM.

Clients authenticate with an access token from this server's OAuth flow
(services/oauth_provider.py), which is how ChatGPT links an account. The REST
API's own bearer JWT is accepted too, for scripts and local testing.
"""

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime

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

from app.auth.dependencies import user_from_token
from app.branding import APP_NAME
from app.database.connection import SessionLocal
from app.models.user import User
from app.schemas.prompts import (
    PromptCreateRequest,
    PromptField,
    PromptHistoryResponse,
    PromptUpdateRequest,
    PromptVersionResponse,
)
from app.services.errors import OperationError
from app.services.oauth_provider import ISSUER_URL, RESOURCE_URL, user_from_mcp_access_token
from app.services.prompts import library, versions

MCP_PATH = "/api/mcp"
# RFC 9728 protected-resource metadata, which the 401 challenge points clients to.
PROTECTED_RESOURCE_METADATA_PATH = f"/.well-known/oauth-protected-resource{MCP_PATH}"

INSTRUCTIONS = f"""\
Tools for the user's {APP_NAME} prompt library. You write and refine the prompt
text in conversation; these tools only store and retrieve it.

A prompt is a list of named fields (for example Role, Task, Context,
Constraints, Output format), each rendered as an XML-tagged section. Save only
when the user asks to. Before updating a prompt, fetch it with get_prompt and
pass its updated_at (or created_at when updated_at is null) as last_updated_at,
so edits made elsewhere in the meantime are not overwritten.
"""


class PromptSummary(BaseModel):
    """A saved prompt without its text, for browsing the library."""

    id: int
    name: str
    folder: str | None
    is_favorite: bool
    updated_at: datetime


class PromptList(BaseModel):
    prompts: list[PromptSummary]


class VersionList(BaseModel):
    versions: list[PromptVersionResponse]


class _TokenVerifier:
    """Accept OAuth access tokens issued for this endpoint, or the REST API's
    session JWTs, with the same revocation checks either way."""

    async def verify_token(self, token: str) -> AccessToken | None:
        return await anyio.to_thread.run_sync(_access_for_token, token)


def _access_for_token(token: str) -> AccessToken | None:
    with SessionLocal() as db:
        if resolved := user_from_mcp_access_token(token, db):
            user, payload = resolved
            return AccessToken(
                token=token,
                client_id=payload["client_id"],
                scopes=[],
                expires_at=payload["exp"],
                resource=RESOURCE_URL,
                subject=str(user.id),
            )
        if user := user_from_token(token, db):
            return AccessToken(token=token, client_id="session", scopes=[], subject=str(user.id))
    return None


@contextmanager
def _user_session() -> Iterator[tuple[Session, User]]:
    """Open a database session for the authenticated caller, translating the
    services' operation errors into tool errors the model can read."""
    db = SessionLocal()
    try:
        user = db.get(User, int(get_access_token().subject))
        if user is None:
            msg = "Account not found"
            raise ToolError(msg)
        yield db, user
    except (HTTPException, OperationError) as exc:
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
    token_verifier=_TokenVerifier(),
    auth=AuthSettings(
        issuer_url=ISSUER_URL,
        resource_server_url=RESOURCE_URL,
        # The verifier checks the audience of OAuth tokens itself; session
        # JWTs carry none and are accepted deliberately.
        validate_token_resource=False,
    ),
)

_READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)
_UPDATE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False)


@mcp_server.tool(annotations=_READ_ONLY)
def list_saved_prompts(folder: str | None = None, favorite_only: bool = False) -> PromptList:
    """List the user's saved prompts, newest first, optionally filtered by
    folder or favorite status. Returns names and metadata, not prompt text."""
    with _user_session() as (db, user):
        prompts = library.get_saved_prompts(
            folder=folder, favorite_only=favorite_only, db=db, user_id=user.id
        )
        return PromptList(
            prompts=[
                PromptSummary(
                    id=p.id,
                    name=p.name,
                    folder=p.folder,
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
        prompt = library.get_prompt_by_id(prompt_id=prompt_id, db=db, user_id=user.id)
        return PromptHistoryResponse.model_validate(prompt)


@mcp_server.tool(annotations=_WRITE)
def save_prompt(name: str, fields: list[PromptField]) -> PromptHistoryResponse:
    """Save a new prompt to the user's library under the given name. Field names
    must be unique; they may contain letters, digits, spaces, _ or -, and start
    with a letter or _."""
    with _user_session() as (db, user):
        body = PromptCreateRequest(name=name, fields=fields)
        prompt = library.create_prompt(body=body, db=db, user_id=user.id)
        return PromptHistoryResponse.model_validate(prompt)


@mcp_server.tool(annotations=_UPDATE)
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
            note=note,
            last_updated_at=last_updated_at,
        )
        prompt = library.update_prompt(prompt_id=prompt_id, body=body, db=db, user_id=user.id)
        return PromptHistoryResponse.model_validate(prompt)


@mcp_server.tool(annotations=_READ_ONLY)
def list_prompt_versions(prompt_id: int) -> VersionList:
    """List the earlier versions of a saved prompt, newest first. The current
    content is not included; get it with get_prompt."""
    with _user_session() as (db, user):
        history = versions.get_prompt_versions(prompt_id=prompt_id, db=db, user_id=user.id)
        return VersionList(versions=history)


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
