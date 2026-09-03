import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { setupTestEnv, teardownTestEnv, clearDb } from "./test-support.js";

let app: Express;

before(async () => {
  const config = await setupTestEnv();
  app = createApp(config);
});
after(teardownTestEnv);
beforeEach(clearDb);

async function register(agent: request.Agent, email = "a@example.com") {
  return agent.post("/auth/register").send({ email, password: "password123" });
}

test("register sets a session cookie and /auth/me returns the user", async () => {
  const agent = request.agent(app);
  const res = await register(agent);
  assert.equal(res.status, 201);
  assert.ok(res.headers["set-cookie"]);

  const me = await agent.get("/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "a@example.com");
});

test("protected routes reject anonymous and invalid sessions", async () => {
  const anon = await request(app).get("/kits");
  assert.equal(anon.status, 401);

  const bad = await request(app).get("/kits").set("Cookie", "ipk_session=not-a-real-token");
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, "SESSION_INVALID");
});

test("duplicate registration is a 409", async () => {
  const agent = request.agent(app);
  await register(agent);
  const again = await request(app).post("/auth/register").send({ email: "a@example.com", password: "password123" });
  assert.equal(again.status, 409);
});

test("login rejects a wrong password without revealing which field was wrong", async () => {
  await register(request.agent(app));
  const res = await request(app).post("/auth/login").send({ email: "a@example.com", password: "wrongpass1" });
  assert.equal(res.status, 401);
  assert.match(res.body.error.message, /Incorrect email or password/);
});

test("a user sees only their own kits", async () => {
  const alice = request.agent(app);
  await register(alice, "alice@example.com");
  const created = await alice.post("/kits").send({ jd: "Engineer needed", companyUrl: "https://acme.example/", days: 3 });
  assert.equal(created.status, 201);
  const kitId = created.body.kit.id;

  const bob = request.agent(app);
  await register(bob, "bob@example.com");
  const bobList = await bob.get("/kits");
  assert.equal(bobList.body.kits.length, 0);

  const bobGet = await bob.get(`/kits/${kitId}`);
  assert.equal(bobGet.status, 404);

  const aliceGet = await alice.get(`/kits/${kitId}`);
  assert.equal(aliceGet.status, 200);
});

test("submitting the same JD + company twice returns the existing kit", async () => {
  const agent = request.agent(app);
  await register(agent);
  const body = { jd: "Senior Engineer\n\nTypeScript.", companyUrl: "https://acme.example/", days: 5 };

  const first = await agent.post("/kits").send(body);
  const second = await agent.post("/kits").send({ ...body, companyUrl: "https://acme.example" });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.deduped, true);
  assert.equal(second.body.kit.id, first.body.kit.id);

  const list = await agent.get("/kits");
  assert.equal(list.body.kits.length, 1);
});

test("invalid create payloads are rejected with field-level detail", async () => {
  const agent = request.agent(app);
  await register(agent);
  const res = await agent.post("/kits").send({ jd: "", companyUrl: "not-a-url", days: 900 });
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.error.details.issues));
});

test("the generated kit becomes readable and carries its builder overlay", async () => {
  const agent = request.agent(app);
  await register(agent);
  const created = await agent.post("/kits").send({ jd: "Engineer", companyUrl: "https://acme.example/", days: 3 });
  const got = await agent.get(`/kits/${created.body.kit.id}`);
  assert.equal(got.body.kit.status, "ready");
  assert.equal(got.body.kit.kit.questions.length, 2);
  assert.equal(got.body.kit.itemState.q1.origin, "generated");
});

test("logout clears the session", async () => {
  const agent = request.agent(app);
  await register(agent);
  await agent.post("/auth/logout").expect(204);
  const me = await agent.get("/auth/me");
  assert.equal(me.status, 401);
});
