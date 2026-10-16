# Cross-application contracts

[`section-rendering.json`](section-rendering.json) is the shared fixture for
[`render_sections`](../backend/app/services/prompt_sections.py) and
[`renderSections`](../frontend/src/lib/sections.ts). It fixes tag normalization,
blank-line separators, empty sections and literal content (including markup and
variables) for the server and live preview.

The fixture is consumed by
[`test_prompt_sections.py`](../backend/tests/test_prompt_sections.py) and
[`sections.test.ts`](../frontend/src/lib/__tests__/sections.test.ts). When the
rendering contract changes, update both implementations and this fixture, then
run both suites. It is a rendering contract, not the API validation contract:
for example, an empty list renders as empty text, while new prompt creation
requires at least one section.
