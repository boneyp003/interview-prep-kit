import { test } from "node:test";
import assert from "node:assert/strict";
import { categoriesForRequirement, planQuestionGeneration } from "./question-plan.js";
import type { HiringProcess } from "./hiring-process.js";
import type { Requirement } from "../schema/kit.js";

const noHiring: HiringProcess = {
  found: false,
  stages: [],
  formats: [],
  themes: [],
  summary: "",
  sources: [],
};

const req = (over: Partial<Requirement>): Requirement => ({
  id: "r1",
  text: "5 years with React",
  kind: "technical",
  priority: "must",
  ...over,
});

test("technical and behavioural requirements route to different categories", () => {
  const tech = categoriesForRequirement(req({ kind: "technical", text: "5 years React" }), noHiring);
  const behav = categoriesForRequirement(
    req({ kind: "behavioural", text: "mentor junior engineers" }),
    noHiring,
  );
  assert.deepEqual(tech, ["technical"]);
  assert.deepEqual(behav, ["behavioural"]);
});

test("system-design is added when the hiring process uses it", () => {
  const hiring: HiringProcess = { ...noHiring, found: true, formats: ["system-design"] };
  const cats = categoriesForRequirement(req({ kind: "technical" }), hiring);
  assert.ok(cats.includes("system-design"));
});

test("system-design is added from the requirement text alone", () => {
  const cats = categoriesForRequirement(
    req({ kind: "technical", text: "design scalable distributed systems" }),
    noHiring,
  );
  assert.ok(cats.includes("system-design"));
});

test("must-haves are always planned even past the budget", () => {
  const requirements: Requirement[] = [
    ...Array.from({ length: 20 }, (_, i) => req({ id: `r${i + 1}`, priority: "nice" })),
    req({ id: "r99", priority: "must", text: "critical skill" }),
  ];
  const plans = planQuestionGeneration(requirements, noHiring, { firstPassBudget: 4 });
  const plannedReqIds = new Set(plans.flatMap((p) => p.items.map((i) => i.requirementId)));
  assert.ok(plannedReqIds.has("r99"));
});

test("must-have items get a higher difficulty ceiling than nice-to-haves", () => {
  const plans = planQuestionGeneration([req({ id: "r1", priority: "must" }), req({ id: "r2", priority: "nice" })], noHiring);
  const items = plans.flatMap((p) => p.items);
  assert.equal(items.find((i) => i.requirementId === "r1")?.difficultyCeiling, 3);
  assert.equal(items.find((i) => i.requirementId === "r2")?.difficultyCeiling, 2);
});
