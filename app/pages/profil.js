import { register, page, go } from '../core/router.js';
import { sb, q, S } from '../core/supabase.js';

export async function profil() {
  const me = (await q(sb.from('athletes').select('id').eq('org_id', S.org.id).eq('user_id', S.user.id)))[0];
  if (!me) return page('Profilim', '<div class="card empty">Bu salonda sporcu kaydınız yok.</div>');
  go('sporcu/' + me.id);
}
register('profil', profil);
