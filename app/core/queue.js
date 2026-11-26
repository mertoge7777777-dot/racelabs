// Çevrimdışı kronometre kuyruğu (rl_queue_v1). Sıra bozulmaz: retry gelince döngü durur.
import { sb, errMsg } from './supabase.js';
import { uuid } from './format.js';
import { toast } from './router.js';

export const QKEY = 'rl_queue_v1', FKEY = 'rl_failed_v1';
/** Sürekli retry riski: bu süreden eski kuyruk kayıtları Hesap'ta uyarı + manuel temizleme alır. */
export const QUEUE_STALE_MS = 5 * 60 * 1000;
export const queue = { get(k = QKEY) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } },
  set(a, k = QKEY) { try { localStorage.setItem(k, JSON.stringify(a)); } catch (e) {} } };
export function enqueue(item) {
  item.qid = item.qid || uuid();
  item.at = item.at || new Date().toISOString(); // kuyruk yaşı uyarısı için
  const a = queue.get(); a.push(item); queue.set(a); flush();
}
export function dropFromQueue(qid) { queue.set(queue.get().filter((x) => x.qid !== qid)); }
function forgetLocalSeg(it) { // canlı ekranın telefondaki tamponundan çıkar (gönderildi ya da kesin reddedildi)
  if (!it.sid || !it.row) return; const k = 'rl_live_' + it.sid;
  try { const L = JSON.parse(localStorage.getItem(k) || '{}'); if (L.segs && L.segs[it.row.entry_id]) { L.segs[it.row.entry_id] = L.segs[it.row.entry_id].filter((x) => x.id !== it.row.id); localStorage.setItem(k, JSON.stringify(L)); } } catch (e) {}
}
function itemAgeMs(it, now = Date.now()) {
  const t = it && it.at ? Date.parse(it.at) : NaN;
  // Eski (at'siz) kayıtlar: yaş bilinmiyor → sıkışmış say
  if (!Number.isFinite(t)) return QUEUE_STALE_MS + 1;
  return Math.max(0, now - t);
}
export function formatQueueAge(ms) {
  const s = Math.max(0, Math.floor(Number(ms) / 1000));
  if (s < 60) return s + ' sn';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' dk';
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? h + ' sa ' + rm + ' dk' : h + ' sa';
}
/** Kuyruk özeti: toplam, eşik üstü (stale) sayısı, en eski yaş. classify/flush sırasına dokunmaz. */
export function queueAgeSummary(now = Date.now()) {
  const items = queue.get();
  let oldestMs = 0, stale = 0;
  for (const it of items) {
    const age = itemAgeMs(it, now);
    if (age > oldestMs) oldestMs = age;
    if (age >= QUEUE_STALE_MS) stale++;
  }
  return { total: items.length, stale, oldestMs };
}
/** Yalnız eşik üstü (sıkışmış) kayıtları siler; yeni bekleyenler kalır. */
export function clearStaleQueue(now = Date.now()) {
  const items = queue.get(), keep = [], drop = [];
  for (const it of items) {
    if (itemAgeMs(it, now) >= QUEUE_STALE_MS) drop.push(it);
    else keep.push(it);
  }
  for (const it of drop) if (it.op === 'seg') forgetLocalSeg(it);
  queue.set(keep);
  renderNet();
  return drop.length;
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
