import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const CONFIG_PATH = path.join(ROOT, "config", "agent.json");
export const PUBLICATION_QUEUE_PATH = path.join(ROOT, "config", "publication_queue.json");
export const SECRET_DIR = path.join(ROOT, "secrets");
export const IDENTITY_PATH = path.join(SECRET_DIR, "identity.json");
export const DATA_DIR = path.join(ROOT, "data");
export const STATE_PATH = path.join(DATA_DIR, "state.json");
export const LEDGER_PATH = path.join(DATA_DIR, "ledger.jsonl");
export const PUBLIC_IDENTITY_PATH = path.join(DATA_DIR, "public_identity.json");
