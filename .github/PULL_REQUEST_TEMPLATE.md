# Pull Request

## What this changes
<!-- What does this do, and why? One or two sentences is fine. -->

## Type of change
<!-- Delete the ones that do not apply. -->

Bug fix · Feature · Breaking change · Docs · Refactor · Tests · Chore · Security fix

## Related issue
<!-- Anything larger than a typo should have one. See CONTRIBUTING.md. -->
Closes #

## How you tested it
<!-- Commands you ran, and anything you checked by hand. -->

## Checklist

- [ ] `make ci-local` passes (or the targeted gates: backend → `make lint-backend && make test`; frontend → `make lint-frontend && make test-frontend`)
- [ ] New backend code has tests — CI enforces 90% coverage
- [ ] No secrets, credentials, or real `.env` values in the diff
- [ ] Docs updated if behavior, endpoints, or configuration changed

<!--
Full expectations — coding standards, branch and commit conventions, what gets a
PR rejected, and the release process — live in CONTRIBUTING.md. Screenshots are
welcome for UI changes. Add deployment or migration notes below if a deployer
needs to do something beyond pulling the new image.
-->
