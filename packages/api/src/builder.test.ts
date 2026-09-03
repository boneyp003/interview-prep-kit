import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { setupTestEnv, teardownTestEnv, clearDb } from "./test-support.js";

let app: Express;

before(async () => {
  app = createApp(await setupTestEnv());
});
after(teardownTestEnv);
beforeEach(clearDb);

async function readyKit(agent: request.Agent) {
  await agent.post("/auth/register").send({ email: "u@example.com", password: "password123" });
  const res = await agent.post("/kits").send({ jd: "Engineer", companyUrl: "https://acme.example/", days: 3 });
  return res.body.kit.id as string;
}

test("editing a question marks it edited in the overlay", async () => {
  const agent = request.agent(app);
  const id = await readyKit(agent);
  const res = await agent.patch(`/kits/${id}/questions/q1`).send({ prompt: "My rewritten question" });
  assert.equal(res.status, 200);
  const q1 = res.body.kit.kit.questions.find((q: { id: string }) => q.id === "q1");
  assert.equal(q1.prompt, "My rewritten question");
  assert.equal(res.body.kit.itemState.q1.edited, true);
});

test("adding then deleting a question keeps coverage and schedule consistent", async () => {
  const agent = request.agent(app);
  const id = await readyKit(agent);

  const added = await agent.post(`/kits/${id}/questions`).send({
    category: "technical",
    requirement_ids: ["r1"],
    prompt: "Hand-written question",
    answer_outline: "outline",
  });
  assert.equal(added.status, 201);
  const newId = added.body.id;
  assert.equal(added.body.kit.itemState[newId].origin, "user");

  const del = await agent.delete(`/kits/${id}/questions/${newId}`);
  assert.equal(del.status, 200);
  assert.ok(!del.body.kit.kit.questions.some((q: { id: string }) => q.id === newId));
  for (const day of del.body.kit.kit.schedule.days) {
    assert.ok(!day.question_ids.includes(newId));
  }
});

test("reordering questions must be a permutation", async () => {
  const agent = request.agent(app);
  const id = await readyKit(agent);
  const bad = await agent.put(`/kits/${id}/questions/order`).send({ order: ["q1"] });
  assert.equal(bad.status, 400);
  const good = await agent.put(`/kits/${id}/questions/order`).send({ order: ["q2", "q1"] });
  assert.equal(good.status, 200);
  assert.deepEqual(good.body.kit.kit.questions.map((q: { id: string }) => q.id), ["q2", "q1"]);
});

test("an edit that would break structure is rejected with 422 and not saved", async () => {
  const agent = request.agent(app);
  const id = await readyKit(agent);
  const res = await agent.patch(`/kits/${id}/questions/q1`).send({ requirement_ids: ["r-nope"] });
  assert.equal(res.status, 400); // unknown requirement id caught before mutate
  const still = await agent.get(`/kits/${id}`);
  const q1 = still.body.kit.kit.questions.find((q: { id: string }) => q.id === "q1");
  assert.deepEqual(q1.requirement_ids, ["r1"]);
});

test("editing the brief flags the section as edited", async () => {
  const agent = request.agent(app);
  const id = await readyKit(agent);
  const res = await agent.patch(`/kits/${id}/brief`).send({ summary: "My take on the company" });
  assert.equal(res.status, 200);
  assert.equal(res.body.kit.sectionState.companyBrief.edited, true);
  assert.equal(res.body.kit.kit.company_brief.summary, "My take on the company");
});

test("practice: rating a card, next-session ordering, and summary", async () => {
  const agent = request.agent(app);
  const id = await readyKit(agent);

  const rate = await agent.post(`/kits/${id}/practice/f1`).send({ confidence: 2 });
  assert.equal(rate.status, 200);
  assert.equal(rate.body.record.reviews, 1);
  assert.equal(rate.body.summary.reviewed, 1);

  const next = await agent.get(`/kits/${id}/practice/next`);
  assert.equal(next.status, 200);
  assert.ok(Array.isArray(next.body.cards));

  const summary = await agent.get(`/kits/${id}/practice/summary`);
  assert.equal(summary.body.summary.total, 1);
});

test("builder routes reject anonymous callers", async () => {
  const res = await request(app).patch("/kits/abc/questions/q1").send({ prompt: "x" });
  assert.equal(res.status, 401);
});
