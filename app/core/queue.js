// Çevrimdışı kronometre kuyruğu (rl_queue_v1). Sıra bozulmaz: retry gelince döngü durur.
import { sb, errMsg } from './supabase.js';
import { uuid } from './format.js';
import { toast } from './router.js';

export const QKEY = 'rl_queue_v1', FKEY = 'rl_failed_v1';
export const queue = { get(k = QKEY) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } },
  set(a, k = QKEY) { try { localStorage.setItem(k, JSON.stringify(a)); } catch (e) {} } };
export function enqueue(item) { item.qid = item.qid || uuid(); const a = queue.get(); a.push(item); queue.set(a); flush(); }
export function dropFromQueue(qid) { queue.set(queue.get().filter((x) => x.qid !== qid)); }
function forgetLocalSeg(it) { // canlı ekranın telefondaki tamponundan çıkar (gönderildi ya da kesin reddedildi)
  if (!it.sid || !it.row) return; const k = 'rl_live_' + it.sid;
  try { const L = JSON.parse(localStorage.getItem(k) || '{}'); if (L.segs && L.segs[it.row.entry_id]) { L.segs[it.row.entry_id] = L.segs[it.row.entry_id].filter((x) => x.id !== it.row.id); localStorage.setItem(k, JSON.stringify(L)); } } catch (e) {}
}
// Hata sınıfı: tekrar denenir mi, başarı mı sayılır, yoksa kesin red mi?
export function classify(res) {
  const e = res && res.error; if (!e) return 'ok';
  const code = String(e.code || ''), st = res.status || 0, msg = String(e.message || '');
  if (code === '23505') return 'ok';                                   // aynı kayıt zaten var (tekrar gönderim)
  if (!st || /fetch|network|Failed|Load failed|timeout/i.test(msg)) return 'retry'; // ağ yok
  if (st === 401 || /JWT|token/i.test(msg)) return 'auth';             // oturum süresi doldu: yenile, sonra tekrar
  if (st >= 500 || st === 429 || st === 408) return 'retry';           // sunucu meşgul
  return 'reject';                                                      // kural reddi (RLS, kısıt): kullanıcıya göster
}
let flushing = false;
export async function flush() {
  if (flushing || !navigator.onLine) return; flushing = true;
  try {
    for (const it of queue.get()) {
      let res;
      if (it.op === 'seg') res = await sb.from('segments').upsert(it.row, { onConflict: 'id', ignoreDuplicates: true });
      else if (it.op === 'entry') res = await sb.from('session_entries').update(it.patch).eq('id', it.id);
      else if (it.op === 'session') res = await sb.from('sessions').update(it.patch).eq('id', it.id);
      else if (it.op === 'delseg') res = await sb.from('segments').delete().eq('id', it.id);
      const c = classify(res);
      if (c === 'retry') break;
      if (c === 'auth') { try { await sb.auth.refreshSession(); } catch (e) {} break; }
      if (c === 'reject') { const f = queue.get(FKEY); f.push(Object.assign({}, it, { error: String(res.error.message || ''), at: new Date().toISOString() })); queue.set(f.slice(-200), FKEY); toast('Bir kayıt sunucuda reddedildi: ' + errMsg(res.error), true); }
      if (it.op === 'seg') forgetLocalSeg(it);
      dropFromQueue(it.qid); // iki sekme açık olsa da kimlikle silinir, başka kaydı silmez
    }
  } catch (e) { /* ağ hatası: kuyrukta kalır */ } finally { flushing = false; renderNet(); }
}
addEventListener('online', flush); setInterval(flush, 5000);
export function renderNet() { const el = document.getElementById('net'); if (!el) return; const n = queue.get().length, f = queue.get(FKEY).length; el.hidden = navigator.onLine && n === 0 && f === 0; el.textContent = !navigator.onLine ? 'Çevrimdışı: kayıtlar telefonda tutuluyor (' + n + '), bağlantı gelince gönderilecek.' : n ? 'Gönderiliyor: ' + n + ' kayıt…' : f ? f + ' kayıt sunucuda reddedildi (Hesap sayfasında listelenir).' : ''; }
addEventListener('offline', renderNet);
