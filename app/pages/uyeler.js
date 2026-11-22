import { register, page, go, toast } from '../core/router.js';
import { sb, q, S, errMsg } from '../core/supabase.js';
import { esc, roleTr } from '../core/format.js';

export async function uyeler() {
  if (S.role !== 'owner') return go('pano');
  const ms = await q(sb.from('org_members').select('user_id, role, status, created_at').eq('org_id', S.org.id).order('created_at'));
  const aths = await q(sb.from('athletes').select('user_id, display_name').eq('org_id', S.org.id).not('user_id', 'is', null));
  const nm = (u) => (aths.find((a) => a.user_id === u)?.display_name) || (u === S.user.id ? 'Siz' : 'Üye ' + u.slice(0, 6));
  page('Üyeler ve roller', '<div class="card"><p>Salon katılım kodu: <b class="mono">' + esc(S.org.join_code) + '</b> <button class="btn s" id="rc">Yeni kod üret</button></p><p class="small mut">Kodu alan kişi sporcu olarak katılır; antrenör veya hakem yapmak için aşağıdan rolünü değiştirin.</p></div>'
    + '<div class="card"><div class="tw"><table><thead><tr><th>Üye</th><th>Rol</th></tr></thead><tbody>' + ms.map((m) => '<tr><td>' + esc(nm(m.user_id)) + '</td><td>' + (m.role === 'owner' ? '<span class="tag o">Salon sahibi</span>' : '<select data-u="' + m.user_id + '">' + ['athlete', 'coach', 'judge'].map((r) => '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + roleTr[r] + '</option>').join('') + '</select>') + '</td></tr>').join('') + '</tbody></table></div></div>');
  document.querySelectorAll('[data-u]').forEach((s) => (s.onchange = async () => { try { await q(sb.rpc('set_member_role', { p_org: S.org.id, p_user: s.dataset.u, p_role: s.value })); toast('Rol güncellendi.'); } catch (e) { toast(errMsg(e), true); } }));
  document.getElementById('rc').onclick = async () => { if (!confirm('Eski kod geçersiz olur. Devam?')) return; try { const c = await q(sb.rpc('regenerate_join_code', { p_org: S.org.id })); S.org.join_code = c; uyeler(); } catch (e) { toast(errMsg(e), true); } };
}
register('uyeler', uyeler);
