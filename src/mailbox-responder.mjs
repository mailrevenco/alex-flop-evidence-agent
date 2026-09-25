import { mailboxReplyDecision, validateMailboxAnswer } from "./mailbox-policy.mjs";

export function reconcilePendingReply(state, entries, room) {
  if (!state.pending) return false;
  const receipt = entries.find((entry) => entry.type === "technocore.mailbox.reply.posted"
    && entry.payload?.room === room
    && entry.payload?.nonce === state.pending.nonce
    && entry.payload?.question_seq === state.pending.question_seq);
  if (!receipt) return false;
  state.cursor = Math.max(state.cursor, state.pending.question_seq);
  state.pending = null;
  return true;
}

export async function processMailboxCycle({
  room, ownDid, state, policy, fetchRoom, readEntries, answerQuestion,
  allowedSources, postReply, saveState, record = () => {}, now = new Date()
}) {
  let window = await fetchRoom(state.cursor);
  if (state.generation != null && window.generation != null && state.generation !== window.generation) {
    window = await fetchRoom(0);
    state.cursor = 0;
  }
  state.generation = window.generation ?? state.generation ?? null;
  if (window.gap) return { status: "response_gap", first_seq: window.first_seq, missing: window.missing_before_window };
  const messages = [...window.messages].sort((a, b) => Number(a.seq) - Number(b.seq));
  const decision = mailboxReplyDecision({
    messages, room, ownDid, entries: readEntries(), policy, now, generation: state.generation
  });
  if (!decision.eligible) {
    if (decision.reason === "no_signed_question") {
      state.cursor = Math.max(state.cursor, Number(window.last_seq ?? state.cursor));
      saveState(state);
    } else if (decision.message) {
      state.cursor = Math.max(state.cursor, Number(decision.message.seq) - 1);
      saveState(state);
    }
    return { status: decision.reason, cursor: state.cursor, next_post_at: decision.next_post_at ?? null };
  }
  const question = decision.message;
  const proposed = await answerQuestion(question);
  const answer = validateMailboxAnswer(proposed, allowedSources);
  if (!answer.ok) {
    record("mailbox.question.deferred", {
      room, question_seq: Number(question.seq), question_generation: state.generation,
      peer_did: question.from, reason: answer.reason
    });
    state.cursor = Number(question.seq);
    saveState(state);
    return { status: "deferred", reason: answer.reason, cursor: state.cursor };
  }
  const posted = await postReply(answer.text, {
    peer_did: question.from,
    question_seq: Number(question.seq),
    question_generation: state.generation,
    source_urls: answer.sources
  });
  state.cursor = Number(question.seq);
  saveState(state);
  return { status: "posted", cursor: state.cursor, nonce: posted.nonce, peer_did: question.from };
}
