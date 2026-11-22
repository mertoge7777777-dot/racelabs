import { register, page, go, toast } from '../core/router.js';
import { sb, S } from '../core/supabase.js';
import { esc, ms2, roleTr } from '../core/format.js';
import { queue, FKEY } from '../core/queue.js';

export async function hesap() {
  const failed = queue.get(FKEY);
  page('Hesap', '<div class="card"><p>' + esc(S.user.email) + '</p><p class="mut small">Rol: ' + esc(roleTr[S.role]) + '</p><div class="row"><a class="btn" href="#/salon">Başka salona katıl</a><button class="btn d" id="lo">Çıkış yap</button></div></div>'
    + (failed.length ? '<div class="card"><h2>Sunucunun reddettiği kayıtlar (' + failed.length + ')</h2><div class="tw"><table><tbody>' + failed.slice(-30).reverse().map((f) => '<tr><td class="small">' + esc(new Date(f.at).toLocaleString('tr-TR')) + '</td><td>' + esc(f.op === 'seg' ? (f.row.ref_code + ' ' + ms2(f.row.duration_ms, true)) : f.op) + '</td><td class="small mut">' + esc(f.error) + '</td></tr>').join('') + '</tbody></table></div><button class="btn s" id="fc">Listeyi temizle</button></div>' : ''));
  const fc = document.getElementById('fc'); if (fc) fc.onclick = () => { queue.set([], FKEY); hesap(); };
  document.getElementById('lo').onclick = async () => {
    const n = queue.get().length;
    if (n && !confirm(n + ' kayıt henüz sunucuya gönderilmedi. Çıkış yaparsanız bu telefondan silinecek. Yine de çıkılsın mı?')) return;
    try { Object.keys(localStorage).filter((k) => k.indexOf('rl_') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    await sb.auth.signOut(); S.user = null; go('giris');
  };
}
register('hesap', hesap);
