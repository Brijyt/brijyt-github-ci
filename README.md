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
| [pact-publish](.github/workflows/pact-publish.yml) | artifact-name, pacts-source (pacts-dir \| target-dir) | - | PACT_BROKER_PASSWORD (vars: PACT_BROKER_*) |
| [pr-validation-scala](.github/workflows/pr-validation-scala.yml) | java-version? | - | - |
| [linear-release-milestone](.github/workflows/linear-release-milestone.yml) | tag-name | - | linear-api-key |
| [linear-mark-deployed](.github/workflows/linear-mark-deployed.yml) | tag-name | - | linear-api-key |
| [verify-deploy](.github/workflows/verify-deploy.yml) | - | verified-dev, verified-staging, verified-prod | - |
| [notify-deploy](.github/workflows/notify-deploy.yml) | verified-dev?, verified-staging?, verified-prod? | - | slack-bot-token |
| [notify-failure](.github/workflows/notify-failure.yml) | - | - | slack-bot-token |

**Linear workflows:** they check out this repository to run `scripts/linear-release-milestone.mjs` or `scripts/linear-mark-deployed.mjs` with `@linear/sdk`. Pass **`linear-api-key`** (typically `${{ secrets.LINEAR_API_KEY }}`). `GITHUB_REPOSITORY` and `GITHUB_TOKEN` (release milestone only) come from the **caller** workflow. The Linear project name is derived from the repo name (`brijyt-chat-web` → `chat-web`).

**Post-deploy workflows:** `verify-deploy` polls `https://{app}-{env}.brijyt.ai/health` until the deployed SHA matches `github.sha`. `notify-deploy` and `notify-failure` use `slackapi/slack-github-action` to post to `#ci-cd`. Both resolve the Linear ticket from the branch name, commit message, or PR title automatically. The caller is responsible for `needs`/`if` conditions (especially `notify-failure`, which must list all upstream jobs).

**`notify-failure` details:** the reusable job requests `actions: read` and calls the GitHub API to list jobs in the current run, then Slack includes failed job names, `conclusion`, the first failed step name (when the API exposes it), and a link to the job. The **caller** workflow must include `permissions: actions: read` (alongside `contents: read` or broader) so the token can read run jobs; log bodies are not returned by the API—open the job link for full logs.

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
