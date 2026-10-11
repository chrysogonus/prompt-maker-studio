"""Owned evaluation cases and atomic CSV import/export."""

import csv
from io import StringIO

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.eval_case import EvalCase
from app.schemas.evaluation import (
    MAX_EVAL_CASES_PER_PROMPT,
    EvalCaseCreateRequest,
    EvalCaseUpdateRequest,
)
from app.services.errors import OperationError
from app.services.prompts.ownership import get_owned_prompt

_CSV_REQUIRED_HEADERS = ("method", "criteria")
_CSV_INTENTIONALLY_EMPTY_HEADER = "intentionally_empty"


def _get_owned_case(prompt_id: int, case_id: int, user_id: int, db: Session):
    get_owned_prompt(prompt_id, user_id, db)
    case = (
        db.query(EvalCase).filter(EvalCase.id == case_id, EvalCase.prompt_id == prompt_id).first()
    )
    if not case:
        raise OperationError(status_code=404, detail="Eval case not found")
    return case


def list_eval_cases(prompt_id: int, db: Session, user_id: int):
    """List an owned prompt's eval cases, in display order."""
    get_owned_prompt(prompt_id, user_id, db)
    return (
        db.query(EvalCase).filter(EvalCase.prompt_id == prompt_id).order_by(EvalCase.position).all()
    )


def export_eval_cases(prompt_id: int, db: Session, user_id: int):
    """Export an owned prompt's eval set as CSV."""
    prompt = get_owned_prompt(prompt_id, user_id, db)
    cases = (
        db.query(EvalCase).filter(EvalCase.prompt_id == prompt.id).order_by(EvalCase.position).all()
    )
    variable_names = sorted({name for case in cases for name in (case.variables or {})})
    output = StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=[
            *_CSV_REQUIRED_HEADERS,
            "name",
            _CSV_INTENTIONALLY_EMPTY_HEADER,
            *variable_names,
        ],
    )
    writer.writeheader()
    for case in cases:
        writer.writerow(
            {
                "method": case.method,
                "criteria": case.criteria or "",
                "name": case.name or "",
                _CSV_INTENTIONALLY_EMPTY_HEADER: "true" if case.intentionally_empty else "false",
                **{name: (case.variables or {}).get(name, "") for name in variable_names},
            }
        )
    return output.getvalue()


def import_eval_cases(prompt_id: int, body: bytes, db: Session, user_id: int):
    """Validate and atomically append CSV rows to an owned prompt's eval set."""
    prompt = get_owned_prompt(prompt_id, user_id, db)
    try:
        csv_text = body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise OperationError(status_code=422, detail="CSV must be UTF-8 encoded") from exc

    try:
        reader = csv.DictReader(StringIO(csv_text, newline=""), strict=True)
        headers = reader.fieldnames
        if not headers:
            raise OperationError(status_code=422, detail="CSV header row is required")
        normalized_headers = [header.strip() for header in headers]
        if any(not header for header in normalized_headers) or len(set(normalized_headers)) != len(
            normalized_headers
        ):
            raise OperationError(status_code=422, detail="CSV headers must be unique and non-empty")
        if normalized_headers[:2] != list(_CSV_REQUIRED_HEADERS):
            raise OperationError(
                status_code=422, detail="CSV must begin with method,criteria columns"
            )

        metadata_headers = {
            header
            for header in ("name", _CSV_INTENTIONALLY_EMPTY_HEADER)
            if header in normalized_headers[2:]
        }
        variable_names = [
            header for header in normalized_headers[2:] if header not in metadata_headers
        ]
        parsed: list[EvalCaseCreateRequest] = []
        for row_number, raw_row in enumerate(reader, start=2):
            if None in raw_row:
                raise OperationError(status_code=422, detail=f"Row {row_number}: too many columns")
            values = {(key or "").strip(): (value or "") for key, value in raw_row.items()}
            if not any(value.strip() for value in values.values()):
                continue
            try:
                intentionally_empty_value = values.get(_CSV_INTENTIONALLY_EMPTY_HEADER, "false")
                if intentionally_empty_value.strip().lower() not in {"", "false", "true"}:
                    raise OperationError(
                        status_code=422,
                        detail=f"Row {row_number}: intentionally_empty must be true or false",
                    )
                parsed.append(
                    EvalCaseCreateRequest(
                        method=values["method"].strip().lower(),
                        name=values.get("name") or None,
                        criteria=values["criteria"] or None,
                        variables={name: values[name] for name in variable_names},
                        intentionally_empty=intentionally_empty_value.strip().lower() == "true",
                    )
                )
            except ValidationError as exc:
                raise OperationError(
                    status_code=422, detail=f"Row {row_number}: {exc.errors()[0]['msg']}"
                ) from exc
    except csv.Error as exc:
        raise OperationError(status_code=422, detail=f"Malformed CSV: {exc}") from exc

    existing_count = db.query(EvalCase).filter(EvalCase.prompt_id == prompt.id).count()
    if existing_count + len(parsed) > MAX_EVAL_CASES_PER_PROMPT:
        raise OperationError(
            status_code=422,
            detail=(
                f"Import would exceed the maximum of {MAX_EVAL_CASES_PER_PROMPT} eval cases "
                f"(currently {existing_count})"
            ),
        )

    imported = [
        EvalCase(
            prompt_id=prompt.id,
            method=item.method,
            name=item.name,
            criteria=item.criteria,
            variables=item.variables,
            intentionally_empty=item.intentionally_empty,
            position=existing_count + index,
        )
        for index, item in enumerate(parsed)
    ]
    db.add_all(imported)
    db.commit()
    for case in imported:
        db.refresh(case)
    return imported


def create_eval_case(prompt_id: int, body: EvalCaseCreateRequest, db: Session, user_id: int):
    """Add a new eval case to an owned prompt, capped at MAX_EVAL_CASES_PER_PROMPT."""
    prompt = get_owned_prompt(prompt_id, user_id, db)

    existing_count = db.query(EvalCase).filter(EvalCase.prompt_id == prompt.id).count()
    if existing_count >= MAX_EVAL_CASES_PER_PROMPT:
        raise OperationError(
            status_code=422,
            detail=f"A prompt can have at most {MAX_EVAL_CASES_PER_PROMPT} eval cases",
        )

    case = EvalCase(
        prompt_id=prompt.id,
        method=body.method,
        name=body.name,
        criteria=body.criteria,
        variables=body.variables,
        intentionally_empty=body.intentionally_empty,
        position=existing_count,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def update_eval_case(
    prompt_id: int, case_id: int, body: EvalCaseUpdateRequest, db: Session, user_id: int
):
    """Partially update an owned eval case."""
    case = _get_owned_case(prompt_id, case_id, user_id, db)

    if body.method is not None:
        case.method = body.method
    if body.name is not None:
        case.name = body.name or None
    if body.criteria is not None:
        case.criteria = body.criteria
    if body.variables is not None:
        case.variables = body.variables
    if body.intentionally_empty is not None:
        case.intentionally_empty = body.intentionally_empty

    db.commit()
    db.refresh(case)
    return case


def delete_eval_case(prompt_id: int, case_id: int, db: Session, user_id: int):
    """Delete an owned eval case."""
    case = _get_owned_case(prompt_id, case_id, user_id, db)
    db.delete(case)
    db.commit()
