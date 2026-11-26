import { register, page, go, toast } from '../core/router.js';
import { sb, q, S, errMsg } from '../core/supabase.js';
import { esc } from '../core/format.js';

export async function formatlar(vid) {
  if (vid) return formatDetail(vid);
  const cfgs = await q(sb.from('race_configs').select('id, code, name, season, org_id, race_config_versions(id, version, status, verified)').order('created_at'));
  page('Yarış formatları', '<p class="note">Kurallar koda yazılmaz; her format sürümlenir. Yayınlanan sürüm değiştirilemez, böylece eski sonuçlar kendi kurallarıyla kalır.</p>'
    + cfgs.map((c) => '<div class="card"><div class="row" style="justify-content:space-between"><div><h3>' + esc(c.name) + '</h3><span class="small mut">' + (c.org_id ? 'Salonunuza özel' : 'Platform formatı') + (c.season ? ' · ' + esc(c.season) : '') + '</span></div></div><div class="row" style="margin-top:8px">'
      + (c.race_config_versions || []).sort((a, b) => a.version - b.version).map((v) => '<a class="btn s" href="#/formatlar/' + v.id + '">v' + v.version + ' <span class="tag ' + (v.status === 'published' ? (v.verified ? 'g' : 'y') : '') + '">' + (v.status === 'published' ? (v.verified ? 'yayında' : 'yayında, doğrulanmadı') : 'taslak') + '</span></a>').join('') + '</div></div>').join('') || '<div class="card empty">Format yok.</div>');
}
register('formatlar', formatlar);

async function formatDetail(vid) {
  const v = await q(sb.from('race_config_versions').select('*, race_configs(id, name, org_id, code)').eq('id', vid).single());
  const p = v.payload || {}, cfg = v.race_configs;
  const { data: canManage } = await sb.rpc('can_manage_config_ui', { p_config: cfg.id }).then((r) => r, () => ({ data: false }));
  const editable = v.status === 'draft' && (canManage || (cfg.org_id && S.role === 'owner'));
  const loadKeys = [...new Set((p.stations || []).flatMap((s) => [s.load_key, s.extra_key].filter(Boolean)))];
  page(cfg.name + ' · v' + v.version, '<div class="card"><span class="tag ' + (v.status === 'published' ? (v.verified ? 'g' : 'y') : '') + '">' + (v.status === 'published' ? (v.verified ? 'Yayında · doğrulandı' : 'Yayında · doğrulanmadı') : 'Taslak') + '</span>'
    + (v.verified_note ? '<p class="small mut">Doğrulama notu: ' + esc(v.verified_note) + '</p>' : '') + (p.rules_note ? '<p class="note">' + esc(p.rules_note) + '</p>' : '')
    + '<p>' + esc(Number(p.runs?.count) || 0) + ' × ' + esc((Number(p.runs?.distance_m) || 0) / 1000) + ' km koşu</p><div class="tw"><table><thead><tr><th>#</th><th>İstasyon</th><th>Hedef</th></tr></thead><tbody>'
    + (p.stations || []).map((s, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(s.name_tr || s.code) + '</td><td>' + (editable ? '<input type="number" min="1" data-tgt="' + i + '" value="' + esc(s.target) + '" style="width:110px"> ' : esc(s.target) + ' ') + (s.metric === 'reps' ? 'tekrar' : s.metric === 'distance_m' ? 'm' : esc(s.metric)) + '</td></tr>').join('') + '</tbody></table></div></div>'
    + '<div class="card"><h2>Kategoriler ve yükler</h2><div class="tw"><table><thead><tr><th>Kategori</th>' + loadKeys.map((k) => '<th>' + esc(k) + '</th>').join('') + '</tr></thead><tbody>'
    + (p.divisions || []).map((d, i) => '<tr><td>' + esc(d.label) + '</td>' + loadKeys.map((k) => '<td>' + (editable ? '<input type="number" step="0.5" min="0" data-load="' + i + '|' + k + '" value="' + esc(d.loads?.[k] ?? '') + '" style="width:90px">' : esc(d.loads?.[k] ?? '—')) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>'
    + (editable ? '<div class="card"><div class="f"><label for="vn">Doğrulama notu (resmî kural kitabı sürümü / bağlantısı). Boş bırakılırsa "doğrulanmadı" olarak yayınlanır.</label><input id="vn" maxlength="1000"></div><div class="row"><button class="btn" id="sv">Taslağı kaydet</button><button class="btn p" id="pb">Yayınla (geri alınamaz)</button></div></div>' : '')
    + (v.status === 'published' && (canManage || (cfg.org_id && S.role === 'owner')) ? '<div class="card"><h3>Yeni sürüm</h3><p class="small mut">Yayınlanmış sürüm değişmez. Ağırlıkları veya hedefleri güncellemek için bu sürümden bir taslak (v' + (v.version + 1) + ') açın, düzenleyip yayınlayın; eski sonuçlar eski sürüme bağlı kalır.</p><button class="btn" id="nv">Yeni sürüm taslağı aç</button></div>' : '')
    + (v.status === 'published' && S.role === 'owner' ? '<div class="card"><h3>Salonuma kopyala</h3><form id="cp" class="row"><input id="cpn" placeholder="Ör. Salon kısa simülasyon" maxlength="120" required style="flex:1"><button class="btn">Kopyala ve düzenle</button></form></div>' : ''));
  if (editable) {
    const collect = () => { const np = JSON.parse(JSON.stringify(p)); document.querySelectorAll('[data-tgt]').forEach((el) => (np.stations[+el.dataset.tgt].target = Number(el.value))); document.querySelectorAll('[data-load]').forEach((el) => { const [i, k] = el.dataset.load.split('|'); np.divisions[+i].loads = np.divisions[+i].loads || {}; if (el.value === '') delete np.divisions[+i].loads[k]; else np.divisions[+i].loads[k] = Number(el.value); }); return np; };
    document.getElementById('sv').onclick = async () => { try { await q(sb.from('race_config_versions').update({ payload: collect() }).eq('id', vid)); toast('Taslak kaydedildi.'); } catch (e) { toast(errMsg(e), true); } };
    document.getElementById('pb').onclick = async () => { if (!confirm('Yayınlanan sürüm bir daha değiştirilemez. Devam?')) return; try { await q(sb.from('race_config_versions').update({ payload: collect() }).eq('id', vid)); await q(sb.rpc('publish_race_config_version', { p_version: vid, p_verified_note: document.getElementById('vn').value || null })); toast('Yayınlandı.'); formatDetail(vid); } catch (e) { toast(errMsg(e), true); } };
  }
  const nvb = document.getElementById('nv');
  if (nvb) nvb.onclick = async () => { try { const d = await q(sb.rpc('new_race_config_version', { p_config: cfg.id })); go('formatlar/' + d.id); } catch (e) { toast(errMsg(e), true); } };
  const cp = document.getElementById('cp');
  if (cp) cp.onsubmit = async (ev) => { ev.preventDefault(); const name = document.getElementById('cpn').value.trim(); const code = (name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'salon').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
    try { const c = await q(sb.rpc('copy_race_config_to_org', { p_version: vid, p_org: S.org.id, p_code: code, p_name: name })); const nv = await q(sb.from('race_config_versions').select('id').eq('config_id', c.id).single()); go('formatlar/' + nv.id); } catch (e) { toast(errMsg(e), true); } };
}
