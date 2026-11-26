// Süre, metin kaçışı ve yarış planı. Saf fonksiyonlar; ağ çağrısı yok.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ms2 = (ms, withTenths) => {
  if (ms == null || isNaN(ms)) return '—';
  const neg = ms < 0; ms = Math.abs(Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, t = Math.floor(ms / 100) % 10;
  const core = (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0') + (withTenths ? '.' + t : '');
  return (neg ? '-' : '') + core;
};
export const parseTime = (txt) => { // "4:35", "1:05:20", "275" (sn) -> ms
  const p = String(txt || '').trim().replace(',', '.').split(':').map(Number);
  if (!p.length || p.some((x) => isNaN(x) || x < 0)) return null;
  let sec = 0; for (const x of p) sec = sec * 60 + x;
  return sec > 0 ? Math.round(sec * 1000) : null;
};
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

export const roleTr = { owner: 'Salon sahibi', coach: 'Antrenör', athlete: 'Sporcu', judge: 'Hakem' };
export const kindTr = { simulation: 'Simülasyon', training: 'Antrenman', test: 'Test', race: 'Yarış' };
export const statusTr = { planned: 'Planlandı', live: 'Canlı', finished: 'Bitti', cancelled: 'İptal', registered: 'Bekliyor', running: 'Koşuyor', dnf: 'Bitiremedi', dq: 'Diskalifiye' };

// Yarış planı: koşu_i, (roxzone_i), istasyon_i ...
export function buildPlan(payload, trackRox) {
  const runs = payload?.runs?.count || 0, st = payload?.stations || [], n = Math.max(runs, st.length), plan = [];
  for (let i = 1; i <= n; i++) {
    if (i <= runs) plan.push({ kind: 'run', ref: 'run_' + i, label: i + '. koşu (' + ((payload.runs.distance_m || 1000) / 1000) + ' km)' });
    if (i <= st.length) {
      if (trackRox) plan.push({ kind: 'roxzone', ref: 'roxzone_' + i, label: 'Geçiş ' + i });
      const s = st[i - 1];
      plan.push({ kind: 'station', ref: s.code, label: (s.name_tr || s.code) + ' · ' + s.target + (s.metric === 'reps' ? ' tekrar' : s.metric === 'distance_m' ? ' m' : '') });
    }
  }
  return plan;
}
export const refLabel = (ref, payload) => {
  if (/^run_\d+$/.test(ref)) return ref.split('_')[1] + '. koşu';
  if (/^roxzone_\d+$/.test(ref)) return 'Geçiş ' + ref.split('_')[1];
  const s = (payload?.stations || []).find((x) => x.code === ref); return s ? s.name_tr : ref;
};
