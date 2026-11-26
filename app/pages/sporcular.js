import { register, page, go, toast } from '../core/router.js';
import { sb, q, S, isStaff, athletesOnly, errMsg } from '../core/supabase.js';
import { esc } from '../core/format.js';

export async function sporcular() {
  if (!isStaff()) return go('profil');
  const list = await athletesOnly(await q(sb.from('athletes').select('id, display_name, sex, birth_year, division, user_id, weight_kg').eq('org_id', S.org.id).order('display_name')));
  page('Sporcular', '<div class="card"><form id="nf" class="row"><input id="nn" placeholder="Yeni sporcu adı soyadı" maxlength="80" required style="flex:1;min-width:200px"><button class="btn p">Ekle</button></form><p class="small mut" style="margin:8px 0 0">Sporcular kendi hesaplarıyla da katılabilir: salon kodu <b class="mono">' + esc(S.org.join_code) + '</b></p></div>'
    + '<div class="card"><div class="tw"><table><thead><tr><th>Sporcu</th><th>Kategori</th><th>Yaş</th><th>Hesap</th></tr></thead><tbody>'
    + (list.length ? list.map((a) => '<tr><td><a href="#/sporcu/' + a.id + '">' + esc(a.display_name) + '</a></td><td>' + esc(a.division || '—') + '</td><td>' + (a.birth_year ? new Date().getFullYear() - a.birth_year : '—') + '</td><td>' + (a.user_id ? '<span class="tag g">bağlı</span>' : '<span class="tag">yok</span>') + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">Henüz sporcu yok.</td></tr>')
    + '</tbody></table></div></div>');
  document.getElementById('nf').onsubmit = async (ev) => { ev.preventDefault(); try { const a = await q(sb.from('athletes').insert({ org_id: S.org.id, display_name: document.getElementById('nn').value.trim() }).select('id').single()); go('sporcu/' + a.id); } catch (e) { toast(errMsg(e), true); } };
}
register('sporcular', sporcular);
