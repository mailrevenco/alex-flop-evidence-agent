import { appendLedger } from "./ledger.mjs";
import { didNoteLocation, signNote, signRoomMessage } from "./identity.mjs";
import { nextNonce, roomCursor, setRoomCursor } from "./state.mjs";

function component(value) {
  return encodeURIComponent(String(value));
}

export class TechnocoreClient {
  constructor(baseUrl, identity) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.identity = identity;
  }

  async request(path, { method = "GET", body } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Technocore ${response.status}: ${text.slice(0, 500)}`);
      error.status = response.status;
      error.responseBody = text;
      throw error;
    }
    return { status: response.status, text, headers: Object.fromEntries(response.headers.entries()) };
  }

  async claimOwnedRoom(room) {
    if (!room.startsWith("d-")) throw new Error("Owned Technocore rooms must start with d-.");
    const nonce = nextNonce(`note:room-owners:${room}`);
    const { signature } = signNote(this.identity, "room-owners", room, nonce, this.identity.did);
    const path = `/kv/room-owners/${component(room)}/set-signed/${component(this.identity.did)}/${component(signature)}/${nonce}/${component(this.identity.did)}?if_absent=1`;
    try {
      const result = await this.request(path);
      appendLedger("technocore.room.claimed", { room, did: this.identity.did, status: result.status });
      return { claimed: true, alreadyOwned: false };
    } catch (error) {
      if (error.status !== 409) throw error;
      const owner = await this.request(`/kv/room-owners/${component(room)}`);
      const alreadyOwned = owner.text.includes(this.identity.did);
      if (!alreadyOwned) throw new Error(`Technocore room ${room} is already owned by another identity.`);
      return { claimed: true, alreadyOwned: true };
    }
  }

  async setTopic(room, topic) {
    const result = await this.request(`/kv/topic/${component(room)}`, {
      method: "POST",
      body: { value: topic }
    });
    appendLedger("technocore.topic.set", { room, topic, status: result.status });
    return result;
  }

  async setProfile(value) {
    const location = didNoteLocation(this.identity.did);
    const result = await this.request(`/kv/${component(location.namespace)}/${component(location.key)}`, {
      method: "POST",
      body: { value }
    });
    appendLedger("technocore.profile.set", {
      did: this.identity.did,
      namespace: location.namespace,
      key: location.key,
      status: result.status
    });
    return { ...location, status: result.status };
  }

  async post(room, text, kind = "technocore.message.posted") {
    return postSignedMessage({
      baseUrl: this.baseUrl,
      room,
      text,
      identity: this.identity,
      nonce: nextNonce(`room:${room}`),
      kind,
      append: appendLedger
    });
  }

  async fetchNew(room) {
    const since = roomCursor(room);
    const result = await this.request(`/r/${component(room)}?since=${since}&limit=200&format=json`);
    const parsed = JSON.parse(result.text);
    return { room, since, ...normalizeRoomWindow(parsed, since) };
  }

  acknowledge(room, seq) {
    const numeric = Number(seq);
    if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error("Room cursor must be a non-negative safe integer.");
    setRoomCursor(room, numeric);
    appendLedger("technocore.room.acknowledged", { room, seq: numeric });
    return numeric;
  }
}

export async function postSignedMessage({ baseUrl, room, text, identity, nonce, kind, payload = {}, append }) {
  if (typeof append !== "function") throw new Error("A ledger append function is required.");
  const signed = signRoomMessage(identity, room, nonce, text);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/r/${component(room)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ did: identity.did, sig: signed.signature, nonce, text: signed.cleaned }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const error = new Error(`Technocore ${response.status}: ${detail}`);
    error.status = response.status;
    throw error;
  }
  append(kind, {
    room,
    did: identity.did,
    nonce,
    text_sha256: await sha256(signed.cleaned),
    text: signed.cleaned,
    status: response.status,
    ...payload
  });
  return { nonce, text: signed.cleaned, status: response.status };
}

export function normalizeRoomWindow(parsed, since = 0) {
  const messages = Array.isArray(parsed) ? parsed : (parsed.messages ?? []);
  const firstSeq = Number((Array.isArray(parsed) ? null : parsed.first_seq) ?? messages[0]?.seq ?? since);
  const lastSeq = Number((Array.isArray(parsed) ? null : parsed.last_seq) ?? messages.at(-1)?.seq ?? since);
  const expectedSeq = Number(since) + 1;
  const gap = Number(since) > 0 && messages.length > 0 && firstSeq > expectedSeq;
  return {
    messages,
    generation: Array.isArray(parsed) ? null : (parsed.generation ?? null),
    first_seq: firstSeq,
    last_seq: lastSeq,
    gap,
    missing_before_window: gap ? firstSeq - expectedSeq : 0,
    gap_scope: gap ? "response_window; export may still contain older messages" : "none"
  };
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}
