"""
Seed (or re-seed) a fully-populated "alex" demo account for manual QA and
feature demos — prompts across folders/tags, favorites, version history, and
Playground run history spanning the last 30 days, so Dashboard analytics,
per-prompt run counts, and the weekly-summary digest all have real data to
show.

Safe to re-run: replaces the account's existing data rather than duplicating
it. Every value here is fabricated — the identity uses the reserved
`example.com` domain and no real person or account is represented.

**Development and manual QA only.** The account it creates has a fixed,
publicly documented password (see `PASSWORD` below), so anyone who reads this
repository can log into it. Never seed it on an internet-reachable instance.
To prevent an accidental production run, `main()` refuses to execute unless
`SEED_DEMO_USER=1` is set explicitly.

Needs the full `app` package (unlike the dependency-free root-level
`scripts/backup_sqlite.py`), so it lives in `backend/scripts/`.

Usage:
    make seed-demo-user                                     # local venv
    SEED_DEMO_USER=1 python -m scripts.seed_demo_user       # local, manual
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import logging
import os
import random
import sys

from sqlalchemy.orm import Session

from app.auth.utils import get_password_hash
from app.database.connection import SessionLocal
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.services.llm_providers import PROVIDERS
from app.services.prompt_id_service import PromptIdService

logger = logging.getLogger(__name__)

USERNAME = "alex"
EMAIL = "alex@example.com"
# Intentionally weak and public — this account is a local demo fixture, never
# a credential. The `SEED_DEMO_USER` opt-in in `main()` guards against it ever
# being created on a deployed instance.
PASSWORD = "test1234"

# Explicit opt-in required to run the script; see the module docstring.
_OPT_IN_ENV_VAR = "SEED_DEMO_USER"

# Provider the seeded history is attributed to; see the User(...) call below.
_DEMO_PROVIDER = PROVIDERS["openai"]
_DEMO_MODELS = list(_DEMO_PROVIDER.models)

# Fixed seed so re-runs produce the same dataset shape (reproducible manual QA).
_SEED = 20260712

_SAVED_PROMPTS = [
    {
        "name": "Customer Support Reply",
        "folder": "Support",
        "tags": ["support", "email"],
        "is_favorite": True,
        "fields": [
            {"name": "tone", "content": "Friendly and professional"},
            {"name": "issue", "content": "Late delivery"},
        ],
        "generated_prompt": (
            "<TONE>Friendly and professional</TONE>\n"
            "<ISSUE>Late delivery</ISSUE>\n\n"
            "Write a reply to {{customer_name}} about their {{issue_type}}, "
            "promising a response within {{response_time}} hours."
        ),
        "variable_metadata": {
            "customer_name": {
                "type": "text",
                "description": "Name of the customer being replied to",
            },
            "issue_type": {"type": "text", "description": "Category of the support issue"},
            "response_time": {
                "type": "number",
                "description": "Promised response time in hours",
            },
        },
    },
    {
        "name": "Refund Request Template",
        "folder": "Support",
        "tags": ["support"],
        "is_favorite": False,
        "fields": [{"name": "policy", "content": "30-day money-back guarantee"}],
        "generated_prompt": (
            "<POLICY>30-day money-back guarantee</POLICY>\n\nDraft a refund confirmation email."
        ),
        "variable_metadata": None,
    },
    {
        "name": "Escalation Notice",
        "folder": "Support",
        "tags": ["support", "urgent"],
        "is_favorite": False,
        "fields": [{"name": "severity", "content": "High"}],
        "generated_prompt": (
            "<SEVERITY>High</SEVERITY>\n\n" "Escalate ticket {{ticket_id}} to the on-call engineer."
        ),
        "variable_metadata": {
            "ticket_id": {"type": "text", "description": "The support ticket identifier"},
        },
    },
    {
        "name": "Product Launch Announcement",
        "folder": "Marketing",
        "tags": ["marketing", "copy"],
        "is_favorite": True,
        "fields": [{"name": "audience", "content": "Existing customers"}],
        "generated_prompt": (
            "<AUDIENCE>Existing customers</AUDIENCE>\n\n"
            "Announce {{product_name}}, launching {{launch_date}}. "
            "Limited edition: {{is_limited_edition}}."
        ),
        "variable_metadata": {
            "product_name": {"type": "text", "description": "Name of the product being launched"},
            "launch_date": {"type": "text", "description": "Launch date, human-readable"},
            "is_limited_edition": {
                "type": "boolean",
                "description": "Whether this is a limited run",
            },
        },
    },
    {
        "name": "Social Media Post",
        "folder": "Marketing",
        "tags": ["marketing", "copy"],
        "is_favorite": False,
        "fields": [{"name": "platform", "content": "Twitter/X"}],
        "generated_prompt": (
            "<PLATFORM>Twitter/X</PLATFORM>\n\n"
            "Write a post for {{platform}} using these hashtags: {{hashtags}}."
        ),
        "variable_metadata": {
            "platform": {"type": "text", "description": "Target social platform"},
            "hashtags": {"type": "list", "description": "Comma-separated hashtags to include"},
        },
    },
    {
        "name": "Email Newsletter Intro",
        "folder": "Marketing",
        "tags": ["marketing", "email"],
        "is_favorite": False,
        "fields": [{"name": "theme", "content": "Monthly product update"}],
        "generated_prompt": (
            "<THEME>Monthly product update</THEME>\n\nWrite a 2-sentence newsletter intro."
        ),
        "variable_metadata": None,
    },
    {
        "name": "Code Review Checklist",
        "folder": "Engineering",
        "tags": ["code-review", "docs"],
        "is_favorite": False,
        "fields": [{"name": "language", "content": "Python"}],
        "generated_prompt": (
            "<LANGUAGE>Python</LANGUAGE>\n\n" "List the top 5 things to check in a code review."
        ),
        "variable_metadata": None,
    },
    {
        "name": "Bug Report Summary",
        "folder": "Engineering",
        "tags": ["code-review", "urgent"],
        "is_favorite": False,
        "fields": [{"name": "component", "content": "Auth service"}],
        "generated_prompt": (
            "<COMPONENT>Auth service</COMPONENT>\n\n"
            "Summarize a {{severity}} bug affecting version {{affected_version}}."
        ),
        "variable_metadata": {
            "severity": {"type": "text", "description": "Bug severity level"},
            "affected_version": {
                "type": "text",
                "description": "Version where the bug was found",
            },
        },
    },
]

_HISTORY_PROMPTS = [
    {
        "fields": [{"name": "goal", "content": "Draft a follow-up email"}],
        "generated_prompt": "<GOAL>Draft a follow-up email</GOAL>",
    },
    {
        "fields": [{"name": "goal", "content": "Summarize meeting notes"}],
        "generated_prompt": "<GOAL>Summarize meeting notes</GOAL>",
    },
    {
        "fields": [{"name": "goal", "content": "Write a unit test description"}],
        "generated_prompt": "<GOAL>Write a unit test description</GOAL>",
    },
]

# Relative Playground-run count per saved-prompt index (0-based) — uneven on
# purpose so Dashboard's "top prompts" ranking and per-prompt run counts have
# a clear, meaningful shape. Prompts not listed get zero runs.
_RUN_COUNTS = {0: 6, 1: 3, 2: 2, 3: 5, 4: 2, 6: 1}


def _delete_existing(db: Session, user: User) -> None:
    """FK-safe cleanup before reseeding.

    `playground_runs` has no `ON DELETE CASCADE` (unlike `prompts.user_id`),
    so it must be deleted explicitly before the user row — deleting the user
    then cascades `prompts` -> `prompt_versions` via the existing ORM
    relationships.
    """
    prompt_ids = [pid for (pid,) in db.query(Prompt.id).filter(Prompt.user_id == user.id).all()]
    if prompt_ids:
        db.query(PlaygroundRun).filter(PlaygroundRun.prompt_id.in_(prompt_ids)).delete(
            synchronize_session=False
        )
    db.delete(user)
    db.commit()


def seed_alex(db: Session) -> User:
    """Create (or replace) the `alex` demo account and its sample dataset.

    Returns:
        The created User.
    """
    rng = random.Random(_SEED)

    existing = db.query(User).filter(User.username == USERNAME).first()
    if existing is not None:
        _delete_existing(db, existing)

    now = datetime.now(UTC)
    user = User(
        username=USERNAME,
        hashed_password=get_password_hash(PASSWORD),
        email=EMAIL,
        notify_run_failure=True,
        notify_weekly_summary=True,
        # Pre-point the demo account at OpenAI, but deliberately without a key:
        # provider credentials are bring-your-own, so the operator adds theirs
        # in Settings → API access. Until then the demo data is browsable and
        # the AI features show their "connect a provider" empty state.
        llm_provider=_DEMO_PROVIDER.handle,
        llm_base_url=_DEMO_PROVIDER.default_base_url,
        llm_model=_DEMO_MODELS[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    saved_prompts: list[Prompt] = []
    for i, spec in enumerate(_SAVED_PROMPTS):
        prompt = Prompt(
            id=PromptIdService.next_id(db),
            user_id=user.id,
            name=spec["name"],
            fields=spec["fields"],
            generated_prompt=spec["generated_prompt"],
            folder=spec["folder"],
            tags=spec["tags"],
            is_favorite=spec["is_favorite"],
            variable_metadata=spec["variable_metadata"],
            created_at=now - timedelta(days=25 - i),
            updated_at=now - timedelta(days=25 - i),
        )
        db.add(prompt)
        saved_prompts.append(prompt)
    db.commit()
    for prompt in saved_prompts:
        db.refresh(prompt)

    for spec in _HISTORY_PROMPTS:
        db.add(
            Prompt(
                id=PromptIdService.next_id(db),
                user_id=user.id,
                name=None,
                fields=spec["fields"],
                generated_prompt=spec["generated_prompt"],
                created_at=now - timedelta(days=rng.randint(0, 10)),
                updated_at=now - timedelta(days=rng.randint(0, 10)),
            )
        )
    db.commit()

    # Version history on the two prompts that also demo variable_metadata.
    for prompt, prior_texts in (
        (saved_prompts[0], ["<TONE>Neutral</TONE>", "<TONE>Friendly</TONE>"]),
        (saved_prompts[3], ["<AUDIENCE>All customers</AUDIENCE>"]),
    ):
        for version_number, text in enumerate(prior_texts, start=1):
            db.add(
                PromptVersion(
                    prompt_id=prompt.id,
                    version_number=version_number,
                    note="Edit",
                    author_user_id=user.id,
                    fields=prompt.fields,
                    generated_prompt=text,
                    created_at=now - timedelta(days=20 - version_number),
                )
            )
    db.commit()

    # Playground runs spread across the last 30 days (crossing the current
    # month boundary so Dashboard's month-over-month change is non-null),
    # mixed models/status/timing, weighted per `_RUN_COUNTS`.
    statuses = ["success"] * 5 + ["error"]
    for prompt_index, count in _RUN_COUNTS.items():
        prompt = saved_prompts[prompt_index]
        for _ in range(count):
            created_at = now - timedelta(
                days=rng.randint(0, 29), hours=rng.randint(0, 23), minutes=rng.randint(0, 59)
            )
            status = rng.choice(statuses)
            db.add(
                PlaygroundRun(
                    prompt_id=prompt.id,
                    user_id=user.id,
                    model=rng.choice(_DEMO_MODELS),
                    input_variables={"customer_name": "Jordan"} if prompt_index == 0 else {},
                    output_text="Sample output." if status == "success" else "",
                    latency_ms=rng.randint(400, 3200),
                    prompt_tokens=rng.randint(50, 400),
                    completion_tokens=rng.randint(50, 400) if status == "success" else 0,
                    cost_usd=round(rng.uniform(0.0001, 0.02), 6),
                    status=status,
                    error_message=None if status == "success" else "Simulated upstream timeout.",
                    created_at=created_at,
                )
            )
    db.commit()

    return user


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    if os.getenv(_OPT_IN_ENV_VAR) != "1":
        logger.error(
            "Refusing to run: this creates the %r account with a fixed, publicly "
            "documented password and is for local development only. Set %s=1 to "
            "confirm you are seeding a throwaway database.",
            USERNAME,
            _OPT_IN_ENV_VAR,
        )
        sys.exit(1)

    db = SessionLocal()
    try:
        user = seed_alex(db)
        logger.info("Seeded demo account %r (id=%s)", user.username, user.id)
    finally:
        db.close()


if __name__ == "__main__":
    main()
