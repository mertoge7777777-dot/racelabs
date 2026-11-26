import { register, page, toast } from '../core/router.js';
import { sb, q, S, isStaff, canRecord, publishedVersions, errMsg } from '../core/supabase.js';
import { esc, ms2, parseTime, uuid, buildPlan, refLabel } from '../core/format.js';

export async function sporcu(id) {
  const a = await q(sb.from('athletes').select('*').eq('id', id).single());
  const [stats, hist, vers, cn] = await Promise.all([q(sb.rpc('athlete_segment_stats', { p_athlete: id })), q(sb.from('athlete_profile_history').select('changed_at, old_values, new_values').eq('athlete_id', id).order('changed_at', { ascending: false }).limit(10)), publishedVersions(), isStaff() ? q(sb.from('athlete_coach_notes').select('notes').eq('athlete_id', id)) : Promise.resolve([])]);
  a.coach_notes = cn[0] ? cn[0].notes : '';
  const own = a.user_id === S.user.id;
  const fld = (k, l, type = 'text', extra = '') => '<div class="f"><label for="p_' + k + '">' + l + '</label><input id="p_' + k + '" type="' + type + '" value="' + esc(a[k] ?? '') + '" ' + extra + '></div>';
  const sel = (k, l, opts) => '<div class="f"><label for="p_' + k + '">' + l + '</label><select id="p_' + k + '"><option value="">—</option>' + opts.map(([v, t]) => '<option value="' + v + '"' + (a[k] === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>';
  const st = stats.slice().sort((x, y) => (x.ref_code > y.ref_code ? 1 : -1));
  const runs = st.filter((x) => /^run_\d+$/.test(x.ref_code)).sort((x, y) => x.ref_code.split('_')[1] - y.ref_code.split('_')[1]);
  let fatigue = '';
  const r1 = runs.find((x) => x.ref_code === 'run_1'), late = runs.filter((x) => +x.ref_code.split('_')[1] >= 5);
  if (r1 && late.length) { const avg = late.reduce((s, x) => s + x.median_ms, 0) / late.length; const pct = (avg / r1.median_ms - 1) * 100;
    fatigue = '<p class="note">Yorgunluk koşusu: 5.–8. koşuların ortancası, 1. koşuya göre <b>' + (pct >= 0 ? '%' + pct.toFixed(1) + ' yavaş' : '%' + (-pct).toFixed(1) + ' hızlı') + '</b> (' + late.length + ' koşu verisi). Yarış hedefi: %5–8 altı.</p>'; }
  const payloadOf = vers[0]?.payload;
  page(a.display_name, '<div class="grid g2"><div class="card"><h2>Profil</h2><form id="pf"><div class="grid g2">'
    + fld('display_name', 'Ad soyad', 'text', 'maxlength="80" required') + fld('birth_year', 'Doğum yılı', 'number', 'min="1920" max="2025"')
    + sel('sex', 'Cinsiyet', [['F', 'Kadın'], ['M', 'Erkek'], ['X', 'Belirtmek istemiyorum']]) + fld('division', 'Hedef kategori (ör. open_women)', 'text', 'maxlength="40"')
    + fld('height_cm', 'Boy (cm)', 'number', 'step="0.1"') + fld('weight_kg', 'Kilo (kg)', 'number', 'step="0.1"')
    + fld('training_age_years', 'Antrenman yaşı (yıl)', 'number', 'step="0.5"') + sel('hyrox_experience', 'Yarış deneyimi', [['yok', 'Yok'], ['ilk_yaris', 'İlk yarışa hazırlanıyor'], ['1_3_yaris', '1–3 yarış'], ['4_plus', '4+ yarış']])
    + '</div><div class="f"><label for="p_goals">Hedefler</label><textarea id="p_goals" maxlength="1000">' + esc(a.goals || '') + '</textarea></div>'
    + '<div class="f"><label for="p_limitations">Sakatlık / kısıtlılık</label><textarea id="p_limitations" maxlength="1000">' + esc(a.limitations || '') + '</textarea></div>'
    + (isStaff() ? '<div class="f"><label for="p_coach_notes">Antrenör notu (sporcu düzenleyemez)</label><textarea id="p_coach_notes" maxlength="4000">' + esc(a.coach_notes || '') + '</textarea></div>' : '')
    + '<label class="row" style="color:var(--tx);margin-bottom:12px"><input type="checkbox" id="p_share" style="width:22px;min-height:22px"' + (a.share_results ? ' checked' : '') + (own || isStaff() ? '' : ' disabled') + '> Adım canlı sıralamada görünsün</label>'
    + '<button class="btn p">Kaydet</button></form>'
    + (hist.length ? '<details style="margin-top:12px"><summary class="small mut">Değişiklik geçmişi (' + hist.length + ')</summary><ul class="small">' + hist.map((h) => '<li>' + new Date(h.changed_at).toLocaleString('tr-TR') + ': ' + esc(Object.keys(h.new_values).join(', ')) + '</li>').join('') + '</ul></details>' : '')
    + '</div><div><div class="card gold"><div class="k">Yarış tahmini</div><div class="f" style="margin-top:8px"><label for="pv">Format</label><select id="pv">' + vers.map((v) => '<option value="' + v.id + '">' + esc(v.race_configs?.name || 'Format') + ' · v' + v.version + (v.verified ? '' : ' (doğrulanmadı)') + '</option>').join('') + '</select></div><div id="pred" class="mut small">' + (vers.length ? 'Hesaplanıyor…' : 'Yayınlanmış format yok.') + '</div></div>'
    + '<div class="card"><h2>İstasyon ve koşu geçmişi</h2>' + fatigue + (st.length ? '<div class="tw"><table><thead><tr><th>Bölüm</th><th>En iyi</th><th>Son</th><th>Ortanca</th><th>n</th></tr></thead><tbody>' + st.map((x) => '<tr><td>' + esc(refLabel(x.ref_code, payloadOf)) + '</td><td class="mono">' + ms2(x.best_ms) + '</td><td class="mono">' + ms2(x.last_ms) + '</td><td class="mono">' + ms2(x.median_ms) + '</td><td>' + x.n + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">Henüz süre kaydı yok.</div>')
    + (canRecord() ? '<form id="mf" class="row" style="margin-top:12px"><select id="mref" style="flex:2;min-width:150px">' + (payloadOf ? buildPlan(payloadOf, false).map((p) => '<option value="' + p.ref + '|' + p.kind + '">' + esc(p.label) + '</option>').join('') : '') + '</select><input id="mt" placeholder="süre ör. 4:35" style="flex:1;min-width:110px" required><button class="btn">Antrenman sonucu ekle</button></form>' : '')
    + '</div></div></div>');
  const g = (k) => document.getElementById('p_' + k);
  document.getElementById('pf').onsubmit = async (ev) => {
    ev.preventDefault();
    const num = (k) => (g(k).value === '' ? null : Number(g(k).value)), txt = (k) => (g(k).value.trim() || null);
    const patch = { display_name: g('display_name').value.trim(), birth_year: num('birth_year'), sex: txt('sex'), division: txt('division'), height_cm: num('height_cm'), weight_kg: num('weight_kg'), training_age_years: num('training_age_years'), hyrox_experience: txt('hyrox_experience'), goals: txt('goals'), limitations: txt('limitations'), share_results: document.getElementById('p_share').checked };
    try { await q(sb.from('athletes').update(patch).eq('id', id));
      if (isStaff()) await q(sb.from('athlete_coach_notes').upsert({ athlete_id: id, org_id: S.org.id, notes: g('coach_notes').value }, { onConflict: 'athlete_id' })); toast('Kaydedildi. Eski değerler geçmişte saklandı.'); sporcu(id); } catch (e) { toast(errMsg(e), true); }
  };
  const pv = document.getElementById('pv');
  const pred = async () => {
    if (!pv || !pv.value) return; const box = document.getElementById('pred');
    try {
      const r = await q(sb.rpc('predict_race', { p_athlete: id, p_config_version: pv.value, p_track_roxzone: true }));
      const confTr = { yetersiz: ['r', 'Veri yetersiz'], dusuk: ['y', 'Düşük güven'], orta: ['g', 'Orta güven'] }[r.confidence] || ['', r.confidence];
      box.innerHTML = (r.complete ? '<div class="sc mono"><div><span class="small mut">İyimser</span><b>' + ms2(r.optimistic_ms) + '</b></div><div><span class="small mut">Gerçekçi</span><b style="color:var(--gold2)">' + ms2(r.realistic_ms) + '</b></div><div><span class="small mut">Kötümser</span><b>' + ms2(r.pessimistic_ms) + '</b></div></div>'
        : '<p>Toplam tahmin için eksik bölüm var: <b>' + r.missing.map((m) => esc(refLabel(m, payloadOf))).join(', ') + '</b></p><p class="small">Mevcut ' + r.segments_used + '/' + r.segments_total + ' bölümün ortanca toplamı: <span class="mono">' + ms2(r.partial_realistic_ms) + '</span></p>')
        + '<p style="margin:10px 0 4px"><span class="tag ' + confTr[0] + '">' + confTr[1] + '</span></p><p class="small mut">' + esc(r.method) + (r.newest_data_at ? ' En yeni veri: ' + new Date(r.newest_data_at).toLocaleDateString('tr-TR') + '.' : '') + '</p>';
    } catch (e) { box.textContent = errMsg(e); }
  };
  if (pv) { pv.onchange = pred; pred(); }
  const mf = document.getElementById('mf');
  if (mf) mf.onsubmit = async (ev) => {
    ev.preventDefault(); const dur = parseTime(document.getElementById('mt').value); if (!dur) return toast('Süreyi dakika:saniye olarak yazın (ör. 4:35).', true);
    const [ref, kind] = document.getElementById('mref').value.split('|');
    try {
      const day = new Date().toISOString().slice(0, 10), title = 'Antrenman kayıtları ' + new Date().toLocaleDateString('tr-TR');
      let s = (await q(sb.from('sessions').select('id').eq('org_id', S.org.id).eq('kind', 'training').eq('title', title).limit(1)))[0];
      if (!s) s = await q(sb.from('sessions').insert({ org_id: S.org.id, kind: 'training', title, status: 'finished', scheduled_at: day }).select('id').single());
      let e = (await q(sb.from('session_entries').select('id').eq('session_id', s.id).eq('athlete_id', id)))[0];
      if (!e) e = await q(sb.from('session_entries').insert({ session_id: s.id, org_id: S.org.id, athlete_id: id, display_name: a.display_name, status: 'finished' }).select('id').single());
      const last = await q(sb.from('segments').select('segment_index').eq('entry_id', e.id).order('segment_index', { ascending: false }).limit(1));
      await q(sb.from('segments').insert({ id: uuid(), entry_id: e.id, org_id: S.org.id, segment_index: (last[0]?.segment_index || 0) + 1, kind, ref_code: ref, duration_ms: dur, ended_at: new Date().toISOString(), source: 'manual' }));
      toast('Sonuç eklendi.'); sporcu(id);
    } catch (e) { toast(errMsg(e), true); }
  };
}
register('sporcu', sporcu);
