# Main Branch Protection Guide

This file records the recommended GitHub configuration for `main`. Branch
rules live in GitHub, outside the repository, so this guide is not evidence
that the settings are currently active. Repository administrators must verify
the live rules after changing this document or the CI workflow.

GitHub rulesets are preferred over a new classic branch-protection rule because
they are visible to repository readers, can be staged with an enforcement
status, and compose with other rules. Existing classic protection rules remain
effective and combine with rulesets, so check both places before enabling a
replacement:

- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## Recommended `main` Ruleset

In **Settings → Rules → Rulesets**, create or update a branch ruleset with:

| Setting | Recommendation |
|---|---|
| Name | `Protect main` |
| Enforcement | Active |
| Target | Default branch (`main`) |
| Restrict deletions | Enabled |
| Block force pushes | Enabled |
| Require a pull request before merging | Enabled |
| Required approvals | `0` for the current single-maintainer workflow; raise when an independent reviewer is consistently available |
| Require conversation resolution | Enabled |
| Require status checks | Enabled |
| Required check | `All Quality Gates Passed`, expected from GitHub Actions |
| Require branch to be up to date | Enabled |
| Require linear history | Enabled when using squash or rebase merges |

Do not also require every backend, frontend, Docker matrix, browser, and Compose
check. `All Quality Gates Passed` is the stable aggregate and already fails
unless all quality jobs succeed. GitHub identifies workflow checks by job name,
so if that visible name changes in `.github/workflows/ci.yml`, update the
ruleset:

- [Troubleshooting required checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules#troubleshooting-required-status-checks)

## Reviews, CODEOWNERS, and Bypass

`.github/CODEOWNERS` requests `@chrysogonus` for all changes and calls out
release, CI, infrastructure, and migration paths. Automatic review requests do
not require approval unless the ruleset enables required reviews.

For the current single-maintainer repository, a mandatory approval can
deadlock maintainer-authored pull requests. Keep the required count at zero
unless another reviewer with suitable access is available. When the maintainer
team grows, change it to one approval, dismiss stale approvals after new
commits, and consider requiring code-owner review for sensitive paths.

Avoid broad permanent bypasses. If an emergency bypass is configured, limit it
to the repository administrator role and require a follow-up issue or pull
request documenting:

- why normal CI/PR enforcement could not be used;
- who approved the exception;
- what repair or verification remains.

## Verification

After applying or changing the rules:

1. Open **Settings → Rules** and confirm all active rulesets and classic
   protection rules targeting `main`; overlapping rules use the most
   restrictive combination.
2. Open a test pull request against `main`.
3. Confirm direct merge is blocked while `All Quality Gates Passed` is pending
   or failing.
4. Confirm the check becomes successful only after backend, frontend, Docker,
   browser, and Compose jobs pass.
5. Confirm force-push and branch-deletion restrictions behave as documented.
6. Record any intentional differences in this file.

Required checks must have run recently before GitHub offers them for selection.
If the aggregate name is unavailable, run the CI workflow on a pull request,
then edit the ruleset again.

## Workflow Changes Checklist

When editing `.github/workflows/ci.yml`:

- keep the aggregate check name `All Quality Gates Passed` stable;
- add every new mandatory quality job to `all-checks-passed.needs` and its
  result validation;
- ensure pull requests trigger the workflow;
- update [`CI_PIPELINE.md`](CI_PIPELINE.md) when jobs, triggers, artifacts, or
  publishing behavior change;
- re-test branch protection if any required check is renamed or removed.
