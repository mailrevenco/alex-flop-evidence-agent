function asDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${label}.`);
  return date;
}

export function postingEligibility(entries, minimumIntervalMinutes, now = new Date()) {
  const interval = Number(minimumIntervalMinutes);
  if (!Number.isFinite(interval) || interval < 0) throw new Error("Invalid minimum posting interval.");
  const current = asDate(now, "current time");
  const posts = entries.filter((entry) => (
    typeof entry?.type === "string"
    && entry.type.startsWith("technocore.")
    && entry.type.endsWith(".posted")
    && entry.payload?.room
  ));
  const last = posts.at(-1);
  if (!last) return { allowed: true, last_post_at: null, next_post_at: null, remaining_seconds: 0 };

  const lastDate = asDate(last.ts, "ledger post timestamp");
  const next = new Date(lastDate.getTime() + interval * 60_000);
  const remaining = Math.max(0, Math.ceil((next.getTime() - current.getTime()) / 1000));
  return {
    allowed: remaining === 0,
    last_post_at: lastDate.toISOString(),
    next_post_at: next.toISOString(),
    remaining_seconds: remaining
  };
}

export function queuedItemDecision(queue, now = new Date()) {
  const current = asDate(now, "current time");
  const items = Array.isArray(queue?.items) ? queue.items : [];
  const item = items.find((candidate) => candidate.status === "pending");
  if (!item) return { eligible: false, reason: "empty", item: null };
  if (!item.id || !item.room || !item.text) throw new Error("Pending publication item is incomplete.");

  const notBefore = asDate(item.not_before, "queue not_before time");
  if (current < notBefore) {
    return { eligible: false, reason: "not_before", item, eligible_at: notBefore.toISOString() };
  }
  if (item.depends_on) {
    const dependency = items.find((candidate) => candidate.id === item.depends_on);
    if (!dependency || dependency.status !== "published") {
      return { eligible: false, reason: "dependency", item, dependency: item.depends_on };
    }
  }
  return { eligible: true, reason: "ready", item };
}
