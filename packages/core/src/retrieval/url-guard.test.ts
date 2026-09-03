import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeUrl, isPrivateAddress } from "./url-guard.js";

test("classifies private and public addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "169.254.1.1", "172.16.5.5", "::1", "fd00::1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1::"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("rejects non-http schemes and credentialed URLs", async () => {
  await assert.rejects(() => assertSafeUrl("ftp://example.com", { blockPrivate: true }), /scheme/);
  await assert.rejects(() => assertSafeUrl("file:///etc/passwd", { blockPrivate: true }));
  await assert.rejects(
    () => assertSafeUrl("http://user:pass@example.com", { blockPrivate: true }),
    /Credentials/,
  );
});

test("blocks hostnames that resolve to private IPs", async () => {
  await assert.rejects(
    () =>
      assertSafeUrl("http://sneaky.internal.example", {
        blockPrivate: true,
        resolve: async () => ["10.0.0.5"],
      }),
    /private address/,
  );
});

test("allows a public hostname", async () => {
  const safe = await assertSafeUrl("https://example.com/careers", {
    blockPrivate: true,
    resolve: async () => ["93.184.216.34"],
  });
  assert.equal(safe.url.pathname, "/careers");
});

test("localhost passes only when blockPrivate is off", async () => {
  await assert.rejects(() => assertSafeUrl("http://localhost:8099/acme/", { blockPrivate: true }));
  const safe = await assertSafeUrl("http://localhost:8099/acme/", { blockPrivate: false });
  assert.equal(safe.url.port, "8099");
});
