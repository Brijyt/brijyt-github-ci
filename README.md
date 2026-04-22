# brijyt-github-ci

Shared reusable GitHub Actions workflows and the **scaleway-secrets** composite action for brijyt-*-web and brijyt-*-api projects.

This repo also contains **Node scripts** under `scripts/` (Linear release milestone + post-deploy status) and a root `package.json` used by those workflows (`npm ci` in CI).

## Contents

- **Reusable workflows** (`.github/workflows/`): call from project repos with `uses: brijyt/brijyt-github-ci/.github/workflows/<name>.yml@<ref>`.
- **Composite action** (`actions/scaleway-secrets/`): used internally by `deploy-scaleway.yml` to fetch and substitute secrets from Scaleway Secret Manager.

## Workflows

| Workflow | Inputs | Outputs | Secrets |
|----------|--------|---------|---------|
| [deploy-scaleway](.github/workflows/deploy-scaleway.yml) | environment, image-ref, scw-project-id, scw-container-id?, deploy-map? | - | SCW_SECRET_KEY |
| [node-test](.github/workflows/node-test.yml) | node-version?, cache? | - | - |
| [node-build-push-docker](.github/workflows/node-build-push-docker.yml) | registry, image-name?, build-args?, app-name? | image-ref | scw-secret-key |
| [python-test](.github/workflows/python-test.yml) | python-version?, requirements-file?, test-path?, upload-pacts? | artifact-name | - |
| [python-build-push-docker](.github/workflows/python-build-push-docker.yml) | registry, image-name?, free-disk-space? | image-ref | scw-secret-key |
| [scala-test](.github/workflows/scala-test.yml) | - | artifact-name | PACT_BROKER_PASSWORD (vars: PACT_BROKER_*) |
| [scala-build-docker](.github/workflows/scala-build-docker.yml) | registry, image-name? | artifact-name, local-image | - |
| [push-docker-image](.github/workflows/push-docker-image.yml) | registry, image-name?, artifact-name | image-ref | scw-secret-key |
| [release-tag-name](.github/workflows/release-tag-name.yml) | bump-file, version-source (`node-package-json` or `plain-semver-file`, string), emit-tag-from-ref? | tag | - |
| [pact-publish](.github/workflows/pact-publish.yml) | artifact-name, pacts-source (pacts-dir \| target-dir) | - | PACT_BROKER_PASSWORD (vars: PACT_BROKER_*) |
| [pr-validation-scala](.github/workflows/pr-validation-scala.yml) | java-version? | - | - |
| [linear-release-milestone](.github/workflows/linear-release-milestone.yml) | tag-name | - | linear-api-key |
| [linear-mark-deployed](.github/workflows/linear-mark-deployed.yml) | tag-name | - | linear-api-key |
| [verify-deploy](.github/workflows/verify-deploy.yml) | health-slugs-json?, health-urls-json? | verified-dev, verified-staging, verified-prod | - |
| [notify-deploy](.github/workflows/notify-deploy.yml) | verified-dev?, verified-staging?, verified-prod? | - | slack-bot-token |
| [notify-failure](.github/workflows/notify-failure.yml) | needs-json (optional, pass caller `toJSON(needs)`) | - | slack-bot-token |

**Linear workflows:** they check out this repository to run `scripts/linear-release-milestone.mjs` or `scripts/linear-mark-deployed.mjs` with `@linear/sdk`. Pass **`linear-api-key`** (typically `${{ secrets.LINEAR_API_KEY }}`). `GITHUB_REPOSITORY` and `GITHUB_TOKEN` (release milestone only) come from the **caller** workflow. The Linear project name is derived from the repo name (`brijyt-chat-web` → `chat-web`). For `actions/checkout` of this repo from another workflow, **`brijyt-github-ci` must be public** (or the caller must otherwise have read access); the caller’s default `GITHUB_TOKEN` only has access to the caller repository.

**Post-deploy workflows:** `verify-deploy` polls `https://{app}-{env}.brijyt.ai/health` (repos whose name ends with `-web`) or `https://{app}-{env}.brijyt.io/health` (repos ending with `-api`) until JSON **`testedSha`** strictly equals the workflow `github.sha`. Optional **`health-slugs-json`**: JSON array of slugs; for each active env, checks every `https://{slug}-api-{env}.{domain}/health` (same domain rule as default). Optional **`health-urls-json`**: explicit per-env URL lists (ignored when `health-slugs-json` is set). **Python** (`python-build-push-docker`): `testedSha` ← `APP_TESTED_SHA` (`github.sha`); `buildNumber` ← `APP_BUILD_NUMBER` (PR head on PR builds, otherwise `github.sha`). **Node** (`brijyt-chat-web`, `scripts/generate-health-assets.mjs`): `testedSha` ← `BUILD_TESTED_SHA`, `buildNumber` ← `BUILD_SOURCE_SHA` (set to `github.sha` in `node-build-push-docker`). Docker uses different arg names (`APP_*` vs `BUILD_*`), but on a normal **push** workflow **`buildNumber`** is the deployed app commit—the same SHA you see at `HEAD` in the repo for both API and web. Values differ mainly on **`pull_request`** workflows (merge ref vs PR head). `notify-deploy` and `notify-failure` use `slackapi/slack-github-action` to post to `#ci-cd`. Both resolve the Linear ticket from the branch name, commit message, or PR title automatically. The caller is responsible for `needs`/`if` conditions (especially `notify-failure`, which must list all upstream jobs).

**`notify-failure` details:** pass **`needs-json: ${{ toJSON(needs) }}`** from the caller job so Slack always lists **caller** jobs whose `result` is `failure` (works without the Actions API). The workflow still tries the GitHub API when possible (`permissions: actions: read` on the **caller** workflow) to add nested job names, failed steps, and job links. Log bodies are never in the API—open the run or job link for full logs.

**Tag-first Main CI (typical app repos):** the caller workflow runs on **`pull_request`** to `main` and on **`push` of tags `v*`** only (not on `push` to `main`), so merges to `main` do not duplicate **Release Please** with a full build.

**`deploy-scaleway` when:** **dev** on `push` to `main`, `feature/*`, or `fix/*`, and on `pull_request` when the PR head is **not** `release-please--*`. **Staging** on those branch pushes, on **`push` tag `v*`**, and on `pull_request` when the head branch starts with **`release-please--`** (release PR preview). **prod** on **`push` tag `v*`** only (plus matching **`workflow_dispatch`**). Callers that still use `push` to `main` keep the old branch-push behaviour for dev/staging until they migrate triggers.

**`verify-deploy`:** verifies **dev** on branch pushes and on non–release-please PRs; **staging** on branch pushes, on release-please PRs, on tag `v*`, and on `workflow_dispatch` staging; **prod** on tag `v*` and `workflow_dispatch` prod (not on `push` to `main` alone).

**`release-tag-name`:** set **`emit-tag-from-ref: true`** when the caller only runs this job on a **`v*` tag** push so the tag string is taken from `github.ref_name` without a `HEAD^` diff.

For the build/push workflows (node-build-push-docker, python-build-push-docker, scala-build-docker, push-docker-image), **image-name** is optional. When omitted, the image name is derived from the repository name (without the `brijyt-` prefix), e.g. `brijyt-agentic-reply-api` → `agentic-reply-api`. Pass **image-name** to override (e.g. `brijyt-docs` using `image-name: likec4-doc`).

## Versioning

- **Single ref for all:** use `@main` or a repo-wide tag (e.g. `@v1`).
- **Per-workflow versions:** use a tag per workflow, e.g. `deploy-scaleway-v1.0`, `node-test-v1.0`. When only one workflow changes, create a new tag for that workflow; callers can pin each job to a different ref.

Example with per-workflow tags:

```yaml
jobs:
  tests:
    uses: brijyt/brijyt-github-ci/.github/workflows/node-test.yml@node-test-v1.0
  build_push:
    uses: brijyt/brijyt-github-ci/.github/workflows/node-build-push-docker.yml@node-build-v1.0
  deploy-dev:
    uses: brijyt/brijyt-github-ci/.github/workflows/deploy-scaleway.yml@deploy-scaleway-v1.0
```

## Example: Web project main workflow

```yaml
jobs:
  tests:
    uses: brijyt/brijyt-github-ci/.github/workflows/node-test.yml@main
  build_push:
    needs: tests
    uses: brijyt/brijyt-github-ci/.github/workflows/node-build-push-docker.yml@main
    with:
      registry: ${{ vars.REGISTRY }}
    secrets:
      scw-secret-key: ${{ secrets.SCW_SECRET_KEY }}
  deploy-dev:
    needs: build_push
    uses: brijyt/brijyt-github-ci/.github/workflows/deploy-scaleway.yml@main
    with:
      environment: dev
      image-ref: ${{ needs.build_push.outputs.image-ref }}
      scw-project-id: ${{ vars.SCW_PROJECT_ID_DEV }}
      scw-container-id: ${{ vars.SCW_CONTAINER_ID_DEV }}
    secrets: inherit
```

## Action: scaleway-secrets

Located at `actions/scaleway-secrets/`. Used by `deploy-scaleway.yml` to substitute `${VAR}` placeholders in deploy config files with values from Scaleway Secret Manager. Not intended to be referenced directly by project repos; use the deploy workflow instead.

## Migration from brijyt/scaleway-secrets-action

Projects that previously used `brijyt/scaleway-secrets-action@v1` in their deploy workflow should switch to this repo's reusable workflow `deploy-scaleway.yml`, which uses the in-repo scaleway-secrets action. The standalone repo `brijyt/scaleway-secrets-action` can be deprecated or archived after migration.
