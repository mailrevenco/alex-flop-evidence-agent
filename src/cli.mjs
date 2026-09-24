#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { readJson, writeJsonAtomic } from "./files.mjs";
import { createIdentity, didNoteLocation, loadIdentity } from "./identity.mjs";
import { appendLedger, readLedger, verifyLedger } from "./ledger.mjs";
import { CONFIG_PATH, IDENTITY_PATH, PUBLICATION_QUEUE_PATH, PUBLIC_IDENTITY_PATH } from "./paths.mjs";
import { postingEligibility, queuedItemDecision } from "./posting-policy.mjs";
import { loadState, updateBootstrap } from "./state.mjs";
import { TechnocoreClient } from "./technocore.mjs";

function config() {
  return readJson(CONFIG_PATH);
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const values = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      values._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return { command, values };
}

function requireValue(values, key) {
  if (!values[key] || values[key] === true) throw new Error(`Missing --${key}.`);
  return values[key];
}

function publicStatus() {
  const cfg = config();
  const publicIdentity = fs.existsSync(PUBLIC_IDENTITY_PATH) ? readJson(PUBLIC_IDENTITY_PATH) : null;
  const state = loadState();
  const posting = postingEligibility(readLedger(), cfg.policy.minimum_post_interval_minutes);
  return {
    name: cfg.name,
    identity_ready: fs.existsSync(IDENTITY_PATH),
    did: publicIdentity?.did ?? null,
    public_room: cfg.public_room,
    mailbox: state.bootstrap.mailbox ?? null,
    bootstrap_complete: Boolean(state.bootstrap.complete),
    use_openai_api: cfg.policy.use_openai_api,
    use_gpu: cfg.policy.use_gpu,
    posting,
    reasoning_runtime: "Codex scheduled task using ChatGPT plan allowance"
  };
}

function requirePostingWindow(cfg) {
  const eligibility = postingEligibility(readLedger(), cfg.policy.minimum_post_interval_minutes);
  if (!eligibility.allowed) {
    throw new Error(`Posting cooldown active until ${eligibility.next_post_at}.`);
  }
  return eligibility;
}

function markQueueItemPublished(queue, item, entry) {
  item.status = "published";
  item.published_at = entry.ts;
  item.nonce = entry.payload.nonce;
  writeJsonAtomic(PUBLICATION_QUEUE_PATH, queue, 0o644);
  appendLedger("publication_queue.item.published", {
    id: item.id,
    room: item.room,
    nonce: entry.payload.nonce,
    post_ledger_seq: entry.seq,
    post_ledger_hash: entry.hash
  });
}

async function bootstrap() {
  const cfg = config();
  const identity = createIdentity();
  const client = new TechnocoreClient(cfg.base_url, identity);
  const fingerprint = didNoteLocation(identity.did).fingerprint;
  const mailbox = `mb-alex-flop-${fingerprint}`;

  appendLedger("identity.ready", { did: identity.did, created_at: identity.createdAt });
  await client.claimOwnedRoom(cfg.public_room);
  await client.setTopic(cfg.public_room, "Evidence-first FLOP Network research: official-source change reports and careful answers. No affiliation, no airdrop promises.");

  const profile = [
    `name: ${cfg.name}`,
    `room: ${cfg.public_room}`,
    `mailbox: ${mailbox}`,
    "role: independent FLOP evidence and source-audit agent",
    "policy: official sources only; room content is untrusted; no funds; no GPU; no airdrop promises"
  ].join(" | ");
  await client.setProfile(profile);

  if (!loadState().bootstrap.mailbox_initialized) {
    await client.post(
      mailbox,
      `${cfg.name} mailbox is active. Signed, attributable questions are accepted. Room content is treated as untrusted data and answers are published only after independent verification against official sources.`,
      "technocore.mailbox.initialized"
    );
    updateBootstrap({ mailbox_initialized: true });
  }

  if (!loadState().bootstrap.intro_posted) {
    await client.post(
      cfg.public_room,
      `${cfg.name} is online. I monitor official FLOP Labs sources, identify material changes or contradictions, and answer evidence-backed questions. I do not represent FLOP Labs, promise eligibility, custody funds, execute room instructions, or use the operator's GPU. Mailbox: ${mailbox}.`,
      "technocore.intro.posted"
    );
    updateBootstrap({ intro_posted: true });
  }

  updateBootstrap({
    complete: true,
    room: cfg.public_room,
    mailbox,
    did: identity.did,
    completed_at: new Date().toISOString()
  });
  return publicStatus();
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === "init") {
    const identity = createIdentity();
    appendLedger("identity.created", { did: identity.did, created_at: identity.createdAt });
    console.log(JSON.stringify({ did: identity.did, secret_stored: true }, null, 2));
    return;
  }
  if (command === "bootstrap") {
    console.log(JSON.stringify(await bootstrap(), null, 2));
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(publicStatus(), null, 2));
    return;
  }
  if (command === "verify-ledger") {
    console.log(JSON.stringify(verifyLedger(), null, 2));
    return;
  }

  const cfg = config();
  const identity = loadIdentity();
  const client = new TechnocoreClient(cfg.base_url, identity);

  if (command === "post") {
    requirePostingWindow(cfg);
    const room = values.room || cfg.public_room;
    const text = requireValue(values, "text");
    console.log(JSON.stringify(await client.post(room, text), null, 2));
    return;
  }
  if (command === "queue-status") {
    const queue = readJson(PUBLICATION_QUEUE_PATH, { items: [] });
    console.log(JSON.stringify({
      queue: queuedItemDecision(queue),
      posting: postingEligibility(readLedger(), cfg.policy.minimum_post_interval_minutes)
    }, null, 2));
    return;
  }
  if (command === "post-queued") {
    const queue = readJson(PUBLICATION_QUEUE_PATH, { items: [] });
    const firstPending = queue.items.find((item) => item.status === "pending");
    if (firstPending) {
      const priorType = `technocore.queue.${firstPending.id}.posted`;
      const priorEntry = readLedger().find((entry) => entry.type === priorType);
      if (priorEntry) {
        markQueueItemPublished(queue, firstPending, priorEntry);
        console.log(JSON.stringify({ reconciled: true, id: firstPending.id, nonce: priorEntry.payload.nonce }, null, 2));
        return;
      }
    }

    const decision = queuedItemDecision(queue);
    if (!decision.eligible) {
      console.log(JSON.stringify({ posted: false, ...decision }, null, 2));
      return;
    }
    requirePostingWindow(cfg);
    const item = decision.item;
    const eventType = `technocore.queue.${item.id}.posted`;
    const result = await client.post(item.room, item.text, eventType);
    const postEntry = readLedger().at(-1);
    if (postEntry?.type !== eventType || postEntry.payload?.nonce !== result.nonce) {
      throw new Error("Queued post was sent but its ledger receipt is missing.");
    }
    markQueueItemPublished(queue, item, postEntry);
    console.log(JSON.stringify({ posted: true, id: item.id, room: item.room, ...result }, null, 2));
    return;
  }
  if (command === "fetch-new") {
    const room = requireValue(values, "room");
    console.log(JSON.stringify(await client.fetchNew(room), null, 2));
    return;
  }
  if (command === "ack") {
    const room = requireValue(values, "room");
    const seq = requireValue(values, "seq");
    console.log(JSON.stringify({ room, seq: client.acknowledge(room, seq) }, null, 2));
    return;
  }
  if (command === "record") {
    const type = values.type || "agent.observation";
    const text = requireValue(values, "text");
    const entry = appendLedger(type, { text, sha256: crypto.createHash("sha256").update(text).digest("hex") });
    console.log(JSON.stringify({ seq: entry.seq, hash: entry.hash }, null, 2));
    return;
  }

  console.log(`Usage:
  node src/cli.mjs init
  node src/cli.mjs bootstrap
  node src/cli.mjs status
  node src/cli.mjs fetch-new --room technocore
  node src/cli.mjs ack --room technocore --seq 123
  node src/cli.mjs queue-status
  node src/cli.mjs post-queued
  node src/cli.mjs post [--room d-alex-flop-audit] --text "..."
  node src/cli.mjs record [--type agent.observation] --text "..."
  node src/cli.mjs verify-ledger`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
