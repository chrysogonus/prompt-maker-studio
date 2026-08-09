"""
Service for snapshotting and restoring prompt version history.
"""

from sqlalchemy.orm import Session

from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion


class PromptVersionService:
    """Snapshots a prompt's state before it changes, and restores prior snapshots."""

    @staticmethod
    def current_version_number(db: Session, prompt_id: int) -> int:
        """Return the latest historical snapshot number, or 0 if there is none."""
        last_version = (
            db.query(PromptVersion)
            .filter(PromptVersion.prompt_id == prompt_id)
            .order_by(PromptVersion.version_number.desc())
            .first()
        )
        return last_version.version_number if last_version else 0

    @staticmethod
    def live_version_number(db: Session, prompt_id: int) -> int:
        """Return the version number of the live prompt state.

        Version rows capture the state *before* an update. The live row is
        therefore always one version newer than the latest snapshot. Treating
        the latest snapshot as current made eval runs claim they used content
        they did not actually execute.
        """
        return PromptVersionService.current_version_number(db, prompt_id) + 1

    @staticmethod
    def snapshot(
        db: Session, prompt: Prompt, author_user_id: int, note: str | None = None
    ) -> PromptVersion:
        """
        Record the prompt's CURRENT (pre-update) state as a new version.

        Args:
            db: Database session
            prompt: The prompt whose current state should be preserved
            author_user_id: User making the edit that supersedes this snapshot
            note: Optional free-text note describing the change

        Returns:
            The newly created version row (not yet committed — caller commits)
        """
        next_version_number = PromptVersionService.current_version_number(db, prompt.id) + 1

        version = PromptVersion(
            prompt_id=prompt.id,
            version_number=next_version_number,
            note=note,
            author_user_id=author_user_id,
            fields=prompt.fields,
            generated_prompt=prompt.generated_prompt,
        )
        db.add(version)
        return version

    @staticmethod
    def restore(db: Session, prompt: Prompt, version: PromptVersion, author_user_id: int) -> None:
        """
        Restore `prompt` to the state captured in `version`, after snapshotting
        the state being replaced so it isn't lost.
        """
        PromptVersionService.snapshot(
            db,
            prompt,
            author_user_id,
            note=f"Restore to v{version.version_number}",
        )
        prompt.fields = version.fields
        prompt.generated_prompt = version.generated_prompt
