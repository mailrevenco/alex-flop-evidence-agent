import { readJson, writeJsonAtomic } from "./files.mjs";
import { STATE_PATH } from "./paths.mjs";

const EMPTY_STATE = {
  version: 1,
  nonces: {},
  room_cursors: {},
  bootstrap: {}
};

export function loadState() {
  return readJson(STATE_PATH, EMPTY_STATE);
}

export function saveState(state) {
  writeJsonAtomic(STATE_PATH, state);
}

export function nextNonce(scope) {
  const state = loadState();
  const now = BigInt(Date.now());
  const previous = BigInt(state.nonces[scope] ?? "0");
  const nonce = (now > previous ? now : previous + 1n).toString();
  state.nonces[scope] = nonce;
  saveState(state);
  return nonce;
}

export function roomCursor(room) {
  return Number(loadState().room_cursors[room] ?? 0);
}

export function setRoomCursor(room, seq) {
  const state = loadState();
  state.room_cursors[room] = Number(seq);
  saveState(state);
}

export function updateBootstrap(values) {
  const state = loadState();
  state.bootstrap = { ...state.bootstrap, ...values };
  saveState(state);
}

