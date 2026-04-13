#!/usr/bin/env node
/**
 * After prod deploy verification, set all issues on the release's Linear project milestone
 * to the workflow state "Deployed & Done".
 *
 * Env: LINEAR_API_KEY, GITHUB_REPOSITORY (owner/repo), TAG_NAME (e.g. v1.5.2)
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { LinearClient } from "@linear/sdk";
import { findLinearProjectIdByName, linearProjectNameFromGithubRepo } from "./linear-release-milestone-lib.mjs";

const DEPLOYED_DONE_STATE = "Deployed & Done";

/**
 * @param {LinearClient} client
 * @param {string | undefined} teamId
 * @param {Map<string, string | null>} cache teamId -> stateId or null if missing
 */
async function resolveDeployedDoneStateId(client, teamId, cache) {
  if (!teamId) {
    return null;
  }
  if (cache.has(teamId)) {
    return cache.get(teamId) ?? null;
  }
  const conn = await client.workflowStates({
    first: 20,
    filter: {
      name: { eqIgnoreCase: DEPLOYED_DONE_STATE },
      team: { id: { eq: teamId } },
    },
  });
  const id = conn.nodes[0]?.id;
  if (!id) {
    console.warn(
      `::warning::No workflow state "${DEPLOYED_DONE_STATE}" for team ${teamId} (check Linear team workflow)`,
    );
    cache.set(teamId, null);
    return null;
  }
  cache.set(teamId, id);
  return id;
}

async function main() {
  const linearApiKey = process.env.LINEAR_API_KEY;
  const tagName = process.env.TAG_NAME;
  const githubRepository = process.env.GITHUB_REPOSITORY;

  if (!linearApiKey) {
    console.error("LINEAR_API_KEY is required");
    process.exit(1);
  }
  if (!tagName) {
    console.error("TAG_NAME is required");
    process.exit(1);
  }
  if (!githubRepository?.includes("/")) {
    console.error("GITHUB_REPOSITORY must be owner/repo");
    process.exit(1);
  }

  const projectName = linearProjectNameFromGithubRepo(githubRepository);
  const client = new LinearClient({ apiKey: linearApiKey });
  const projectId = await findLinearProjectIdByName(client, projectName);
  console.log(`Resolved project '${projectName}' -> ${projectId}`);

  const project = await client.project(projectId);
  const milestonesConn = await project.projectMilestones({
    first: 20,
    filter: {
      name: { eq: tagName },
      project: { id: { eq: projectId } },
    },
  });
  const milestone =
    milestonesConn.nodes.find((m) => m.name === tagName) ?? milestonesConn.nodes[0];
  if (!milestone) {
    console.error(`No project milestone named "${tagName}" on project ${projectName}`);
    process.exit(1);
  }
  console.log(`Using milestone "${milestone.name}" (${milestone.id})`);

  let issuesConn = await milestone.issues({ first: 100 });
  while (issuesConn.pageInfo?.hasNextPage) {
    await issuesConn.fetchNext();
  }
  const issues = [...issuesConn.nodes];
  if (issues.length === 0) {
    console.log("No issues linked to this milestone");
    return;
  }
  console.log(`Updating ${issues.length} issue(s) to "${DEPLOYED_DONE_STATE}"`);

  /** @type {Map<string, string | null>} */
  const stateByTeam = new Map();

  for (const issue of issues) {
    const teamId = issue.teamId;
    const stateId = await resolveDeployedDoneStateId(client, teamId, stateByTeam);
    if (!stateId) {
      console.warn(`::warning::Skip ${issue.identifier ?? issue.id}: no target state for team`);
      continue;
    }
    if (issue.stateId === stateId) {
      console.log(`${issue.identifier ?? issue.id}: already in "${DEPLOYED_DONE_STATE}"`);
      continue;
    }
    const payload = await client.updateIssue(issue.id, { stateId });
    const ok = payload.success === true;
    console.log(`${issue.identifier ?? issue.id} -> ${DEPLOYED_DONE_STATE}: ${ok}`);
    if (!ok) {
      console.warn(`::warning::Linear issueUpdate failed for ${issue.identifier ?? issue.id}`);
      console.warn({ success: payload.success, issueId: payload.issueId });
    }
  }
}

const entry = process.argv[1];
if (entry) {
  const thisFile = fileURLToPath(import.meta.url);
  if (path.resolve(entry) === path.resolve(thisFile)) {
    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
