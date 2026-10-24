"""Create the spend ledger for AI calls made without an account."""

from sqlalchemy.schema import CreateIndex, CreateTable

from app.models.public_billed_call import PublicBilledCall


def _migration_033_public_billed_calls(connection) -> None:
    table = PublicBilledCall.__table__
    connection.execute(CreateTable(table, if_not_exists=True))
    for index in table.indexes:
        connection.execute(CreateIndex(index, if_not_exists=True))
