import { cleanText, verifyRoomMessage } from "./identity.mjs";
import { postingEligibility } from "./posting-policy.mjs";

const REPLY_TYPE = "technocore.mailbox.reply.posted";

export function classifyMailboxQuestion(text) {
  if (typeof text !== "string" || text.length > 200) return null;
  const question = text.trim().toLocaleLowerCase("en-US");
  if (/^(?:what is (?:the )?flop(?: network)?|ce (?:este|e) flop(?: network)?)\?$/.test(question)) {
    return { kind: "definition", language: question.startsWith("ce ") ? "Romanian" : "English", prompt: "What is FLOP Network?" };
  }
  if (/^(?:how does (?:the )?flop(?: network)? work|cum funcționează flop(?: network)?)\?$/.test(question)) {
    return { kind: "mechanism", language: question.startsWith("cum ") ? "Romanian" : "English", prompt: "How does FLOP Network work?" };
  }
  if (/^(?:where (?:can i|do i) find official flop (?:docs|documentation)|unde (?:găsesc|pot găsi) documentația oficială flop)\?$/.test(question)) {
    return { kind: "documentation", language: question.startsWith("unde ") ? "Romanian" : "English", prompt: "Where is the official FLOP documentation?" };
  }
  return null;
}

export function mailboxReplyDecision({ messages, room, ownDid, entries, policy, now = new Date(), generation = null }) {
  const day = new Date(now).toISOString().slice(0, 10);
  const replies = entries.filter((entry) => entry.type === REPLY_TYPE && entry.ts?.slice(0, 10) === day);
  const dailyLimit = Number(policy.mailbox_daily_reply_limit ?? 0);
  const perSenderLimit = Number(policy.mailbox_per_sender_daily_limit ?? 0);
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1 || !Number.isSafeInteger(perSenderLimit) || perSenderLimit < 1) {
    throw new Error("Invalid mailbox reply limits.");
  }
  if (replies.length >= dailyLimit) return { eligible: false, reason: "daily_limit", message: null };

  for (const message of messages) {
    if (message?.from === ownDid || !Number.isSafeInteger(Number(message?.seq))) continue;
    if (typeof message.text !== "string" || message.text.length > 1000 || !message.text.includes("?")) continue;
    if (/https?:\/\/|\b(?:curl|powershell|bash|sudo)\b/i.test(message.text)) continue;
    if (!verifyRoomMessage(message, room)) continue;
    if (!classifyMailboxQuestion(message.text)) continue;
    const replied = entries.some((entry) => entry.type === REPLY_TYPE
      && entry.payload?.question_seq === Number(message.seq)
      && entry.payload?.question_generation === generation);
    if (replied) continue;
    if (replies.filter((entry) => entry.payload?.peer_did === message.from).length >= perSenderLimit) continue;
    const posting = postingEligibility(entries, policy.minimum_post_interval_minutes, now);
    if (!posting.allowed) return { eligible: false, reason: "cooldown", message, next_post_at: posting.next_post_at };
    return { eligible: true, reason: "ready", message };
  }
  return { eligible: false, reason: "no_signed_question", message: null };
}

export const MAILBOX_REPLY_TYPE = REPLY_TYPE;

export function validateMailboxAnswer(value, allowedSources) {
  if (value?.decision !== "reply") return { ok: false, reason: "deferred" };
  if (typeof value.answer !== "string" || /https?:\/\/|\b(?:sk-[A-Za-z0-9]{10,})\b/i.test(value.answer)) {
    return { ok: false, reason: "unsafe_answer" };
  }
  const sources = value.source_urls;
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 2
    || sources.some((url) => typeof url !== "string" || !allowedSources.some((source) => source.url === url))) {
    return { ok: false, reason: "unverified_source" };
  }
  if (typeof value.evidence_quote !== "string" || value.evidence_quote.length < 20
    || value.evidence_quote.length > 300
    || !allowedSources.some((source) => sources.includes(source.url) && source.excerpt.includes(value.evidence_quote))) {
    return { ok: false, reason: "unsupported_quote" };
  }
  try {
    const answer = cleanText(value.answer, 700);
    const text = `${answer} Source${sources.length > 1 ? "s" : ""}: ${[...new Set(sources)].join(" ")}`;
    cleanText(text, 4096);
    return { ok: true, text, sources: [...new Set(sources)] };
  } catch {
    return { ok: false, reason: "invalid_length" };
  }
}
