import { register, page } from '../core/router.js';
import { sb, q, S, isStaff } from '../core/supabase.js';
import { esc, kindTr, statusTr } from '../core/format.js';

export async function pano() {
  const sessions = await q(sb.from('sessions').select('id, title, kind, status, created_at').eq('org_id', S.org.id).order('created_at', { ascending: false }).limit(6));
  let kpi = '';
  if (isStaff()) {
    const { count: na } = await sb.from('athletes').select('id', { count: 'exact', head: true }).eq('org_id', S.org.id);
    const live = sessions.filter((s) => s.status === 'live').length;
    kpi = '<div class="grid g4"><div class="card kpi"><b>' + (na || 0) + '</b><span>Sporcu</span></div><div class="card kpi"><b>' + sessions.length + '</b><span>Son oturum</span></div><div class="card kpi"><b>' + live + '</b><span>Canlı oturum</span></div><div class="card kpi"><b class="mono">' + esc(S.org.join_code || '—') + '</b><span>Salon katılım kodu</span></div></div>';
  }
  const me = !isStaff() ? (await q(sb.from('athletes').select('id').eq('org_id', S.org.id).eq('user_id', S.user.id)))[0] : null;
  page('Pano', kpi
    + '<div class="card gold"><div class="k">Simülasyon günü</div><h2>Yarış provası, canlı sıralama, tahmin</h2><p class="mut small">8 × 1 km koşu + 8 istasyon. Her sporcunun koşu, geçiş ve istasyon süreleri ayrı ayrı kaydedilir; bağlantı koparsa kayıtlar telefonda tutulur.</p>'
    + '<div class="row">' + (isStaff() ? '<a class="btn p" href="#/oturumlar/yeni">Yeni simülasyon</a>' : '') + '<a class="btn" href="#/oturumlar">Oturumlar</a>' + (me ? '<a class="btn" href="#/sporcu/' + me.id + '">Profilim ve tahminim</a>' : '') + '</div></div>'
    + '<div class="card"><h2>Son oturumlar</h2>' + (sessions.length ? '<div class="tw"><table><tbody>' + sessions.map((s) => '<tr><td><a href="#/canli/' + s.id + '">' + esc(s.title) + '</a></td><td>' + esc(kindTr[s.kind]) + '</td><td><span class="tag ' + (s.status === 'live' ? 'g' : s.status === 'finished' ? 'o' : '') + '">' + esc(statusTr[s.status]) + '</span></td><td class="mut small">' + new Date(s.created_at).toLocaleDateString('tr-TR') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">Henüz oturum yok.</div>') + '</div>');
}
register('pano', pano);
