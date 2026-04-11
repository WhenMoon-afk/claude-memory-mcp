export interface ContinuityBenchmarkFixture {
  name: string;
  mode: "search" | "bundle";
  query?: string;
  project?: string;
  expectedIds?: string[];
  expectedTypes?: string[];
}

export const fixtures: ContinuityBenchmarkFixture[] = [
  {
    name: "resume_task",
    mode: "search",
    query: "password reset",
    expectedIds: ["snap-2"],
  },
  {
    name: "restore_project_state",
    mode: "bundle",
    project: "notes-api",
    expectedTypes: ["project_state", "snapshot", "decision"],
  },
  {
    name: "recover_decision_trail",
    mode: "search",
    query: "expiration",
    expectedTypes: ["decision"],
  },
];
