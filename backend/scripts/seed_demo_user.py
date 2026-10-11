"""
Seed (or re-seed) a fully populated "alex" demo account for manual QA,
feature demos and the README screenshots: everyday and long prompts across
folders, favorites, variables with hints, an unfiled prompt, one recovered
history prompt, and version histories worth comparing.

Every prompt's text is rendered from its sections, exactly as the API stores
it. Safe to re-run: replaces the account's existing data rather than
duplicating it. Every value here is fabricated — the identity uses the reserved
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
from app.services.prompt_sections import render_sections

logger = logging.getLogger(__name__)

USERNAME = "alex"
EMAIL = "alex@example.com"
# Intentionally weak and public — this account is a local demo fixture, never
# a credential. The `SEED_DEMO_USER` opt-in in `main()` guards against it ever
# being created on a deployed instance.
PASSWORD = "test1234"

# Explicit opt-in required to run the script; see the module docstring.
_OPT_IN_ENV_VAR = "SEED_DEMO_USER"

# The demo account points at this provider, deliberately without a key.
_DEMO_PROVIDER = PROVIDERS["openai"]

_STYLE_GUIDE = """Write for a smart reader who is busy, not for a search engine.

- Short paragraphs, two to four sentences. One idea per paragraph.
- Prefer concrete nouns and verbs over adjectives. "Exports a 40-page report in two seconds" \
beats "blazing fast".
- No superlatives we can't prove: no "revolutionary", "game-changing", "seamless".
- Say "you" to the reader and "we" for the company. Never "users".
- Explain any term a non-specialist wouldn't know the first time it appears, in plain words.
- Use numbers when we have them and say where they come from. If we don't have one, don't imply it.
- Don't open with a rhetorical question, "Imagine…" or "In today's fast-paced world".
- Quote customers only if the quote appears in the key points. Never invent quotes or names.
- If a key point is vague, write around it honestly and list it under "Needs detail" afterwards.
- End with what the reader can do now, in one sentence, with no exclamation mark."""

_TRANSCRIPT_TASK = (
    "Summarise for someone who missed the meeting. Separate what was decided from what was "
    "only discussed. List action items with an owner and a date when the transcript mentions "
    'one; otherwise write "no owner". Do not attribute opinions to people unless the '
    "transcript names them."
)


def _sections(*pairs: tuple[str, str]) -> list[dict]:
    return [{"name": name, "content": content} for name, content in pairs]


def _hints(**descriptions: str) -> dict:
    return {name: {"type": "text", "description": text} for name, text in descriptions.items()}


# Each prompt: its current sections, plus earlier states (oldest first) that
# become its version history. `days_ago` is when it was last edited.
_PROMPTS: list[dict] = [
    {
        "name": "Weekly status update",
        "folder": "Work",
        "is_favorite": True,
        "days_ago": 2,
        "sections": _sections(
            ("Role", "You are a concise engineering lead writing for busy stakeholders who skim."),
            ("Context", "Team: {{team}}\nWeek: {{week}}\n\nRaw notes from the week:\n{{notes}}"),
            (
                "Task",
                (
                    "Turn the notes into a status update. Lead with what shipped, then what is at "
                    "risk and why, then what we need from others. Drop anything routine."
                ),
            ),
            (
                "Format",
                (
                    "Three short sections with plain headings: Shipped, At risk, Asks. At most five "
                    "bullets per section. No intro sentence and no sign-off."
                ),
            ),
        ),
        "hints": _hints(
            team="Team or project name",
            week="For example 6-10 Oct",
            notes="Paste standup notes, PR titles or chat snippets",
        ),
        "history": [
            (
                "",
                _sections(
                    ("Role", "You are an engineering lead writing a weekly update."),
                    ("Context", "Team: {{team}}\nWeek: {{week}}\n\nRaw notes:\n{{notes}}"),
                    ("Task", "Turn the notes into a status update."),
                ),
            ),
            (
                "Added the Asks section",
                _sections(
                    (
                        "Role",
                        "You are a concise engineering lead writing for busy stakeholders who skim.",
                    ),
                    (
                        "Context",
                        "Team: {{team}}\nWeek: {{week}}\n\nRaw notes from the week:\n{{notes}}",
                    ),
                    (
                        "Task",
                        (
                            "Turn the notes into a status update. Lead with what shipped, then what "
                            "is at risk and why, then what we need from others."
                        ),
                    ),
                    ("Format", "Three short sections with plain headings: Shipped, At risk, Asks."),
                ),
            ),
        ],
    },
    {
        "name": "Reply to a tricky email",
        "folder": "Writing",
        "is_favorite": True,
        "days_ago": 0,
        "sections": _sections(
            (
                "Role",
                (
                    "You help me write emails that are warm but firm. You never grovel and never "
                    "sound passive-aggressive."
                ),
            ),
            ("Email", "{{email}}"),
            ("Goal", "What I want from this reply: {{goal}}"),
            (
                "Constraints",
                (
                    "Keep it under 150 words. Match the formality of the original email. If the "
                    "email asks something my goal does not cover, flag it after the draft instead "
                    "of inventing an answer."
                ),
            ),
            (
                "Output",
                (
                    'One draft reply, then a line starting with "Check:" listing anything I should '
                    "confirm before sending."
                ),
            ),
        ),
        "hints": _hints(
            email="Paste the full email you received",
            goal="For example: decline politely, move the deadline to Friday",
        ),
        "history": [],
    },
    {
        "name": "Meeting transcript summary",
        "folder": "Work",
        "is_favorite": True,
        "days_ago": 1,
        "sections": _sections(
            ("Role", "You turn messy meeting transcripts into decisions and next steps."),
            ("Transcript", "{{transcript}}"),
            ("Task", _TRANSCRIPT_TASK),
            (
                "Format",
                "Decisions, Open questions, Action items as a checklist. Under 250 words in total.",
            ),
        ),
        "hints": _hints(transcript="Paste the transcript or your notes. Long is fine."),
        "history": [
            (
                "",
                _sections(
                    ("Role", "You summarise meeting transcripts."),
                    ("Transcript", "{{transcript}}"),
                    ("Task", "Summarise the meeting and list action items."),
                ),
            ),
        ],
    },
    {
        "name": "Explain it like a patient tutor",
        "folder": "Learning",
        "is_favorite": False,
        "days_ago": 5,
        "sections": _sections(
            ("Role", "You are a patient tutor who checks understanding instead of lecturing."),
            ("Topic", "{{topic}}"),
            ("Background", "What I already know: {{background}}"),
            (
                "Method",
                (
                    "Explain in small steps. After each step, ask me one short question to check I "
                    "followed, and wait for my answer before continuing. Use one concrete everyday "
                    "example per idea. Avoid jargon unless you define it first."
                ),
            ),
        ),
        "hints": _hints(topic="What you want to understand"),
        "history": [],
    },
    {
        "name": "Product launch blog post",
        "folder": "Writing",
        "is_favorite": False,
        "days_ago": 9,
        "sections": _sections(
            ("Role", "You are a product marketer who writes like a person, not a press release."),
            (
                "Product",
                "Product: {{product_name}}\nWhat it does: {{one_liner}}\nWho it is for: {{audience}}",
            ),
            ("Key points", "{{key_points}}"),
            ("Style guide", _STYLE_GUIDE),
            (
                "Structure",
                (
                    "1. A first paragraph that names the problem in the reader's words.\n"
                    "2. What is new, shown through one specific scenario.\n"
                    "3. How it works, in at most three short paragraphs.\n"
                    "4. Availability and pricing: {{availability}}\n"
                    '5. One sentence on what comes next. No "stay tuned".'
                ),
            ),
            (
                "Output format",
                (
                    "Markdown. Title under 60 characters. 600-800 words. Give two alternative "
                    "titles at the end."
                ),
            ),
        ),
        "hints": _hints(
            one_liner="One sentence, no adjectives",
            key_points="Bullets from the launch brief",
            availability="Date, plans, regions",
        ),
        "history": [
            (
                "",
                _sections(
                    ("Role", "You are a product marketer."),
                    ("Product", "Product: {{product_name}}\nWhat it does: {{one_liner}}"),
                    ("Key points", "{{key_points}}"),
                    ("Output format", "Markdown, 600-800 words."),
                ),
            ),
            (
                "Added the style guide",
                _sections(
                    (
                        "Role",
                        "You are a product marketer who writes like a person, not a press release.",
                    ),
                    ("Product", "Product: {{product_name}}\nWhat it does: {{one_liner}}"),
                    ("Key points", "{{key_points}}"),
                    ("Style guide", _STYLE_GUIDE),
                    ("Output format", "Markdown, 600-800 words."),
                ),
            ),
        ],
    },
    {
        "name": "Pull request review",
        "folder": "Work",
        "is_favorite": False,
        "days_ago": 14,
        "sections": _sections(
            (
                "Role",
                "You are a senior reviewer who cares about correctness first, then readability.",
            ),
            ("Language", "{{language}}"),
            ("Diff", "{{diff}}"),
            (
                "Focus",
                (
                    "Point out bugs, missing error handling, and anything that will be hard to change "
                    "later. Skip style nits a formatter would catch. If something is fine, do not "
                    "mention it."
                ),
            ),
            (
                "Format",
                (
                    "Findings, most important first. For each: file and line, what is wrong, and a "
                    "suggested fix as a short code block."
                ),
            ),
        ),
        "hints": _hints(diff="Paste the diff or the changed files"),
        "history": [],
    },
    {
        "name": "Weekly meal plan",
        "folder": "Personal",
        "is_favorite": False,
        "days_ago": 6,
        "sections": _sections(
            ("Role", "You are a practical home cook planning for a busy week."),
            (
                "Needs",
                (
                    "Diet: {{diet}}\nPeople: {{people}}\nBudget for the week: {{budget}}\n"
                    "Already in the fridge: {{leftovers}}"
                ),
            ),
            (
                "Task",
                (
                    "Plan five dinners that reuse ingredients so little goes to waste. At least two "
                    "should take under 30 minutes."
                ),
            ),
            (
                "Format",
                (
                    "A table with day, dish and prep time, then one combined shopping list grouped by "
                    "supermarket aisle."
                ),
            ),
        ),
        "hints": _hints(diet="For example vegetarian, no nuts", leftovers="Optional"),
        "history": [],
    },
    {
        "name": "Trip itinerary",
        "folder": "Personal",
        "is_favorite": False,
        "days_ago": 33,
        "sections": _sections(
            (
                "Context",
                "Destination: {{destination}}\nDates: {{dates}}\nWho is going: {{travellers}}",
            ),
            (
                "Preferences",
                (
                    "We like walking, local food, and at most one museum a day. We do not like early "
                    "starts or tourist-trap restaurants."
                ),
            ),
            (
                "Task",
                (
                    "Draft a day-by-day plan with a morning, afternoon and evening idea. Note travel "
                    "time between places and anything that needs booking ahead."
                ),
            ),
        ),
        "hints": {},
        "history": [],
    },
    {
        "name": "Behavioural interview practice",
        "folder": "Learning",
        "is_favorite": False,
        "days_ago": 18,
        "sections": _sections(
            (
                "Role",
                "You are interviewing me for a {{role}} position at a company like {{company}}.",
            ),
            (
                "Task",
                (
                    "Ask one behavioural question at a time. After I answer, give feedback on "
                    "structure (situation, task, action, result), specificity and length, then ask "
                    "the next question. Stop after five questions and name my strongest and weakest "
                    "answer."
                ),
            ),
        ),
        "hints": _hints(role="Job title", company="Company name or type"),
        "history": [],
    },
    {
        "name": "LinkedIn post from notes",
        "folder": None,
        "is_favorite": False,
        "days_ago": 3,
        "sections": _sections(
            ("Task", "Turn my notes into a LinkedIn post:\n{{notes}}"),
            (
                "Style",
                (
                    'First person. No hashtags, no emojis, no "I\'m thrilled to announce". Short '
                    "paragraphs. End with a question only if it is a real one."
                ),
            ),
        ),
        "hints": {},
        "history": [],
    },
    {
        # What migration 024 makes of an old History entry.
        "name": "Untitled (14 Mar 2026, 09:12 UTC)",
        "folder": "Recovered history",
        "is_favorite": False,
        "days_ago": 210,
        "sections": _sections(
            (
                "task",
                (
                    "Write a short birthday message for my sister, who just moved to Lisbon. Mention "
                    "the tram she keeps complaining about."
                ),
            ),
            ("tone", "Warm, a bit teasing."),
        ),
        "hints": {},
        "history": [],
    },
]


def _delete_existing(db: Session, user: User) -> None:
    """FK-safe cleanup before reseeding.

    Older versions of this seed also created Playground runs, which databases
    from before migration 020 hold without `ON DELETE CASCADE`, so they are
    deleted explicitly before the user row — deleting the user then cascades
    `prompts` -> `prompt_versions` via the existing ORM relationships.
    """
    prompt_ids = [pid for (pid,) in db.query(Prompt.id).filter(Prompt.user_id == user.id).all()]
    if prompt_ids:
        db.query(PlaygroundRun).filter(PlaygroundRun.prompt_id.in_(prompt_ids)).delete(
            synchronize_session=False
        )
    db.delete(user)
    db.commit()


def seed_alex(db: Session) -> User:
    """Create (or replace) the `alex` demo account and its sample library.

    Returns:
        The created User.
    """
    existing = db.query(User).filter(User.username == USERNAME).first()
    if existing is not None:
        _delete_existing(db, existing)

    now = datetime.now(UTC)
    user = User(
        username=USERNAME,
        hashed_password=get_password_hash(PASSWORD),
        email=EMAIL,
        # Pointed at OpenAI but deliberately without a key: provider
        # credentials are bring-your-own, so Import text shows how to connect
        # one until the operator adds theirs (or configures a server default).
        llm_provider=_DEMO_PROVIDER.handle,
        llm_base_url=_DEMO_PROVIDER.default_base_url,
        llm_model=next(iter(_DEMO_PROVIDER.models)),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    for spec in _PROMPTS:
        edited_at = now - timedelta(days=spec["days_ago"], hours=1)
        history = spec["history"]
        prompt = Prompt(
            id=PromptIdService.next_id(db),
            user_id=user.id,
            name=spec["name"],
            fields=spec["sections"],
            generated_prompt=render_sections(spec["sections"]),
            folder=spec["folder"],
            is_favorite=spec["is_favorite"],
            variable_metadata=spec["hints"] or None,
            created_at=edited_at - timedelta(days=7 * len(history)),
            updated_at=edited_at,
        )
        db.add(prompt)
        db.flush()
        # Each version is the state before an edit, so the oldest comes first;
        # its note describes the change that followed it.
        for number, (note, sections) in enumerate(history, start=1):
            db.add(
                PromptVersion(
                    prompt_id=prompt.id,
                    version_number=number,
                    note=note or None,
                    author_user_id=user.id,
                    fields=sections,
                    generated_prompt=render_sections(sections),
                    created_at=edited_at - timedelta(days=7 * (len(history) - number + 1)),
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
