// Supabase istemcisi (yalnız publishable/anon anahtar). service_role buraya girmez.
import { SUPABASE_URL, SUPABASE_KEY, KVKK_VERSION } from '../config.js';

const { createClient } = window.supabase; // vendor/supabase-2.45.4.js (MIT), CDN bağımlılığı yok

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
export const S = { user: null, orgs: [], org: null, role: null, consentOk: false, timers: [], channels: [], skew: 0 };
export const now = () => Date.now() + S.skew; // sunucu saatine göre düzeltilmiş an (cihazlar arası saat farkı)
export async function syncClock() { try { const t0 = Date.now(); const srv = await q(sb.rpc('server_now')); const t1 = Date.now(); S.skew = Date.parse(srv) - (t0 + t1) / 2; } catch (e) {} }

export const errMsg = (e) => (e && (e.message || e.error_description)) ? String(e.message || e.error_description).replace(/^.*?ERROR:\s*/, '') : 'Bilinmeyen hata';
export async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }

export const isStaff = () => ['owner', 'coach'].includes(S.role);
export const canRecord = () => ['owner', 'coach', 'judge'].includes(S.role);

export async function loadContext() {
  const { data: { user } } = await sb.auth.getUser(); S.user = user;
  if (!user) return;
  const m = await q(sb.from('org_members').select('org_id, role, orgs(id, name, join_code, plan)').eq('user_id', user.id).eq('status', 'active'));
  S.orgs = m.map((x) => ({ ...x.orgs, role: x.role }));
  const saved = localStorage.getItem('rl_org');
  const cur = S.orgs.find((o) => o.id === saved) || S.orgs[0] || null;
  S.org = cur; S.role = cur ? cur.role : null;
  const c = await q(sb.from('consents').select('kind, text_version, revoked_at').eq('user_id', user.id).is('revoked_at', null));
  S.consentOk = ['kvkk_aydinlatma', 'kvkk_acik_riza_saglik'].every((k) => c.some((x) => x.kind === k && x.text_version === KVKK_VERSION));
}

// Rolü antrenör/hakem/sahip olan kişinin (eski) sporcu kaydı listelerde gösterilmez; verisi silinmez.
export async function athletesOnly(list) {
  const staff = await q(sb.from('org_members').select('user_id, role').eq('org_id', S.org.id).neq('role', 'athlete'));
  const ids = new Set(staff.map((m) => m.user_id));
  return list.filter((a) => !a.user_id || !ids.has(a.user_id));
}
export async function publishedVersions() {
  return q(sb.from('race_config_versions').select('id, version, payload, verified, race_configs(name, org_id)').eq('status', 'published').order('published_at', { ascending: false }));
}
