#!/usr/bin/env python3
"""Verify THIRD_PARTY_NOTICES.md matches what the built images actually ship.

CI previously checked only that the file existed and that Sharp was absent, and
the file had already drifted: `lucide-react`, a direct production dependency,
was missing from the frontend inventory entirely. A notice file that claims to
be the shipped inventory is an attribution document, so "it exists" is not the
property worth gating on.

Reads the images rather than the lockfiles, because the frontend table describes
the result of `npm ci --omit=dev --omit=optional` as it exists in the image —
which is what is redistributed.

Usage:
    python scripts/check_third_party_notices.py \
        [--backend-image prompt-maker-studio-backend:test] \
        [--frontend-image prompt-maker-studio-frontend:test]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
NOTICES = REPO_ROOT / "THIRD_PARTY_NOTICES.md"

# Base-image tooling, present in the filesystem but not a dependency this
# project selected or redistributes as part of the application.
BACKEND_IGNORED = {"pip", "setuptools", "wheel"}

_NODE_INVENTORY = r"""
for p in $(find /app/node_modules -maxdepth 3 -name package.json -path "*/node_modules/*"); do
  d=$(dirname "$p")
  case "$d" in */node_modules) continue;; esac
  node -e "const p=require('$p'); if(p.name&&p.version) console.log(p.name+'|'+p.version)" 2>/dev/null
done
"""


def _normalise(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def _run(image: str, script: str) -> str:
    result = subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "sh", image, "-c", script],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print(f"error: could not inspect {image}:\n{result.stderr}", file=sys.stderr)
        raise SystemExit(2)
    return result.stdout


def backend_inventory(image: str) -> dict[str, str]:
    output = _run(image, "pip list --format=json")
    packages = json.loads(output)
    return {
        _normalise(p["name"]): p["version"]
        for p in packages
        if _normalise(p["name"]) not in BACKEND_IGNORED
    }


def frontend_inventory(image: str) -> dict[str, str]:
    output = _run(image, _NODE_INVENTORY)
    inventory: dict[str, str] = {}
    for line in output.splitlines():
        if "|" in line:
            name, version = line.strip().split("|", 1)
            inventory[_normalise(name)] = version
    return inventory


def documented_inventory(section: str) -> dict[str, str]:
    """Package/version rows from one `## ` section of the notices file."""
    text = NOTICES.read_text()
    sections = re.split(r"^## ", text, flags=re.MULTILINE)
    for block in sections:
        if not block.startswith(section):
            continue
        rows = {}
        for line in block.splitlines():
            match = re.match(
                r"\|\s*([@A-Za-z0-9_./\-]+)\s*\|\s*([0-9][^|\s]*)\s*\|", line
            )
            if match:
                rows[_normalise(match.group(1))] = match.group(2)
        return rows
    print(f"error: no '## {section}' section in {NOTICES.name}", file=sys.stderr)
    raise SystemExit(2)


def compare(
    label: str, shipped: dict[str, str], documented: dict[str, str]
) -> list[str]:
    problems = []
    for name in sorted(set(shipped) - set(documented)):
        problems.append(
            f"{label}: {name} {shipped[name]} is in the image but not in the notices"
        )
    for name in sorted(set(documented) - set(shipped)):
        problems.append(f"{label}: {name} is in the notices but not in the image")
    for name in sorted(set(shipped) & set(documented)):
        if shipped[name] != documented[name]:
            problems.append(
                f"{label}: {name} is {shipped[name]} in the image, "
                f"{documented[name]} in the notices"
            )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-image", default="prompt-maker-studio-backend:test")
    parser.add_argument("--frontend-image", default="prompt-maker-studio-frontend:test")
    # CI builds one image per matrix leg, so each can only check its own half.
    parser.add_argument("--only", choices=["backend", "frontend"], default=None)
    args = parser.parse_args()

    problems = []
    if args.only in (None, "backend"):
        problems += compare(
            "backend",
            backend_inventory(args.backend_image),
            documented_inventory("Backend image"),
        )
    if args.only in (None, "frontend"):
        problems += compare(
            "frontend",
            frontend_inventory(args.frontend_image),
            documented_inventory("Frontend image"),
        )

    if problems:
        print(
            "THIRD_PARTY_NOTICES.md does not match the built images:\n", file=sys.stderr
        )
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\nRegenerate the tables from the images — see "
            "'Maintaining this file' in THIRD_PARTY_NOTICES.md.",
            file=sys.stderr,
        )
        return 1

    scope = f"the {args.only} image" if args.only else "both images"
    print(f"✅ THIRD_PARTY_NOTICES.md matches {scope}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
