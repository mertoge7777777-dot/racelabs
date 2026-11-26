import { register, page, go, toast } from '../core/router.js';
import { sb, q, S, loadContext, errMsg } from '../core/supabase.js';

export async function salon() {
  page('', '<div class="auth"><div class="card" style="width:min(520px,100%)"><div class="k">Başlangıç</div><h2>Salonunuza katılın</h2>'
    + '<form id="jf"><div class="f"><label for="jc">Salon kodu (antrenörünüzden alın)</label><input id="jc" maxlength="8" autocapitalize="characters" required></div>'
    + '<div class="f"><label for="jn">Adınız soyadınız</label><input id="jn" maxlength="80" required></div><button class="btn p" style="width:100%">Katıl</button></form>'
    + '<hr style="border:0;border-top:1px solid var(--line);margin:20px 0"><h3>Salon sahibi misiniz?</h3>'
    + '<form id="cf" class="row"><input id="cn" placeholder="Salon adı" maxlength="80" required style="flex:1"><button class="btn">Salon oluştur</button></form>'
    + '<p class="small mut" style="margin-top:12px"><a href="#" id="lo">Çıkış yap</a></p></div></div>', { bare: true });
  document.getElementById('jf').onsubmit = async (ev) => { ev.preventDefault(); try { const id = await q(sb.rpc('join_org', { p_code: document.getElementById('jc').value, p_display_name: document.getElementById('jn').value })); localStorage.setItem('rl_org', id); await loadContext(); go('pano'); } catch (e) { toast(errMsg(e), true); } };
  document.getElementById('cf').onsubmit = async (ev) => { ev.preventDefault(); try { const o = await q(sb.rpc('create_org', { p_name: document.getElementById('cn').value })); localStorage.setItem('rl_org', o.id); await loadContext(); go('pano'); } catch (e) { toast(errMsg(e), true); } };
  document.getElementById('lo').onclick = async (ev) => { ev.preventDefault(); await sb.auth.signOut(); S.user = null; go('giris'); };
}
register('salon', salon);
