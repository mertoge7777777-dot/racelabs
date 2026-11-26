import { register, page, go, toast } from '../core/router.js';
import { sb, q, S, isStaff, athletesOnly, publishedVersions, errMsg } from '../core/supabase.js';
import { esc, kindTr, statusTr } from '../core/format.js';

export async function oturumlar(sub) {
  if (sub === 'yeni') return newSession();
  const list = await q(sb.from('sessions').select('id, title, kind, status, created_at, track_roxzone').eq('org_id', S.org.id).order('created_at', { ascending: false }).limit(50));
  page('Oturumlar', '<div class="card"><div class="tw"><table><thead><tr><th>Oturum</th><th>Tür</th><th>Durum</th><th>Tarih</th></tr></thead><tbody>'
    + (list.length ? list.map((s) => '<tr><td><a href="#/canli/' + s.id + '">' + esc(s.title) + '</a></td><td>' + esc(kindTr[s.kind]) + '</td><td><span class="tag ' + (s.status === 'live' ? 'g' : s.status === 'finished' ? 'o' : '') + '">' + esc(statusTr[s.status]) + '</span></td><td class="mut small">' + new Date(s.created_at).toLocaleDateString('tr-TR') + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">Henüz oturum yok.</td></tr>')
    + '</tbody></table></div></div>', { actions: isStaff() ? '<a class="btn p" href="#/oturumlar/yeni">Yeni simülasyon</a>' : '' });
}
register('oturumlar', oturumlar);

async function newSession() {
  if (!isStaff()) return go('oturumlar');
  const [vers, aths0] = await Promise.all([publishedVersions(), q(sb.from('athletes').select('id, display_name, division, user_id').eq('org_id', S.org.id).order('display_name'))]);
  const aths = await athletesOnly(aths0);
  if (!vers.length) return page('Yeni simülasyon', '<div class="card"><p>Yayınlanmış yarış formatı yok.</p><p class="mut small">Platform formatı doğrulanıp yayınlanınca ya da salonunuza özel bir format yayınlayınca simülasyon başlatabilirsiniz.</p><a class="btn" href="#/formatlar">Formatlar</a></div>');
  const divs = (vid) => (vers.find((v) => v.id === vid)?.payload?.divisions || []);
  page('Yeni simülasyon', '<form id="sf"><div class="card grid g2"><div class="f"><label for="st">Başlık</label><input id="st" value="Simülasyon ' + new Date().toLocaleDateString('tr-TR') + '" maxlength="120" required></div>'
    + '<div class="f"><label for="sv">Yarış formatı</label><select id="sv">' + vers.map((v) => '<option value="' + v.id + '">' + esc(v.race_configs?.name) + ' · v' + v.version + (v.verified ? '' : ' (doğrulanmadı)') + '</option>').join('') + '</select></div>'
    + '<label class="row" style="color:var(--tx)"><input type="checkbox" id="sr" checked style="width:22px;min-height:22px"> Geçiş (Roxzone) sürelerini ayrı ölç</label></div>'
    + '<div class="card"><h2>Sporcular</h2><p class="small mut">Göğüs numarası ve kategori seçin. Dalga (wave) aynı anda başlayan gruptur.</p><div class="tw"><table><thead><tr><th></th><th>Sporcu</th><th>No</th><th>Kategori</th><th>Dalga</th></tr></thead><tbody id="ab">'
    + aths.map((a, i) => '<tr><td><input type="checkbox" data-a="' + a.id + '" style="width:22px;min-height:22px"></td><td>' + esc(a.display_name) + '</td><td><input type="number" min="1" max="9999" value="' + (i + 1) + '" data-bib style="width:80px"></td><td><select data-div style="min-width:140px"></select></td><td><input type="number" min="1" max="50" value="1" data-wave style="width:70px"></td></tr>').join('')
    + '</tbody></table></div>' + (aths.length ? '' : '<div class="empty">Önce <a href="#/sporcular">sporcu ekleyin</a>.</div>') + '</div><button class="btn p">Oturumu oluştur</button></form>');
  const sv = document.getElementById('sv');
  const fillDivs = () => document.querySelectorAll('[data-div]').forEach((s, i) => { const ad = aths[i]?.division; s.innerHTML = divs(sv.value).map((d) => '<option value="' + esc(d.code) + '"' + (ad === d.code ? ' selected' : '') + '>' + esc(d.label) + '</option>').join(''); });
  sv.onchange = fillDivs; fillDivs();
  document.getElementById('sf').onsubmit = async (ev) => {
    ev.preventDefault();
    const rows = [...document.querySelectorAll('#ab tr')].filter((tr) => tr.querySelector('[data-a]').checked);
    if (!rows.length) return toast('En az bir sporcu seçin.', true);
    const bibs = rows.map((tr) => +tr.querySelector('[data-bib]').value); if (new Set(bibs).size !== bibs.length) return toast('Göğüs numaraları benzersiz olmalı.', true);
    try {
      const s = await q(sb.from('sessions').insert({ org_id: S.org.id, kind: 'simulation', title: document.getElementById('st').value.trim(), config_version_id: sv.value, track_roxzone: document.getElementById('sr').checked, status: 'planned' }).select('id').single());
      await q(sb.from('session_entries').insert(rows.map((tr) => ({ session_id: s.id, org_id: S.org.id, athlete_id: tr.querySelector('[data-a]').dataset.a, display_name: '', bib: +tr.querySelector('[data-bib]').value, division_code: tr.querySelector('[data-div]').value || null, wave: +tr.querySelector('[data-wave]').value || 1 }))));
      go('canli/' + s.id);
    } catch (e) { toast(errMsg(e), true); }
  };
}
