#!/usr/bin/env python3
"""Prove Docker excludes secret-prone environment filenames from build context."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_PATHS = (
    ".env",
    ".env.local",
    ".env.production",
    ".env.example",
    "config.env",
    "frontend/.env.local",
    "backend/.env.staging",
    "nested/config.env",
)
INCLUDED_PATHS = ("keep.txt", "nested/keep.txt")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="prompt-maker-docker-context-") as temp:
        temp_root = Path(temp)
        context = temp_root / "context"
        output = temp_root / "output"
        context.mkdir()
        shutil.copy2(REPO_ROOT / ".dockerignore", context / ".dockerignore")
        (context / "Dockerfile").write_text("FROM scratch\nCOPY . /context/\n")

        for relative_path in (*EXCLUDED_PATHS, *INCLUDED_PATHS):
            marker = context / relative_path
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(f"marker for {relative_path}\n")

        subprocess.run(
            [
                "docker",
                "buildx",
                "build",
                "--quiet",
                "--file",
                str(context / "Dockerfile"),
                "--output",
                f"type=local,dest={output}",
                str(context),
            ],
            check=True,
        )

        copied_context = output / "context"
        leaked = [path for path in EXCLUDED_PATHS if (copied_context / path).exists()]
        missing = [
            path for path in INCLUDED_PATHS if not (copied_context / path).is_file()
        ]
        if leaked or missing:
            if leaked:
                print(
                    f"error: environment files reached Docker build context: {', '.join(leaked)}"
                )
            if missing:
                print(
                    f"error: ordinary context files were unexpectedly excluded: {', '.join(missing)}"
                )
            return 1

    print("✅ Docker build context excludes root and nested environment files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
