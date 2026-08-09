"""Database models package.

Importing this package registers **every** model with SQLAlchemy's declarative
registry. That matters because relationships are declared by class name
(`relationship("BilledCall", ...)`), and those names are resolved lazily, the
first time a mapper is configured. A module that imports only the handful of
models it names directly therefore blows up on the ones it doesn't:

    sqlalchemy.exc.InvalidRequestError: When initializing mapper
    Mapper[User(users)], expression 'BilledCall' failed to locate a name

The API never hit this because its routers transitively import all of them, but
`scripts/seed_demo_user.py` imports four and broke the moment `User` gained a
`billed_calls` relationship. Re-exporting here fixes that for every caller at
once: importing any single model runs this file first, so the registry is always
complete. Add new models to this list.
"""

from app.models.billed_call import BilledCall
from app.models.eval_case import EvalCase
from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt
from app.models.prompt_id_sequence import PromptIdSequence
from app.models.prompt_version import PromptVersion
from app.models.user import User

__all__ = [
    "BilledCall",
    "EvalCase",
    "EvalRun",
    "EvalRunResult",
    "PlaygroundRun",
    "Prompt",
    "PromptIdSequence",
    "PromptVersion",
    "User",
]
