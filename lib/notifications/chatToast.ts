const shown = new Map<string, number>();

export function claimChatToast(conversationId: unknown, messageId: unknown): boolean {
  if (!messageId) return true;
  const key = `${conversationId}:${messageId}`;
  const now = Date.now();
  for (const [id, timestamp] of shown) if (now - timestamp > 120000) shown.delete(id);
  if (shown.has(key)) return false;
  shown.set(key, now);
  return true;
}
