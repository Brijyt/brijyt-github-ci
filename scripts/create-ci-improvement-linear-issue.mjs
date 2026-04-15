#!/usr/bin/env node
/**
 * One-shot: create a Linear issue for CI improvements (shared infra / verify-deploy / release flows).
 * Usage: LINEAR_API_KEY=lin_api_... node scripts/create-ci-improvement-linear-issue.mjs
 */
import process from "node:process";
import { LinearClient } from "@linear/sdk";

const TITLE = "CI: consolidate pipelines (main vs tag, verify-deploy, release-please, Linear milestones)";
const DESCRIPTION = `## Context
- Avoid duplicate **Main CI/CD** runs when a release merges to \`main\` and release-please pushes the same commit tag (\`v*\`).
- Align **verify-deploy** (prod health on \`main\` where applicable).
- **Linear**: reuse milestones when the release tag already exists.

## Suggested follow-ups
- Document trigger strategy (main-only vs tag-only) in team docs.
- Optional: split workflows if tag-only deploy is required without main push.

## Repos touched (when implemented)
- \`brijyt-github-ci\` (verify-deploy, linear-release-milestone)
- App repos: \`main.yml\` (release tag derivation, Linear mark-deployed)`;

async function main() {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("LINEAR_API_KEY is required");
    process.exit(1);
  }

  const client = new LinearClient({ apiKey });
  const teams = await client.teams({ first: 50 });
  const team = teams.nodes.find((t) => t.key === "BRI");
  if (!team?.id) {
    console.error('Team with key "BRI" not found in workspace');
    process.exit(1);
  }

  const payload = await client.createIssue({
    teamId: team.id,
    title: TITLE,
    description: DESCRIPTION,
  });

  const issue = await payload.issue;
  const id = issue?.id;
  const identifier = issue?.identifier;
  if (!payload.success || !id) {
    console.error("createIssue failed", { success: payload.success, id, identifier });
    process.exit(1);
  }

  console.log(`Created ${identifier} (${id})`);
  console.log(`Use in commits: [${identifier}]`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
