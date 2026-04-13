import { LinearClient } from "@linear/sdk";

/**
 * @param {LinearClient} client
 * @param {string} projectName Linear project name (e.g. chat-web)
 * @returns {Promise<string>} project UUID
 */
export async function findLinearProjectIdByName(client, projectName) {
  const connection = await client.projects({
    first: 10,
    filter: { name: { eqIgnoreCase: projectName } },
  });
  const first = connection.nodes[0];
  if (!first?.id) {
    throw new Error(`Linear project not found for name (eqIgnoreCase): ${projectName}`);
  }
  return first.id;
}

/** @param {string} githubRepository "owner/repo" */
export function linearProjectNameFromGithubRepo(githubRepository) {
  const short = githubRepository.split("/").pop() ?? "";
  return short.startsWith("brijyt-") ? short.slice("brijyt-".length) : short;
}

const BRI_ID_RE = /BRI-\d+/g;

/** @param {string} text */
export function extractBriTicketIdsFromText(text) {
  const matches = text.match(BRI_ID_RE);
  if (!matches?.length) return [];
  return [...new Set(matches)];
}

/** First compare/... segment from release notes (same as prior bash). */
export function extractCompareRangeFromReleaseBody(body) {
  const m = body.match(/compare\/([^)\s]+)/);
  return m?.[1]?.trim() ?? "";
}

/**
 * @param {string} releaseBody
 * @param {string} commitMessagesJoined messages from compare commits, newline-separated
 */
export function collectUniqueTickets(releaseBody, commitMessagesJoined) {
  const fromBody = extractBriTicketIdsFromText(releaseBody);
  const fromCommits = extractBriTicketIdsFromText(commitMessagesJoined ?? "");
  return [...new Set([...fromBody, ...fromCommits])].sort();
}

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** @param {string} ticket */
export function parseTeamKeyAndNumber(ticket) {
  const m = ticket.match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!m) return null;
  return { teamKey: m[1], number: Number.parseInt(m[2], 10) };
}

/** @param {string} ticket */
export function isLikelyIssueUuid(ticket) {
  return UUID_RE.test(ticket);
}
