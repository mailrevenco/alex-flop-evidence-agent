#!/usr/bin/env node
import { readJson } from "./files.mjs";
import { CONFIG_PATH } from "./paths.mjs";
import { roomCursor } from "./state.mjs";
import { captureOnce } from "./capture.mjs";

const cfg = readJson(CONFIG_PATH);
if (!cfg.monitor_rooms.includes("technocore")) throw new Error("technocore is not configured for monitoring.");
const once = process.argv.includes("--once");
const intervalMs = 10_000;

async function poll() {
  try {
    const result = await captureOnce({
      baseUrl: cfg.base_url,
      fallbackCursor: roomCursor("technocore")
    });
    if (once || result.gaps.length > 0 || result.reset) console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`Collector failure: ${error.message}`);
    if (once) process.exitCode = 1;
  }
}

if (once) await poll();
else {
  while (true) {
    await poll();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
