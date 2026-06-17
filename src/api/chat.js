/**
 * Chat API — Supabase Realtime messages.
 * Schema: { id: uuid, chat_id: text, sender_id: text, sender_name: text,
 *            text: text, created_at: timestamptz }
 */
import { sb } from './supabase.js';

export async function fetchMessages(chatId, limit = 80) {
  if (!sb) return _localMessages(chatId);
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.warn('[chat] fetch:', error.message); return _localMessages(chatId); }
  return data || [];
}

export async function sendMessage(chatId, senderId, senderName, text) {
  const msg = {
    chat_id:     chatId,
    sender_id:   String(senderId),
    sender_name: senderName,
    text,
    created_at:  new Date().toISOString(),
  };
  if (!sb) {
    _appendLocalMessage(chatId, msg);
    return { ok: false, data: msg };
  }
  const { data, error } = await sb.from('messages').insert(msg).select().single();
  if (error) {
    console.warn('[chat] send:', error.message);
    _appendLocalMessage(chatId, msg);
    return { ok: false, data: msg };
  }
  return { ok: true, data };
}

export function subscribeChat(chatId, myId, onMessage) {
  if (!sb) {
    // Polling fallback every 3s
    const poll = setInterval(async () => {
      const msgs = await fetchMessages(chatId);
      onMessage(msgs, 'poll');
    }, 3000);
    return { type: 'poll', handle: poll };
  }
  const channel = sb.channel('ch_' + chatId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `chat_id=eq.${chatId}`,
    }, payload => {
      if (String(payload.new.sender_id) !== String(myId)) {
        onMessage(payload.new, 'realtime');
      }
    })
    .subscribe();
  return { type: 'realtime', handle: channel };
}

export function unsubscribeChat(sub) {
  if (!sub) return;
  if (sub.type === 'poll') clearInterval(sub.handle);
  if (sub.type === 'realtime' && sb) sb.removeChannel(sub.handle);
}

// ── Local offline fallback ──────────────────────────────────────────────────
function _key(chatId) { return '_chat_' + chatId; }
function _localMessages(chatId) {
  try { return JSON.parse(localStorage.getItem(_key(chatId)) || '[]'); } catch { return []; }
}
function _appendLocalMessage(chatId, msg) {
  const arr = _localMessages(chatId);
  arr.push(msg);
  try { localStorage.setItem(_key(chatId), JSON.stringify(arr)); } catch {}
}
