/**
 * Reference registries for the source material a framework is examined against.
 *
 * The thirty BABOK v3 tasks below were extracted from the guide itself
 * (scripts/extract-babok.mjs) rather than typed from memory. The registry is
 * the quality gate for the question bank: every question cites a section here,
 * and `npm run seed` refuses to activate a question whose citation does not
 * line up.
 */
export interface FrameworkTask {
  name: string;
  /** Domain code the task belongs to within its framework. */
  domain: string;
}

export const BABOK_TASKS: Record<string, FrameworkTask> = {
  "3.1": { name: "Plan Business Analysis Approach", domain: "BAPM" },
  "3.2": { name: "Plan Stakeholder Engagement", domain: "BAPM" },
  "3.3": { name: "Plan Business Analysis Governance", domain: "BAPM" },
  "3.4": { name: "Plan Business Analysis Information Management", domain: "BAPM" },
  "3.5": { name: "Identify Business Analysis Performance Improvements", domain: "BAPM" },

  "4.1": { name: "Prepare for Elicitation", domain: "EC" },
  "4.2": { name: "Conduct Elicitation", domain: "EC" },
  "4.3": { name: "Confirm Elicitation Results", domain: "EC" },
  "4.4": { name: "Communicate Business Analysis Information", domain: "EC" },
  "4.5": { name: "Manage Stakeholder Collaboration", domain: "EC" },

  "5.1": { name: "Trace Requirements", domain: "RLCM" },
  "5.2": { name: "Maintain Requirements", domain: "RLCM" },
  "5.3": { name: "Prioritize Requirements", domain: "RLCM" },
  "5.4": { name: "Assess Requirements Changes", domain: "RLCM" },
  "5.5": { name: "Approve Requirements", domain: "RLCM" },

  "6.1": { name: "Analyze Current State", domain: "SA" },
  "6.2": { name: "Define Future State", domain: "SA" },
  "6.3": { name: "Assess Risks", domain: "SA" },
  "6.4": { name: "Define Change Strategy", domain: "SA" },

  "7.1": { name: "Specify and Model Requirements", domain: "RADD" },
  "7.2": { name: "Verify Requirements", domain: "RADD" },
  "7.3": { name: "Validate Requirements", domain: "RADD" },
  "7.4": { name: "Define Requirements Architecture", domain: "RADD" },
  "7.5": { name: "Define Design Options", domain: "RADD" },
  "7.6": { name: "Analyze Potential Value and Recommend Solution", domain: "RADD" },

  "8.1": { name: "Measure Solution Performance", domain: "SE" },
  "8.2": { name: "Analyze Performance Measures", domain: "SE" },
  "8.3": { name: "Assess Solution Limitations", domain: "SE" },
  "8.4": { name: "Assess Enterprise Limitations", domain: "SE" },
  "8.5": { name: "Recommend Actions to Increase Solution Value", domain: "SE" },
};

/**
 * Registries keyed by framework code. A framework with no registry is not
 * validated: ECBA's Business Analysis Standard has no equivalent numbered task
 * list, so its questions carry a section reference that cannot be machine
 * checked. Adding a registry here is what switches the gate on for a framework.
 */
export const FRAMEWORK_TASKS: Record<string, Record<string, FrameworkTask>> = {
  "babok-v3": BABOK_TASKS,
};

/**
 * Check one question's citation. Returns null when it is sound, or a message
 * explaining what is wrong.
 *
 * Subsection references ("7.1.3") are accepted and resolved to their parent
 * task, since questions often point at a specific element within a task.
 */
export function checkReference(
  frameworkCode: string,
  ref: string,
  taskName: string,
  domain: string,
): string | null {
  const registry = FRAMEWORK_TASKS[frameworkCode];
  if (!registry) return null;

  const taskRef = ref.split(".").slice(0, 2).join(".");
  const task = registry[taskRef];

  if (!task) return `Reference ${ref} does not exist in ${frameworkCode}`;

  if (task.name !== taskName) {
    return `${frameworkCode} ${taskRef} is "${task.name}", not "${taskName}"`;
  }

  if (task.domain !== domain) {
    return `${frameworkCode} ${taskRef} belongs to ${task.domain}, but the question is filed under ${domain}`;
  }

  return null;
}
