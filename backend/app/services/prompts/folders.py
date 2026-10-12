"""Folders operations shared by REST and MCP. Mutations own their commit."""

from sqlalchemy.orm import Session

from app.models.prompt import Prompt
from app.schemas.prompts import FolderChangeResponse, FolderRenameRequest
from app.services.errors import OperationError


def get_prompt_folders(db: Session, user_id: int):
    """Distinct folder labels used across the calling user's prompts."""
    rows = (
        db.query(Prompt.folder)
        .filter(Prompt.user_id == user_id, Prompt.folder.isnot(None))
        .distinct()
        .all()
    )
    return sorted({row[0] for row in rows if row[0]})


def rename_folder(body: FolderRenameRequest, name: str, db: Session, user_id: int):
    """Rename a folder by moving every prompt in it to the new name."""
    moved = (
        db.query(Prompt)
        .filter(Prompt.user_id == user_id, Prompt.folder == name)
        .update({Prompt.folder: body.name}, synchronize_session=False)
    )
    if not moved:
        raise OperationError(status_code=404, detail="Folder not found")
    db.commit()
    return FolderChangeResponse(name=body.name, prompt_count=moved)


def remove_folder(name: str, db: Session, user_id: int):
    """Remove a folder. Its prompts move to Unfiled; none are deleted."""
    moved = (
        db.query(Prompt)
        .filter(Prompt.user_id == user_id, Prompt.folder == name)
        .update({Prompt.folder: None}, synchronize_session=False)
    )
    if not moved:
        raise OperationError(status_code=404, detail="Folder not found")
    db.commit()
    return FolderChangeResponse(name=name, prompt_count=moved)
