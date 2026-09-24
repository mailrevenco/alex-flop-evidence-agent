import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ensureDir, readJson, writeJsonAtomic } from "./files.mjs";
import { DATA_DIR } from "./paths.mjs";

const DEFAULT_ROOM = "technocore";
const POLL_LIMIT = 200;

function statePath(dataDir) {
  return path.join(dataDir, "capture-state.json");
}

function archiveDir(dataDir) {
  return path.join(dataDir, "capture");
}

function emptyState(room) {
  return {
    version: 1,
    room,
    generation: null,
    cursor: null,
    last_success_at: null,
    missing_total: 0,
    gaps: [],
    archives: {}
  };
}

export function readCaptureState(dataDir = DATA_DIR, room = DEFAULT_ROOM) {
  const state = readJson(statePath(dataDir), emptyState(room));
  if (state.room !== room || state.version !== 1) throw new Error("Unsupported capture state.");
  return state;
}

function requireSeq(value) {
  const seq = Number(value);
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("Invalid Technocore sequence number.");
  return seq;
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) throw new Error("Technocore messages must be an array.");
  let previous = -1;
  for (const message of messages) {
    const seq = requireSeq(message?.seq);
    if (seq <= previous) throw new Error("Technocore messages are not in ascending sequence order.");
    previous = seq;
  }
  return messages;
}

async function getText(fetcher, url) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Technocore read failed (${response.status}): ${body.slice(0, 200)}`);
  return { body, headers: response.headers };
}

async function fetchWindow(fetcher, baseUrl, room, since) {
  const url = `${baseUrl}/r/${encodeURIComponent(room)}?since=${since}&limit=${POLL_LIMIT}&format=json`;
  const { body } = await getText(fetcher, url);
  const parsed = JSON.parse(body);
  return {
    generation: parsed.generation ?? null,
    messages: validateMessages(Array.isArray(parsed) ? parsed : parsed.messages)
  };
}

async function fetchExport(fetcher, baseUrl, room) {
  const { body, headers } = await getText(fetcher, `${baseUrl}/r/${encodeURIComponent(room)}/export`);
  const messages = body.trim() ? body.trimEnd().split(/\r?\n/).map((line) => JSON.parse(line)) : [];
  return {
    generation: headers.get("x-room-generation") ?? null,
    messages: validateMessages(messages)
  };
}

function archiveName(room, generation, now) {
  const epoch = String(generation ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${room}-g${epoch}-${now.toISOString().slice(0, 10)}.jsonl.gz`;
}

function captureLine(message, generation) {
  return JSON.stringify({
    generation,
    seq: requireSeq(message.seq),
    ts: String(message.ts ?? ""),
    from: String(message.from ?? ""),
    text: String(message.text ?? "")
  });
}

export async function captureOnce({
  baseUrl,
  room = DEFAULT_ROOM,
  dataDir = DATA_DIR,
  fallbackCursor = 0,
  fetcher = fetch,
  now = new Date()
}) {
  if (!baseUrl || room !== DEFAULT_ROOM) throw new Error("Capture is restricted to the configured technocore room.");
  const state = readCaptureState(dataDir, room);
  const priorCursor = state.cursor === null ? requireSeq(fallbackCursor) : requireSeq(state.cursor);
  const base = baseUrl.replace(/\/$/, "");

  let source = state.cursor === null ? "export" : "window";
  let result = source === "export"
    ? await fetchExport(fetcher, base, room)
    : await fetchWindow(fetcher, base, room, priorCursor);

  if (source === "window" && (
    (state.generation !== null && String(result.generation) !== String(state.generation))
    || (result.messages.length > 0 && requireSeq(result.messages[0].seq) > priorCursor + 1)
  )) {
    result = await fetchExport(fetcher, base, room);
    source = "export";
  }

  const reset = state.generation !== null && String(result.generation) !== String(state.generation);
  const since = reset ? 0 : priorCursor;
  const incoming = result.messages.filter((message) => requireSeq(message.seq) > since);
  const gaps = [];
  let expected = since + 1;
  for (const message of incoming) {
    const seq = requireSeq(message.seq);
    if (seq > expected) gaps.push({ from: expected, to: seq - 1, missing: seq - expected });
    expected = seq + 1;
  }

  if (incoming.length > 0) {
    ensureDir(archiveDir(dataDir));
    const name = archiveName(room, result.generation, now);
    const file = path.join(archiveDir(dataDir), name);
    const previous = state.archives[name];
    if (previous?.bytes !== undefined && fs.existsSync(file)) {
      const actualBytes = fs.statSync(file).size;
      if (actualBytes < previous.bytes) throw new Error(`Capture archive is shorter than its committed state: ${name}`);
      if (actualBytes > previous.bytes) fs.truncateSync(file, previous.bytes);
    }
    const lines = incoming.map((message) => captureLine(message, result.generation)).join("\n") + "\n";
    fs.appendFileSync(file, zlib.gzipSync(Buffer.from(lines, "utf8")));
    state.archives[name] = {
      first_seq: Math.min(previous?.first_seq ?? Infinity, requireSeq(incoming[0].seq)),
      last_seq: requireSeq(incoming.at(-1).seq),
      // Readers must ignore a collector append until its state update commits.
      bytes: fs.statSync(file).size
    };
  }

  state.generation = result.generation;
  state.cursor = incoming.length ? requireSeq(incoming.at(-1).seq) : (reset ? 0 : priorCursor);
  state.last_success_at = now.toISOString();
  state.missing_total += gaps.reduce((sum, gap) => sum + gap.missing, 0);
  if (reset) state.gaps.push({ kind: "generation_reset", at: now.toISOString() });
  for (const gap of gaps) state.gaps.push({ ...gap, at: now.toISOString(), generation: result.generation });
  writeJsonAtomic(statePath(dataDir), state);

  return {
    room,
    source,
    captured: incoming.length,
    cursor: state.cursor,
    generation: state.generation,
    gaps,
    reset,
    last_success_at: state.last_success_at
  };
}

export function isReviewCandidate(message, { did, publicRoom, mailbox }) {
  const value = String(message.text ?? "");
  if ([did, publicRoom, mailbox].some((term) => term && value.includes(term))) return true;
  return /\bflop\b/i.test(value)
    && (value.includes("?") || /genesis|supply|yellowpaper|airdrop|testnet|eligib|reward|evidence|audit|research/i.test(value));
}

export function capturedDigest({
  dataDir = DATA_DIR,
  room = DEFAULT_ROOM,
  after = 0,
  limit = 100,
  identity = {}
} = {}) {
  const state = readCaptureState(dataDir, room);
  const cursor = requireSeq(after);
  const generationReset = state.gaps.some((gap) => gap.kind === "generation_reset") && cursor > state.cursor;
  const effectiveCursor = generationReset ? 0 : cursor;
  const pageSize = Math.min(200, Math.max(1, requireSeq(limit)));
  const candidates = [];
  const seen = new Set();
  let scanned = 0;
  let candidateCount = 0;

  for (const [name, range] of Object.entries(state.archives).sort(([a], [b]) => a.localeCompare(b))) {
    if (range.last_seq <= effectiveCursor) continue;
    const archive = fs.readFileSync(path.join(archiveDir(dataDir), name));
    const committedBytes = range.bytes ?? archive.length;
    if (!Number.isSafeInteger(committedBytes) || committedBytes < 0 || committedBytes > archive.length) {
      throw new Error(`Capture archive is shorter than its committed state: ${name}`);
    }
    const data = zlib.gunzipSync(archive.subarray(0, committedBytes)).toString("utf8");
    for (const line of data.split(/\r?\n/)) {
      if (!line) continue;
      const message = JSON.parse(line);
      const seq = requireSeq(message.seq);
      if (seq <= effectiveCursor || String(message.generation) !== String(state.generation)) continue;
      const key = `${message.generation}:${seq}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scanned += 1;
      if (isReviewCandidate(message, identity)) {
        candidateCount += 1;
        if (candidates.length < pageSize) candidates.push(message);
      }
    }
  }

  candidates.sort((a, b) => a.seq - b.seq);
  return {
    room,
    after: cursor,
    generation_reset: generationReset,
    captured_through: state.cursor,
    last_success_at: state.last_success_at,
    scanned,
    candidate_count: candidateCount,
    candidates,
    has_more: candidateCount > candidates.length,
    next_after: candidateCount > candidates.length ? candidates.at(-1).seq : state.cursor,
    missing_total: state.missing_total,
    gaps_after: state.gaps.filter((gap) => gap.to === undefined || gap.to > cursor)
  };
}
