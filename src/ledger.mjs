import crypto from "node:crypto";
import fs from "node:fs";
import { ensureDir } from "./files.mjs";
import { DATA_DIR, LEDGER_PATH } from "./paths.mjs";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(entryWithoutHash) {
  return crypto.createHash("sha256").update(canonical(entryWithoutHash)).digest("hex");
}

export function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function appendLedger(type, payload) {
  ensureDir(DATA_DIR);
  const entries = readLedger();
  const previous = entries.at(-1);
  const body = {
    seq: entries.length + 1,
    ts: new Date().toISOString(),
    type,
    payload,
    prev_hash: previous?.hash ?? null
  };
  const entry = { ...body, hash: digest(body) };
  fs.appendFileSync(LEDGER_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export function verifyLedger() {
  const entries = readLedger();
  let previousHash = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const { hash, ...body } = entry;
    if (entry.seq !== index + 1) throw new Error(`Ledger sequence mismatch at entry ${index + 1}.`);
    if (entry.prev_hash !== previousHash) throw new Error(`Ledger chain mismatch at entry ${entry.seq}.`);
    if (digest(body) !== hash) throw new Error(`Ledger hash mismatch at entry ${entry.seq}.`);
    previousHash = hash;
  }
  return { entries: entries.length, head: previousHash };
}

