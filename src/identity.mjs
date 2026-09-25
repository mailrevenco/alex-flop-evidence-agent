import crypto from "node:crypto";
import fs from "node:fs";
import { ensureDir, readJson, writeJsonAtomic } from "./files.mjs";
import { IDENTITY_PATH, PUBLIC_IDENTITY_PATH, SECRET_DIR } from "./paths.mjs";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MULTICODEC_ED25519 = Buffer.from([0xed, 0x01]);
const INVISIBLE_CATEGORIES = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

export function base58(raw) {
  let number = BigInt(`0x${Buffer.from(raw).toString("hex") || "0"}`);
  let output = "";
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    output = B58[remainder] + output;
  }
  for (const byte of raw) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output || "1";
}

function unbase58(value) {
  let number = 0n;
  for (const character of value) {
    const digit = B58.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58 character.");
    number = number * 58n + BigInt(digit);
  }
  const hex = number === 0n ? "" : number.toString(16).padStart(Math.ceil(number.toString(16).length / 2) * 2, "0");
  const leadingZeroes = value.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(hex, "hex")]);
}

export function cleanText(text, limit) {
  const cleaned = String(text).replace(INVISIBLE_CATEGORIES, " ").trim();
  if (!cleaned) throw new Error("Text is empty after Technocore's single-line sweep.");
  if (cleaned.length > limit) throw new Error(`Text exceeds the ${limit}-character limit.`);
  return cleaned;
}

export function didFromPublicRaw(raw) {
  const encoded = base58(Buffer.concat([MULTICODEC_ED25519, Buffer.from(raw)]));
  const did = `did:key:z${encoded}`;
  if (!/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(did)) {
    throw new Error("Generated an invalid Ed25519 did:key.");
  }
  return did;
}

function publicRawFromSpki(spkiDer) {
  const raw = Buffer.from(spkiDer).subarray(-32);
  if (raw.length !== 32) throw new Error("Unexpected Ed25519 SPKI encoding.");
  return raw;
}

export function createIdentity() {
  if (fs.existsSync(IDENTITY_PATH)) return loadIdentity();
  ensureDir(SECRET_DIR);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const publicRaw = publicRawFromSpki(publicDer);
  const did = didFromPublicRaw(publicRaw);
  const createdAt = new Date().toISOString();

  writeJsonAtomic(IDENTITY_PATH, {
    version: 1,
    type: "Ed25519",
    did,
    created_at: createdAt,
    private_key_pkcs8_der_base64: Buffer.from(privateDer).toString("base64"),
    public_key_spki_der_base64: Buffer.from(publicDer).toString("base64")
  });
  writeJsonAtomic(PUBLIC_IDENTITY_PATH, { version: 1, did, created_at: createdAt }, 0o644);
  return loadIdentity();
}

export function loadIdentity() {
  const stored = readJson(IDENTITY_PATH);
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(stored.private_key_pkcs8_der_base64, "base64"),
    format: "der",
    type: "pkcs8"
  });
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(stored.public_key_spki_der_base64, "base64"),
    format: "der",
    type: "spki"
  });
  const derived = didFromPublicRaw(publicRawFromSpki(publicKey.export({ format: "der", type: "spki" })));
  if (derived !== stored.did) throw new Error("Identity file failed its DID integrity check.");
  return { did: stored.did, createdAt: stored.created_at, privateKey, publicKey };
}

export function signCanonical(privateKey, canonical) {
  return crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64url");
}

export function signRoomMessage(identity, room, nonce, text) {
  const cleaned = cleanText(text, 4096);
  return { cleaned, signature: signCanonical(identity.privateKey, `${room}|${nonce}|${cleaned}`) };
}

export function verifyRoomMessage(message, room) {
  try {
    if (!/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(message?.from ?? "")) return false;
    if (!/^[0-9]+$/.test(String(message?.nonce ?? ""))) return false;
    if (typeof message?.text !== "string" || cleanText(message.text, 4096) !== message.text) return false;
    if (typeof message?.sig !== "string" || !/^[A-Za-z0-9_-]+$/.test(message.sig)) return false;
    const multicodec = unbase58(message.from.slice("did:key:z".length));
    if (multicodec.length !== 34 || !multicodec.subarray(0, 2).equals(MULTICODEC_ED25519)) return false;
    const signature = Buffer.from(message.sig, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== message.sig) return false;
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, multicodec.subarray(2)]),
      format: "der",
      type: "spki"
    });
    return crypto.verify(null, Buffer.from(`${room}|${message.nonce}|${message.text}`, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

export function signNote(identity, namespace, key, nonce, value) {
  const cleaned = cleanText(value, 8192);
  return { cleaned, signature: signCanonical(identity.privateKey, `${namespace}|${key}|${nonce}|${cleaned}`) };
}

export function didNoteLocation(did) {
  const fingerprint = crypto.createHash("sha256").update(did).digest("hex").slice(0, 16);
  return { namespace: `did-${fingerprint.slice(0, 2)}`, key: fingerprint.slice(2), fingerprint };
}
