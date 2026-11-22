import { register, page, toast } from '../core/router.js';
import { sb, q, S, canRecord, now, syncClock } from '../core/supabase.js';
import { esc, ms2, uuid, statusTr, kindTr, buildPlan, refLabel } from '../core/format.js';
import { queue, enqueue } from '../core/queue.js';

export async function canli(sid) {
  const s = await q(sb.from('sessions').select('*, race_config_versions(payload)').eq('id', sid).single());
  const payload = s.race_config_versions?.payload;
  const plan = payload ? buildPlan(payload, s.track_roxzone) : [];
  const rec = canRecord() && s.kind !== 'training';
  let entries = [], segs = {};
  const LKEY = 'rl_live_' + sid; // yerel tampon: çevrimdışı dokunuşlar
  const local = () => { try { return JSON.parse(localStorage.getItem(LKEY) || '{}'); } catch (e) { return {}; } };
  const saveLocal = (o) => { try { localStorage.setItem(LKEY, JSON.stringify(o)); } catch (e) {} };

  async function loadAll() {
    if (rec) {
      entries = await q(sb.from('session_entries').select('*').eq('session_id', sid).order('wave').order('bib'));
      const rows = entries.length ? await q(sb.from('segments').select('id, entry_id, segment_index, duration_ms, ref_code').in('entry_id', entries.map((e) => e.id)).order('segment_index')) : [];
      segs = {}; rows.forEach((r) => (segs[r.entry_id] = segs[r.entry_id] || []).push(r));
      const L = local(); // sunucuya henüz gitmemiş yerel dokunuşları ekle
      Object.entries(L.segs || {}).forEach(([eid, arr]) => { const have = new Set((segs[eid] || []).map((x) => x.id)); arr.forEach((x) => { if (!have.has(x.id)) (segs[eid] = segs[eid] || []).push(x); }); (segs[eid] || []).sort((a, b) => a.segment_index - b.segment_index); });
      Object.entries(L.starts || {}).forEach(([eid, t]) => { const e = entries.find((x) => x.id === eid); if (e && !e.started_at) { e.started_at = t; e.status = 'running'; } });
    }
  }
  await Promise.all([loadAll(), syncClock()]);
  const waves = [...new Set(entries.map((e) => e.wave))].sort((a, b) => a - b);
  const exportBtns = rec ? '<button class="btn s" id="csv">CSV (Excel)</button><button class="btn s" id="prt">Yazdır</button>' : '';
  const actions = exportBtns + (rec ? (s.status !== 'finished' ? waves.map((w) => '<button class="btn p s" data-start="' + w + '">' + (waves.length > 1 ? w + '. dalgayı' : 'Herkesi') + ' başlat</button>').join('') + '<button class="btn s" id="fin">Oturumu bitir</button>' : '') : '');
  page(s.title, '<div class="timer-head"><div class="row" style="justify-content:space-between"><div><span class="tag ' + (s.status === 'live' ? 'g' : '') + '">' + esc(statusTr[s.status]) + '</span> <span class="small mut">' + esc(kindTr[s.kind]) + ' · ' + plan.length + ' bölüm' + (s.track_roxzone ? ' (geçişler dahil)' : '') + '</span></div><div class="clock mono" id="clk">' + ms2(0) + '</div></div></div>'
    + (rec ? '<div class="lanes" id="lanes"></div>' : '') + '<div class="card" style="margin-top:14px"><h2>Canlı sıralama</h2><div class="tw"><table class="lb"><thead><tr><th>#</th><th>Sporcu</th><th>Kategori</th><th>Bölüm</th><th>Süre</th></tr></thead><tbody id="lb"><tr><td colspan="5" class="empty">Yükleniyor…</td></tr></tbody></table></div><p class="small mut">Sıralama her birkaç saniyede bir güncellenir.</p></div>', { actions });

  const firstStart = () => entries.map((e) => e.started_at && Date.parse(e.started_at)).filter(Boolean).sort()[0];
  function laneHtml(e) {
    const done = segs[e.id] || [], i = done.length, cur = plan[i], fin = e.status === 'finished' || i >= plan.length;
    const elapsed = done.reduce((t, x) => t + x.duration_ms, 0);
    const since = e.started_at ? now() - Date.parse(e.started_at) - elapsed : 0;
    return '<div class="lane' + (fin ? ' fin' : '') + '" data-e="' + e.id + '"><div class="nm"><span>#' + esc(e.bib ?? '') + ' ' + esc(e.display_name) + '</span><span class="tag">' + esc(e.division_code || '') + '</span></div>'
      + '<div class="bar"><i style="width:' + Math.round((i / Math.max(1, plan.length)) * 100) + '%"></i></div>'
      + '<div class="seg">' + (fin ? '<b>Bitirdi</b>' : e.started_at ? 'Şu an: <b>' + esc(cur ? cur.label : '') + '</b>' : 'Başlamadı') + '</div>'
      + '<div class="row" style="justify-content:space-between"><span class="t mono" data-tick="' + e.id + '">' + (fin ? ms2(e.total_ms || elapsed, true) : e.started_at ? ms2(since, true) : '—') + '</span><span class="small mut mono">Toplam ' + ms2(elapsed) + '</span></div>'
      + (fin ? '' : e.started_at ? '<button class="btn p go" data-next="' + e.id + '">' + esc(cur ? cur.label : '') + ' bitti →</button>' : '<button class="btn go" data-solo="' + e.id + '">Tek başlat</button>')
      + (done.length && !fin ? '<button class="btn s" data-undo="' + e.id + '">Son dokunuşu geri al</button>' : '') + (!fin && e.started_at ? '<button class="btn s d" data-dnf="' + e.id + '">Bitiremedi</button>' : '') + '</div>';
  }
  function drawLanes() { const el = document.getElementById('lanes'); if (el) el.innerHTML = entries.map(laneHtml).join('') || '<div class="card empty">Bu oturumda sporcu yok.</div>'; }
  function startEntries(list) {
    const t = new Date(now()).toISOString(), L = local(); L.starts = L.starts || {};
    list.forEach((e) => { if (e.started_at) return; e.started_at = t; e.status = 'running'; L.starts[e.id] = t; enqueue({ op: 'entry', id: e.id, patch: { started_at: t, status: 'running' } }); });
    saveLocal(L);
    if (s.status !== 'live') { s.status = 'live'; enqueue({ op: 'session', id: sid, patch: { status: 'live', started_at: t } }); const tg = document.querySelector('.timer-head .tag'); if (tg) { tg.textContent = statusTr.live; tg.className = 'tag g'; } }
    drawLanes();
  }
  if (rec) {
    drawLanes();
    document.getElementById('lanes').addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const id = b.dataset.next || b.dataset.solo || b.dataset.undo || b.dataset.dnf, e = entries.find((x) => x.id === id); if (!e) return;
      if (b.dataset.solo) return startEntries([e]);
      const done = segs[e.id] = segs[e.id] || [], L = local(); L.segs = L.segs || {}; L.segs[e.id] = L.segs[e.id] || [];
      if (b.dataset.next) {
        const i = done.length, p = plan[i]; if (!p) return;
        const tnow = now(), elapsed = done.reduce((t, x) => t + x.duration_ms, 0), dur = tnow - Date.parse(e.started_at) - elapsed;
        if (dur < 500) return; // çift dokunma koruması
        const row = { id: uuid(), entry_id: e.id, org_id: S.org.id, segment_index: i + 1, kind: p.kind, ref_code: p.ref, duration_ms: Math.round(dur), ended_at: new Date(tnow).toISOString(), source: 'timer' };
        done.push(row); L.segs[e.id].push(row); saveLocal(L); enqueue({ op: 'seg', row, sid });
        if (navigator.vibrate) navigator.vibrate(30);
        if (done.length >= plan.length) { const total = elapsed + Math.round(dur); e.status = 'finished'; e.total_ms = total; enqueue({ op: 'entry', id: e.id, patch: { status: 'finished', finished_at: new Date(tnow).toISOString(), total_ms: total } }); }
      } else if (b.dataset.undo) {
        const last = done.pop(); if (!last) return; L.segs[e.id] = L.segs[e.id].filter((x) => x.id !== last.id); saveLocal(L); enqueue({ op: 'delseg', id: last.id });
      } else if (b.dataset.dnf) {
        if (!confirm(e.display_name + ' bitiremedi olarak işaretlensin mi?')) return; e.status = 'dnf'; enqueue({ op: 'entry', id: e.id, patch: { status: 'dnf' } });
      }
      drawLanes(); drawBoard();
    });
    document.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => startEntries(entries.filter((e) => e.wave === +b.dataset.start))));
    const fin = document.getElementById('fin');
    if (fin) fin.onclick = () => { if (!confirm('Oturum bitirilsin mi?')) return; enqueue({ op: 'session', id: sid, patch: { status: 'finished', finished_at: new Date().toISOString() } }); s.status = 'finished'; toast('Oturum bitirildi.'); setTimeout(() => canli(sid), 600); };
  }
  // Sonuç dışa aktarma: sıra, sporcu, kategori, durum, toplam + her bölümün ara süresi (Excel Türkçe için ; ayraç + BOM).
  function exportCsv() {
    const rows = entries.slice().sort((a, b) => { const fa = a.status === 'finished', fb = b.status === 'finished'; if (fa !== fb) return fa ? -1 : 1; const ta = a.total_ms || (segs[a.id] || []).reduce((t, x) => t + x.duration_ms, 0), tb = b.total_ms || (segs[b.id] || []).reduce((t, x) => t + x.duration_ms, 0); return fa ? ta - tb : ((segs[b.id] || []).length - (segs[a.id] || []).length) || ta - tb; });
    const q2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const head = ['Sıra', 'No', 'Sporcu', 'Kategori', 'Dalga', 'Durum', 'Toplam'].concat(plan.map((p) => p.label));
    const lines = [head.map(q2).join(';')];
    rows.forEach((e, i) => { const d = segs[e.id] || []; const tot = e.total_ms || d.reduce((t, x) => t + x.duration_ms, 0);
      lines.push([i + 1, e.bib ?? '', e.display_name, e.division_code || '', e.wave, statusTr[e.status] || e.status, ms2(tot, true)].concat(plan.map((p, k) => { const x = d.find((y) => y.segment_index === k + 1); return x ? ms2(x.duration_ms, true) : ''; })).map(q2).join(';')); });
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (s.title || 'simulasyon').replace(/[^\wçğıöşüÇĞİÖŞÜ -]+/g, '').trim().replace(/\s+/g, '-') + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  if (rec) { const c = document.getElementById('csv'), pr = document.getElementById('prt'); if (c) c.onclick = exportCsv; if (pr) pr.onclick = () => window.print(); }
  async function drawBoard() {
    const el = document.getElementById('lb'); if (!el) return;
    try {
      const rows = await q(sb.rpc('session_leaderboard', { p_session: sid }));
      el.innerHTML = rows.length ? rows.map((r, i) => '<tr class="' + (r.is_me ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(r.name) + (r.bib ? ' <span class="mut small">#' + r.bib + '</span>' : '') + '</td><td>' + esc(r.division_code || '') + '</td><td>' + (r.status === 'finished' ? '<span class="tag g">Bitti</span>' : r.status === 'dnf' ? '<span class="tag r">DNF</span>' : r.segments_done + '/' + plan.length + (r.last_ref ? ' <span class="mut small">' + esc(refLabel(r.last_ref, payload)) + '</span>' : '')) + '</td><td class="mono">' + ms2(r.total_ms || r.elapsed_ms) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">Sporcu yok.</td></tr>';
    } catch (e) { /* çevrimdışı: son tablo kalır */ }
  }
  drawBoard();
  S.timers.push(setInterval(() => {
    const t0 = firstStart(); const c = document.getElementById('clk'); if (c && t0 && s.status !== 'finished') c.textContent = ms2(now() - t0, true);
    document.querySelectorAll('[data-tick]').forEach((el) => { const e = entries.find((x) => x.id === el.dataset.tick); if (!e || !e.started_at || e.status === 'finished' || e.status === 'dnf') return; const el2 = (segs[e.id] || []).reduce((t, x) => t + x.duration_ms, 0); el.textContent = ms2(now() - Date.parse(e.started_at) - el2, true); });
  }, 100));
  // Birden çok cihaz (ör. iki hakem) aynı oturumu yönetebilir: şeritler de düzenli tazelenir.
  // Henüz gönderilmemiş yerel dokunuşlar korunur; silinmek üzere kuyruktaki ara süreler gösterilmez.
  async function refresh() {
    if (document.hidden) return;
    try {
      const fresh = await q(sb.from('sessions').select('status').eq('id', sid).single()); s.status = fresh.status;
      if (rec) {
        await loadAll();
        const del = new Set(queue.get().filter((x) => x.op === 'delseg').map((x) => x.id));
        Object.keys(segs).forEach((k) => (segs[k] = segs[k].filter((x) => !del.has(x.id))));
        drawLanes();
      }
      const tag = document.querySelector('.timer-head .tag'); if (tag) { tag.textContent = statusTr[s.status]; tag.className = 'tag ' + (s.status === 'live' ? 'g' : ''); }
    } catch (e) { /* çevrimdışı */ }
    drawBoard();
  }
  S.timers.push(setInterval(refresh, 4000));
  const ch = sb.channel('ses-' + sid).on('postgres_changes', { event: '*', schema: 'public', table: 'session_entries', filter: 'session_id=eq.' + sid }, drawBoard).subscribe();
  S.channels.push(ch);
}
register('canli', canli);
