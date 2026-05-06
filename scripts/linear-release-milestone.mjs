#!/usr/bin/env node
/**
 * After a GitHub release, create a Linear project milestone (tag name) and attach BRI-* issues.
 * Env: LINEAR_API_KEY, GITHUB_REPOSITORY (owner/repo), TAG_NAME, GITHUB_TOKEN
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { LinearClient } from "@linear/sdk";
import {
  collectUniqueTickets,
  extractCompareRangeFromReleaseBody,
  findLinearProjectIdByName,
  findOrCreateProjectMilestone,
  isLikelyIssueUuid,
  linearProjectNameFromGithubRepo,
  parseTeamKeyAndNumber,
} from "./linear-release-milestone-lib.mjs";

const GITHUB_API = "https://api.github.com";

/**
 * @param {string} token
 * @param {string} pathWithQuery e.g. repos/o/r/releases/tags/v1
 */
async function githubGetJson(token, pathWithQuery) {
  const url = `${GITHUB_API}/${pathWithQuery}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText}: ${url}\n${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub response was not JSON: ${url}`);
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} basehead e.g. v1.5.1...v1.5.2
 * @param {string} token
 * @returns {Promise<string>} newline-separated commit messages
 */
async function fetchCompareCommitMessages(owner, repo, basehead, token) {
  const enc = encodeURIComponent(basehead);
  const data = await githubGetJson(token, `repos/${owner}/${repo}/compare/${enc}`);
  const commits = data.commits ?? [];
  const messages = commits.map((c) => c.commit?.message ?? "").filter(Boolean);
  return messages.join("\n");
}

/**
 * @param {LinearClient} client
 * @param {string} ticket BRI-44 or UUID
 */
async function resolveIssueUuid(client, ticket) {
  if (isLikelyIssueUuid(ticket)) {
    return ticket;
  }
  const parsed = parseTeamKeyAndNumber(ticket);
  if (!parsed) {
    console.warn(`::warning::Ticket ${ticket} is not BRI-NUM or UUID; using as-is for updateIssue`);
    return ticket;
  }
  const connection = await client.issues({
    first: 1,
    filter: {
      team: { key: { eq: parsed.teamKey } },
      number: { eq: parsed.number },
    },
  });
  const id = connection.nodes[0]?.id;
  if (!id) {
    console.warn(`::warning::Could not resolve Linear issue ${ticket} to UUID`);
    return ticket;
  }
  return id;
}

async function main() {
  const linearApiKey = process.env.LINEAR_API_KEY;
  const tagName = process.env.TAG_NAME;
  const githubRepository = process.env.GITHUB_REPOSITORY;
  const githubToken = process.env.GITHUB_TOKEN;

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
  if (!githubToken) {
    console.error("GITHUB_TOKEN is required");
    process.exit(1);
  }

  const [owner, repo] = githubRepository.split("/");
  const projectName = linearProjectNameFromGithubRepo(githubRepository);
  const encTag = encodeURIComponent(tagName);

  const release = await githubGetJson(githubToken, `repos/${owner}/${repo}/releases/tags/${encTag}`);
  const releaseBody = release.body ?? "";
  const releasePublishedAt = release.published_at;
  let releaseTargetDate;
  if (typeof releasePublishedAt === "string" && releasePublishedAt.trim().length > 0) {
    const parsedPublishedAt = new Date(releasePublishedAt);
    if (!Number.isNaN(parsedPublishedAt.getTime())) {
      releaseTargetDate = parsedPublishedAt.toISOString().slice(0, 10);
      console.log(`Release ${tagName} target date: ${releaseTargetDate}`);
    } else {
      console.warn(`::warning::Invalid release published_at for ${tagName}: ${releasePublishedAt}`);
    }
  } else {
    console.warn(`::warning::Missing release published_at for ${tagName}; milestone target date will not be set`);
  }
  console.log(`Release ${tagName} body size: ${releaseBody.length} bytes`);

  const compareRange = extractCompareRangeFromReleaseBody(releaseBody);
  let commitMessages = "";
  if (compareRange) {
    console.log(`Collecting Linear IDs from GitHub compare range: ${compareRange}`);
    try {
      commitMessages = await fetchCompareCommitMessages(owner, repo, compareRange, githubToken);
    } catch (e) {
      console.warn(`::warning::GitHub compare API failed for ${compareRange}; skipping commit scan`);
      console.warn(e);
    }
  } else {
    console.log("No compare/ range in release body; skipping GitHub compare scan");
  }

  const tickets = collectUniqueTickets(releaseBody, commitMessages);
  if (tickets.length === 0) {
    console.log("No Linear tickets found in release body or compared commits");
  } else {
    console.log(`Tickets to assign: ${tickets.join(",")}`);
  }

  const client = new LinearClient({ apiKey: linearApiKey });
  const projectId = await findLinearProjectIdByName(client, projectName);
  console.log(`Resolved project '${projectName}' -> ${projectId}`);

  const milestoneId = await findOrCreateProjectMilestone(
    client,
    projectId,
    tagName,
    releaseBody,
    releaseTargetDate,
  );

  for (const ticket of tickets) {
    const issueId = await resolveIssueUuid(client, ticket);
    const updatePayload = await client.updateIssue(issueId, {
      projectId,
      projectMilestoneId: milestoneId,
    });
    const ok = updatePayload.success === true;
    console.log(`Assign ${ticket} (${issueId}) -> project + milestone: ${ok}`);
    if (!ok) {
      console.warn(`::warning::Linear issueUpdate failed for ${ticket}`);
      console.warn({ success: updatePayload.success, issueId: updatePayload.issueId });
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
