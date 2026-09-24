import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureOnce, capturedDigest, isReviewCandidate, readCaptureState } from "../src/capture.mjs";
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

test("room windows distinguish a response gap from proven retention loss", () => {
  const window = normalizeRoomWindow({
    first_seq: 120,
    last_seq: 121,
    generation: 3,
    messages: [{ seq: 120 }, { seq: 121 }]
  }, 100);
  assert.equal(window.gap, true);
  assert.equal(window.missing_before_window, 19);
  assert.equal(window.generation, 3);
  assert.match(window.gap_scope, /export may still contain/);
});

test("collector recovers retained messages before declaring a true gap", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "flop-capture-test-"));
  t.after(() => {
    if (!dataDir.startsWith(path.join(os.tmpdir(), "flop-capture-test-"))) throw new Error("Unsafe test cleanup path.");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const message = (seq, text = "routine") => ({ seq, ts: "2026-09-24T10:00:00Z", from: "peer", text });
  const response = (body, generation = "0") => ({
    ok: true,
    status: 200,
    text: async () => body,
    headers: new Headers({ "x-room-generation": generation })
  });
  let windowCalls = 0;
  const fetcher = async (url) => {
    if (url.endsWith("/export")) {
      const entries = windowCalls === 0
        ? [message(8), message(9, "FLOP genesis?")]
        : [message(8), message(9, "FLOP genesis?"), message(10), message(11), message(12), message(13), message(14)];
      return response(entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }
    windowCalls += 1;
    const entries = windowCalls === 1
      ? [message(10), message(11)]
      : [message(14)];
    return response(JSON.stringify({ generation: 0, messages: entries }));
  };

  const options = { baseUrl: "https://technocore.chat", dataDir, fallbackCursor: 5, fetcher };
  const first = await captureOnce(options);
  assert.deepEqual(first.gaps, [{ from: 6, to: 7, missing: 2 }]);
  assert.equal(first.cursor, 9);
  const second = await captureOnce(options);
  assert.equal(second.source, "window");
  assert.equal(second.cursor, 11);
  const third = await captureOnce(options);
  assert.equal(third.source, "export");
  assert.deepEqual(third.gaps, []);
  assert.equal(third.cursor, 14);

  const digest = capturedDigest({ dataDir, after: 5, identity: {} });
  assert.equal(digest.scanned, 7);
  assert.equal(digest.candidate_count, 1);
  assert.equal(digest.candidates[0].seq, 9);
  assert.equal(digest.missing_total, 2);

  // A concurrent append must remain invisible until capture-state commits it.
  const archiveName = Object.keys(readCaptureState(dataDir).archives)[0];
  fs.appendFileSync(path.join(dataDir, "capture", archiveName), Buffer.from("uncommitted"));
  assert.equal(capturedDigest({ dataDir, after: 5, identity: {} }).scanned, 7);
});

test("digest replays the new generation when its cursor is below the old acknowledgement", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "flop-capture-test-"));
  t.after(() => {
    if (!dataDir.startsWith(path.join(os.tmpdir(), "flop-capture-test-"))) throw new Error("Unsafe test cleanup path.");
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  let generation = "1";
  const fetcher = async (url) => {
    const messages = generation === "1"
      ? [{ seq: 100, text: "old", ts: "", from: "peer" }]
      : [{ seq: 1, text: "FLOP supply?", ts: "", from: "peer" }];
    return {
      ok: true,
      status: 200,
      text: async () => url.endsWith("/export")
        ? messages.map((message) => JSON.stringify(message)).join("\n") + "\n"
        : JSON.stringify({ generation, messages }),
      headers: new Headers({ "x-room-generation": generation })
    };
  };
  const options = { baseUrl: "https://technocore.chat", dataDir, fetcher };
  await captureOnce(options);
  generation = "2";
  await captureOnce(options);
  const digest = capturedDigest({ dataDir, after: 100 });
  assert.equal(digest.generation_reset, true);
  assert.equal(digest.candidates[0].seq, 1);
});

test("candidate filter includes direct mentions and substantive FLOP questions", () => {
  const identity = { did: "did:key:agent", publicRoom: "d-audit", mailbox: "mb-agent" };
  assert.equal(isReviewCandidate({ text: "Please check did:key:agent" }, identity), true);
  assert.equal(isReviewCandidate({ text: "Is the FLOP airdrop live?" }, identity), true);
  assert.equal(isReviewCandidate({ text: "Agent heartbeat online" }, identity), false);
});
