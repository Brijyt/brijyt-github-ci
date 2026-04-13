import { describe, expect, it } from "vitest";
import {
  collectUniqueTickets,
  extractBriTicketIdsFromText,
  extractCompareRangeFromReleaseBody,
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
