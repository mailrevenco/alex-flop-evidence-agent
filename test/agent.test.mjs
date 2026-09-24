import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { base58, cleanText, didFromPublicRaw, signRoomMessage } from "../src/identity.mjs";
import { postingEligibility, queuedItemDecision } from "../src/posting-policy.mjs";
import { normalizeRoomWindow } from "../src/technocore.mjs";

test("base58 preserves leading zero bytes", () => {
  assert.equal(base58(Buffer.from([0, 0, 1])), "112");
});

test("generated Ed25519 public key produces a Technocore DID", () => {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "der", type: "spki" })).subarray(-32);
  assert.match(didFromPublicRaw(raw), /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/);
});

test("single-line sweep mirrors Technocore categories", () => {
  assert.equal(cleanText("  hello\nworld\u200b  ", 4096), "hello world");
});

test("room signature is canonical base64url Ed25519", () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const signed = signRoomMessage({ privateKey }, "lobby", "123", "hello");
  assert.equal(signed.cleaned, "hello");
  assert.match(signed.signature, /^[A-Za-z0-9_-]{85}[AQgw]$/);
});

test("posting cooldown is enforced from the last signed post", () => {
  const entries = [{
    ts: "2026-09-24T10:00:00.000Z",
    type: "technocore.message.posted",
    payload: { room: "example" }
  }];
  assert.equal(postingEligibility(entries, 240, "2026-09-24T13:59:59.000Z").allowed, false);
  assert.equal(postingEligibility(entries, 240, "2026-09-24T14:00:00.000Z").allowed, true);
});

test("publication queue preserves order and dependencies", () => {
  const queue = {
    items: [
      { id: "first", status: "published", room: "a", text: "one", not_before: "2026-09-24T10:00:00Z" },
      { id: "second", status: "pending", room: "b", text: "two", not_before: "2026-09-24T14:00:00Z", depends_on: "first" }
    ]
  };
  assert.equal(queuedItemDecision(queue, "2026-09-24T13:00:00Z").reason, "not_before");
  assert.equal(queuedItemDecision(queue, "2026-09-24T14:00:00Z").eligible, true);
});

test("room windows disclose retention gaps", () => {
  const window = normalizeRoomWindow({
    first_seq: 120,
    last_seq: 121,
    generation: 3,
    messages: [{ seq: 120 }, { seq: 121 }]
  }, 100);
  assert.equal(window.gap, true);
  assert.equal(window.missing_before_window, 19);
  assert.equal(window.generation, 3);
});
