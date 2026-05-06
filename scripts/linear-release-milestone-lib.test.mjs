import { describe, expect, it } from "vitest";
import {
  collectUniqueTickets,
  extractBriTicketIdsFromText,
  extractCompareRangeFromReleaseBody,
  findOrCreateProjectMilestone,
  findMilestoneIdByExactName,
  isLikelyIssueUuid,
  linearProjectNameFromGithubRepo,
  parseTeamKeyAndNumber,
} from "./linear-release-milestone-lib.mjs";

describe("linearProjectNameFromGithubRepo", () => {
  it("strips brijyt- prefix from repo name", () => {
    expect(linearProjectNameFromGithubRepo("Brijyt/brijyt-chat-web")).toBe("chat-web");
  });

  it("leaves name unchanged without brijyt- prefix", () => {
    expect(linearProjectNameFromGithubRepo("acme/widget")).toBe("widget");
  });
});

describe("extractBriTicketIdsFromText", () => {
  it("finds BRI ids and dedupes", () => {
    expect(extractBriTicketIdsFromText("fix #12 and BRI-44\nsee BRI-44")).toEqual(["BRI-44"]);
  });

  it("returns empty when none", () => {
    expect(extractBriTicketIdsFromText("only #12")).toEqual([]);
  });
});

describe("extractCompareRangeFromReleaseBody", () => {
  it("parses first compare segment", () => {
    const body = "See [diff](https://github.com/o/r/compare/v1.5.1...v1.5.2) for changes.";
    expect(extractCompareRangeFromReleaseBody(body)).toBe("v1.5.1...v1.5.2");
  });

  it("returns empty when missing", () => {
    expect(extractCompareRangeFromReleaseBody("no link")).toBe("");
  });
});

describe("collectUniqueTickets", () => {
  it("merges body and commits and sorts unique", () => {
    const body = "BRI-1\ncompare/x...y";
    const commits = "feat: BRI-2\nfix: BRI-1";
    expect(collectUniqueTickets(body, commits)).toEqual(["BRI-1", "BRI-2"]);
  });
});

describe("parseTeamKeyAndNumber", () => {
  it("parses TEAM-NUM", () => {
    expect(parseTeamKeyAndNumber("BRI-44")).toEqual({ teamKey: "BRI", number: 44 });
  });

  it("returns null for invalid", () => {
    expect(parseTeamKeyAndNumber("nope")).toBeNull();
  });
});

describe("isLikelyIssueUuid", () => {
  it("detects uuid v4 shape", () => {
    expect(isLikelyIssueUuid("d8d0c6f1-d695-47b8-9957-17b08aa4c5b9")).toBe(true);
  });

  it("rejects ticket id", () => {
    expect(isLikelyIssueUuid("BRI-44")).toBe(false);
  });
});

describe("findMilestoneIdByExactName", () => {
  it("returns id when name matches", () => {
    const nodes = [
      { id: "m1", name: "v1.16.0" },
      { id: "m2", name: "v1.17.0" },
    ];
    expect(findMilestoneIdByExactName(nodes, "v1.17.0")).toBe("m2");
  });

  it("returns empty string when no match", () => {
    expect(findMilestoneIdByExactName([{ id: "m1", name: "v1.16.0" }], "v9.0.0")).toBe("");
  });
});

describe("findOrCreateProjectMilestone", () => {
  it("passes description and targetDate when present on create", async () => {
    let capturedPayload;
    const createProjectMilestone = async (payload) => {
      capturedPayload = payload;
      return { success: true, projectMilestoneId: "created-with-description-and-date" };
    };
    const projectMilestones = async () => ({ nodes: [] });
    const project = async () => ({ projectMilestones });
    const client = { project, createProjectMilestone, updateProjectMilestone: async () => ({ success: true }) };

    const milestoneId = await findOrCreateProjectMilestone(
      client,
      "project-1",
      "v1.2.3",
      "Release notes",
      "2026-05-06",
    );

    expect(milestoneId).toBe("created-with-description-and-date");
    expect(capturedPayload).toEqual({
      projectId: "project-1",
      name: "v1.2.3",
      description: "Release notes",
      targetDate: "2026-05-06",
    });
  });

  it("updates targetDate when milestone already exists", async () => {
    const createProjectMilestone = async () => {
      throw new Error("createProjectMilestone should not be called");
    };
    let updateArgs;
    const updateProjectMilestone = async (id, input) => {
      updateArgs = { id, input };
      return { success: true };
    };
    const projectMilestones = async () => ({
      nodes: [{ id: "milestone-1", name: "v1.2.5", targetDate: "2026-05-01" }],
    });
    const project = async () => ({ projectMilestones });
    const client = { project, createProjectMilestone, updateProjectMilestone };

    const milestoneId = await findOrCreateProjectMilestone(
      client,
      "project-3",
      "v1.2.5",
      "Release notes",
      "2026-05-06",
    );

    expect(milestoneId).toBe("milestone-1");
    expect(updateArgs).toEqual({
      id: "milestone-1",
      input: { targetDate: "2026-05-06" },
    });
  });

  it("does not pass description or targetDate when values are empty/invalid", async () => {
    let capturedPayload;
    const createProjectMilestone = async (payload) => {
      capturedPayload = payload;
      return { success: true, projectMilestoneId: "created-without-description" };
    };
    const projectMilestones = async () => ({ nodes: [] });
    const project = async () => ({ projectMilestones });
    const client = { project, createProjectMilestone, updateProjectMilestone: async () => ({ success: true }) };

    const milestoneId = await findOrCreateProjectMilestone(
      client,
      "project-2",
      "v1.2.4",
      "   ",
      "2026/05/06",
    );

    expect(milestoneId).toBe("created-without-description");
    expect(capturedPayload).toEqual({
      projectId: "project-2",
      name: "v1.2.4",
    });
  });
});
