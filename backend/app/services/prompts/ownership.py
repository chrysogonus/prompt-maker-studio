"""Account-scoped prompt lookup shared by all transports."""

from sqlalchemy.orm import Session

from app.models.prompt import Prompt
from app.services.errors import OperationError


def get_owned_prompt(prompt_id: int, user_id: int, db: Session) -> Prompt:
    """Return 404 for missing and foreign prompts to preserve account privacy."""
    prompt = db.query(Prompt).filter(Prompt.id == prompt_id, Prompt.user_id == user_id).first()
    if not prompt:
        raise OperationError(status_code=404, detail="Prompt not found")
    return prompt
