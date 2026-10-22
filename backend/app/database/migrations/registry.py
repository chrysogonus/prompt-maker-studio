"""Historical SQLite migration registry."""

from __future__ import annotations

from collections.abc import Callable

from app.database.migrations.v001_dynamic_prompt_fields import _migration_001_dynamic_prompt_fields
from app.database.migrations.v002_prompt_user_id import _migration_002_prompt_user_id
from app.database.migrations.v003_prompt_name import _migration_003_prompt_name
from app.database.migrations.v004_user_email_reset import _migration_004_user_email_reset
from app.database.migrations.v005_prompt_updated_at import _migration_005_prompt_updated_at
from app.database.migrations.v006_prompt_folder import _migration_006_prompt_folder
from app.database.migrations.v007_prompt_favorite import _migration_007_prompt_favorite
from app.database.migrations.v008_prompt_tags import _migration_008_prompt_tags
from app.database.migrations.v009_prompt_versions import _migration_009_prompt_versions
from app.database.migrations.v010_playground_runs import _migration_010_playground_runs
from app.database.migrations.v011_user_preferences import _migration_011_user_preferences
from app.database.migrations.v012_prompt_variable_metadata import (
    _migration_012_prompt_variable_metadata,
)
from app.database.migrations.v013_user_eval_and_library_preferences import (
    _migration_013_user_eval_and_library_preferences,
)
from app.database.migrations.v014_eval_tables import _migration_014_eval_tables
from app.database.migrations.v015_eval_run_metadata import _migration_015_eval_run_metadata
from app.database.migrations.v016_billed_calls import _migration_016_billed_calls
from app.database.migrations.v017_eval_case_metadata import _migration_017_eval_case_metadata
from app.database.migrations.v018_prompt_id_sequence import _migration_018_prompt_id_sequence
from app.database.migrations.v019_user_llm_connection import _migration_019_user_llm_connection
from app.database.migrations.v020_delete_cascades import _migration_020_delete_cascades
from app.database.migrations.v021_user_token_version import _migration_021_user_token_version
from app.database.migrations.v022_oauth_tables import _migration_022_oauth_tables
from app.database.migrations.v023_recover_drifted_prompt_sections import (
    _migration_023_recover_drifted_prompt_sections,
)
from app.database.migrations.v024_recover_unnamed_prompts import (
    _migration_024_recover_unnamed_prompts,
)
from app.database.migrations.v025_version_notes import _migration_025_version_notes
from app.database.migrations.v026_user_auth_subject import _migration_026_user_auth_subject
from app.database.migrations.v027_oauth_grants import _migration_027_oauth_grants
from app.database.migrations.v028_prompt_content_updated_at import (
    _migration_028_prompt_content_updated_at,
)
from app.database.migrations.v029_user_llm_workspace import _migration_029_user_llm_workspace
from app.database.migrations.v030_eval_human_score import _migration_030_eval_human_score
from app.database.migrations.v031_eval_tested_prompt import _migration_031_eval_tested_prompt
from app.database.migrations.v032_prompt_known_good_version import (
    _migration_032_prompt_known_good_version,
)
from app.database.migrations.v033_public_billed_calls import _migration_033_public_billed_calls

Migration = tuple[str, Callable]

_MIGRATIONS: tuple[Migration, ...] = (
    ("001_dynamic_prompt_fields", _migration_001_dynamic_prompt_fields),
    ("002_prompt_user_id", _migration_002_prompt_user_id),
    ("003_prompt_name", _migration_003_prompt_name),
    ("004_user_email_reset", _migration_004_user_email_reset),
    ("005_prompt_updated_at", _migration_005_prompt_updated_at),
    ("006_prompt_folder", _migration_006_prompt_folder),
    ("007_prompt_favorite", _migration_007_prompt_favorite),
    ("008_prompt_tags", _migration_008_prompt_tags),
    ("009_prompt_versions", _migration_009_prompt_versions),
    ("010_playground_runs", _migration_010_playground_runs),
    ("011_user_preferences", _migration_011_user_preferences),
    ("012_prompt_variable_metadata", _migration_012_prompt_variable_metadata),
    ("013_user_eval_and_library_preferences", _migration_013_user_eval_and_library_preferences),
    ("014_eval_tables", _migration_014_eval_tables),
    ("015_eval_run_metadata", _migration_015_eval_run_metadata),
    ("016_billed_calls", _migration_016_billed_calls),
    ("017_eval_case_metadata", _migration_017_eval_case_metadata),
    ("018_prompt_id_sequence", _migration_018_prompt_id_sequence),
    ("019_user_llm_connection", _migration_019_user_llm_connection),
    ("020_delete_cascades", _migration_020_delete_cascades),
    ("021_user_token_version", _migration_021_user_token_version),
    ("022_oauth_tables", _migration_022_oauth_tables),
    ("023_recover_drifted_prompt_sections", _migration_023_recover_drifted_prompt_sections),
    ("024_recover_unnamed_prompts", _migration_024_recover_unnamed_prompts),
    ("025_version_notes", _migration_025_version_notes),
    ("026_user_auth_subject", _migration_026_user_auth_subject),
    ("027_oauth_grants", _migration_027_oauth_grants),
    ("028_prompt_content_updated_at", _migration_028_prompt_content_updated_at),
    ("029_user_llm_workspace", _migration_029_user_llm_workspace),
    ("030_eval_human_score", _migration_030_eval_human_score),
    ("031_eval_tested_prompt", _migration_031_eval_tested_prompt),
    ("032_prompt_known_good_version", _migration_032_prompt_known_good_version),
    ("033_public_billed_calls", _migration_033_public_billed_calls),
)
