import { describe, expect, test } from "vitest";

import { BABOK_TASKS, checkReference } from "./babok";

const BABOK_DOMAINS = ["BAPM", "EC", "RLCM", "SA", "RADD", "SE"];

describe("BABOK_TASKS", () => {
  test("holds all thirty BABOK v3 tasks", () => {
    expect(Object.keys(BABOK_TASKS)).toHaveLength(30);
  });

  test("gives every BABOK knowledge area its tasks", () => {
    for (const domain of BABOK_DOMAINS) {
      const tasks = Object.values(BABOK_TASKS).filter((t) => t.domain === domain);
      expect(tasks.length, domain).toBeGreaterThan(0);
    }
  });
});

describe("checkReference", () => {
  test("accepts a task reference that matches its name and domain", () => {
    expect(checkReference("babok-v3", "7.1", "Specify and Model Requirements", "RADD")).toBeNull();
  });

  test("accepts a subsection of a task", () => {
    expect(checkReference("babok-v3", "7.1.3", "Specify and Model Requirements", "RADD")).toBeNull();
  });

  test("rejects a reference that does not exist in the framework", () => {
    expect(checkReference("babok-v3", "7.9", "Invented Task", "RADD")).toMatch(/7\.9/);
  });

  test("rejects a task name that does not match the reference", () => {
    expect(checkReference("babok-v3", "7.1", "Prioritize Requirements", "RADD")).toMatch(
      /Specify and Model Requirements/,
    );
  });

  test("rejects a reference filed under the wrong domain", () => {
    expect(checkReference("babok-v3", "7.1", "Specify and Model Requirements", "EC")).toMatch(/RADD/);
  });

  test("skips validation for a framework with no task registry", () => {
    // ECBA's Business Analysis Standard has no numbered task list to check against.
    expect(checkReference("ba-standard", "1.2", "Anything", "UBA")).toBeNull();
  });
});
