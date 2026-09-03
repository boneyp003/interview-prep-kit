import { test } from "node:test";
import assert from "node:assert/strict";
import { rankLinks } from "./link-ranking.js";
import type { PageLink } from "./clean.js";

const base = "https://acme.example/";

function links(...pairs: [string, string][]): PageLink[] {
  return pairs.map(([url, anchor]) => ({ url: new URL(url, base).toString(), anchor }));
}

test("ranks a hiring page above a generic marketing page", () => {
  const ranked = rankLinks(
    links(
      ["/careers/how-we-hire", "How we hire"],
      ["/about", "About us"],
      ["/pricing", "Pricing"],
      ["/blog/2024/redesign", "Our new look"],
    ),
    base,
  );
  assert.equal(ranked[0]?.url, "https://acme.example/careers/how-we-hire");
  assert.equal(ranked[0]?.intent, "hiring");
  assert.ok(!ranked.some((l) => l.url.includes("/pricing")));
});

test("does not hard-code a path — an unexpected handbook URL still scores", () => {
  const ranked = rankLinks(links(["/handbook/people-group/interviewing", "Interviewing"]), base);
  assert.equal(ranked[0]?.intent, "hiring");
});

test("drops login/legal/asset links", () => {
  const ranked = rankLinks(
    links(
      ["/login", "Sign in"],
      ["/legal/privacy", "Privacy"],
      ["/media/brand.pdf", "Brand kit careers"],
    ),
    base,
  );
  assert.equal(ranked.length, 0);
});

test("downranks offsite links", () => {
  const ranked = rankLinks(
    links(
      ["https://boards.greenhouse.io/acme", "Careers"],
      ["/careers", "Careers"],
    ),
    base,
  );
  assert.equal(ranked[0]?.url, "https://acme.example/careers");
});
