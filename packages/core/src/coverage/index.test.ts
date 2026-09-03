import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoverage, planGapFill } from "./index.js";
import type { Question, Requirement } from "../schema/kit.js";
import type { HiringProcess } from "../generation/hiring-process.js";

const noHiring: HiringProcess = {
  found: false,
  stages: [],
  formats: [],
  themes: [],
  summary: "",
  sources: [],
};

const reqs: Requirement[] = [
  { id: "r1", text: "React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentoring", kind: "behavioural", priority: "nice" },
  { id: "r3", text: "GraphQL", kind: "technical", priority: "must" },
];

const q = (id: string, requirement_ids: string[]): Question => ({
  id,
  requirement_ids,
  category: "technical",
  prompt: "?",
  answer_outline: "...",
  difficulty: 2,
});

test("identifies uncovered requirements and flags the must-haves", () => {
  const report = checkCoverage(reqs, [q("q1", ["r1"])]);
  assert.deepEqual(report.uncoveredRequirementIds, ["r2", "r3"]);
  assert.deepEqual(report.uncoveredMustIds, ["r3"]);
  assert.equal(report.countsByRequirement.r1, 1);
});

test("a requirement covered by a multi-requirement question is not a gap", () => {
  const report = checkCoverage(reqs, [q("q1", ["r1", "r3"])]);
  assert.deepEqual(report.uncoveredRequirementIds, ["r2"]);
  assert.deepEqual(report.uncoveredMustIds, []);
});

test("full coverage yields no gaps", () => {
  const report = checkCoverage(reqs, [q("q1", ["r1"]), q("q2", ["r2"]), q("q3", ["r3"])]);
  assert.equal(report.uncoveredRequirementIds.length, 0);
});

test("planGapFill picks a category and asks for more on must-haves", () => {
  const tasks = planGapFill([reqs[2]!], noHiring);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.category, "technical");
  assert.equal(tasks[0]!.item.targetCount, 2);
  assert.equal(tasks[0]!.item.difficultyFloor, 2);
});
