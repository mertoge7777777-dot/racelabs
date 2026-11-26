import { register, page, go, toast } from '../core/router.js';
import { sb, S } from '../core/supabase.js';
import { esc, ms2, roleTr } from '../core/format.js';
import { queue, FKEY, QUEUE_STALE_MS, queueAgeSummary, formatQueueAge, clearStaleQueue } from '../core/queue.js';

export async function hesap() {
  const failed = queue.get(FKEY);
  const age = queueAgeSummary();
  const threshLabel = formatQueueAge(QUEUE_STALE_MS);
  let queueBlock = '';
  if (age.total) {
    queueBlock = '<div class="card"><h2>' + esc('Gönderim kuyruğu') + '</h2>'
      + '<p class="small">' + esc(String(age.total) + ' kayıt bekliyor'
        + (age.oldestMs ? ' · en eskisi ' + formatQueueAge(age.oldestMs) : ''))
      + '</p>'
      + (age.stale
        ? '<div class="netbad" role="alert">'
          + esc('Kuyruk yaşı uyarısı: ' + age.stale + ' kayıt ' + threshLabel + ' eşiğini aştı (en eskisi ' + formatQueueAge(age.oldestMs) + '). Bu bir kayıp değil gecikmedir; sürekli tekrar denenen bir hata kuyruğu bekletebilir.')
          + '</div>'
          + '<button type="button" class="btn d s" id="cq">' + esc('Sıkışmış kayıtları temizle') + '</button>'
        : '<p class="small mut">' + esc('Yeni kayıtlar bağlantı gelince sırayla gönderilir.') + '</p>')
      + '</div>';
  }
  page('Hesap', '<div class="card"><p>' + esc(S.user.email) + '</p><p class="mut small">' + esc('Rol: ') + esc(roleTr[S.role]) + '</p><div class="row"><a class="btn" href="#/salon">' + esc('Başka salona katıl') + '</a><button class="btn d" id="lo">' + esc('Çıkış yap') + '</button></div></div>'
    + queueBlock
    + (failed.length ? '<div class="card"><h2>' + esc('Sunucunun reddettiği kayıtlar (' + failed.length + ')') + '</h2><div class="tw"><table><tbody>' + failed.slice(-30).reverse().map((f) => '<tr><td class="small">' + esc(new Date(f.at).toLocaleString('tr-TR')) + '</td><td>' + esc(f.op === 'seg' ? (f.row.ref_code + ' ' + ms2(f.row.duration_ms, true)) : f.op) + '</td><td class="small mut">' + esc(f.error) + '</td></tr>').join('') + '</tbody></table></div><button class="btn s" id="fc">' + esc('Listeyi temizle') + '</button></div>' : ''));
  const fc = document.getElementById('fc'); if (fc) fc.onclick = () => { queue.set([], FKEY); hesap(); };
  const cq = document.getElementById('cq');
  if (cq) cq.onclick = () => {
    const before = queueAgeSummary();
    if (!before.stale) { hesap(); return; }
    const msg = before.stale + ' sıkışmış kayıt kuyruktan silinecek. Son ' + threshLabel + ' içinde eklenen kayıtlar kalır. Devam?';
    if (!confirm(msg)) return;
    const n = clearStaleQueue();
    toast(n ? (n + ' sıkışmış kayıt temizlendi.') : 'Temizlenecek sıkışmış kayıt yok.');
    hesap();
  };
  document.getElementById('lo').onclick = async () => {
    const n = queue.get().length;
    if (n && !confirm(n + ' kayıt henüz sunucuya gönderilmedi. Çıkış yaparsanız bu telefondan silinecek. Yine de çıkılsın mı?')) return;
    try { Object.keys(localStorage).filter((k) => k.indexOf('rl_') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    await sb.auth.signOut(); S.user = null; go('giris');
  };
}
register('hesap', hesap);
