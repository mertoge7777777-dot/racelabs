// RaceLab — hibrit yarış (HYROX biçimli) performans uygulaması. FAZ 1 + Simülasyon Günü.
// Bağımlılık: supabase-js 2.45.4 (uygulamaya gömülü, MIT). Tüm yetki veritabanında (RLS) uygulanır.
const { createClient } = window.supabase; // vendor/supabase-2.45.4.js (MIT), CDN bağımlılığı yok
import { SUPABASE_URL, SUPABASE_KEY, APP_NAME, KVKK_VERSION } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $app = document.getElementById('app');
const S = { user: null, orgs: [], org: null, role: null, consentOk: false, timers: [], channels: [], skew: 0 };
const now = () => Date.now() + S.skew; // sunucu saatine göre düzeltilmiş an (cihazlar arası saat farkı)
async function syncClock() { try { const t0 = Date.now(); const srv = await q(sb.rpc('server_now')); const t1 = Date.now(); S.skew = Date.parse(srv) - (t0 + t1) / 2; } catch (e) {} }

// ---------------------------------------------------------------- yardımcılar
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms2 = (ms, withTenths) => {
  if (ms == null || isNaN(ms)) return '—';
  const neg = ms < 0; ms = Math.abs(Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, t = Math.floor(ms / 100) % 10;
  const core = (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0') + (withTenths ? '.' + t : '');
  return (neg ? '-' : '') + core;
};
const parseTime = (txt) => { // "4:35", "1:05:20", "275" (sn) -> ms
  const p = String(txt || '').trim().replace(',', '.').split(':').map(Number);
  if (!p.length || p.some((x) => isNaN(x) || x < 0)) return null;
  let sec = 0; for (const x of p) sec = sec * 60 + x;
  return sec > 0 ? Math.round(sec * 1000) : null;
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
const isStaff = () => ['owner', 'coach'].includes(S.role);
const canRecord = () => ['owner', 'coach', 'judge'].includes(S.role);
const roleTr = { owner: 'Salon sahibi', coach: 'Antrenör', athlete: 'Sporcu', judge: 'Hakem' };
const kindTr = { simulation: 'Simülasyon', training: 'Antrenman', test: 'Test', race: 'Yarış' };
const statusTr = { planned: 'Planlandı', live: 'Canlı', finished: 'Bitti', cancelled: 'İptal', registered: 'Bekliyor', running: 'Koşuyor', dnf: 'Bitiremedi', dq: 'Diskalifiye' };
function toast(msg, err) { const t = document.getElementById('toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 6000 : 3000); }
const errMsg = (e) => (e && (e.message || e.error_description)) ? String(e.message || e.error_description).replace(/^.*?ERROR:\s*/, '') : 'Bilinmeyen hata';
async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }
function cleanup() { S.timers.forEach(clearInterval); S.timers = []; S.channels.forEach((c) => sb.removeChannel(c)); S.channels = []; }

// Yarış planı: koşu_i, (roxzone_i), istasyon_i ...
function buildPlan(payload, trackRox) {
  const runs = payload?.runs?.count || 0, st = payload?.stations || [], n = Math.max(runs, st.length), plan = [];
  for (let i = 1; i <= n; i++) {
    if (i <= runs) plan.push({ kind: 'run', ref: 'run_' + i, label: i + '. koşu (' + ((payload.runs.distance_m || 1000) / 1000) + ' km)' });
    if (i <= st.length) {
      if (trackRox) plan.push({ kind: 'roxzone', ref: 'roxzone_' + i, label: 'Geçiş ' + i });
      const s = st[i - 1];
      plan.push({ kind: 'station', ref: s.code, label: (s.name_tr || s.code) + ' · ' + s.target + (s.metric === 'reps' ? ' tekrar' : s.metric === 'distance_m' ? ' m' : '') });
    }
  }
  return plan;
}
const refLabel = (ref, payload) => {
  if (/^run_\d+$/.test(ref)) return ref.split('_')[1] + '. koşu';
  if (/^roxzone_\d+$/.test(ref)) return 'Geçiş ' + ref.split('_')[1];
  const s = (payload?.stations || []).find((x) => x.code === ref); return s ? s.name_tr : ref;
};

// ---------------------------------------------------------------- çevrimdışı kuyruk (kronometre)
const QKEY = 'rl_queue_v1', FKEY = 'rl_failed_v1';
const queue = { get(k = QKEY) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } },
  set(a, k = QKEY) { try { localStorage.setItem(k, JSON.stringify(a)); } catch (e) {} } };
function enqueue(item) { item.qid = item.qid || uuid(); const a = queue.get(); a.push(item); queue.set(a); flush(); }
function dropFromQueue(qid) { queue.set(queue.get().filter((x) => x.qid !== qid)); }
function forgetLocalSeg(it) { // canlı ekranın telefondaki tamponundan çıkar (gönderildi ya da kesin reddedildi)
  if (!it.sid || !it.row) return; const k = 'rl_live_' + it.sid;
  try { const L = JSON.parse(localStorage.getItem(k) || '{}'); if (L.segs && L.segs[it.row.entry_id]) { L.segs[it.row.entry_id] = L.segs[it.row.entry_id].filter((x) => x.id !== it.row.id); localStorage.setItem(k, JSON.stringify(L)); } } catch (e) {}
}
// Hata sınıfı: tekrar denenir mi, başarı mı sayılır, yoksa kesin red mi?
function classify(res) {
  const e = res && res.error; if (!e) return 'ok';
  const code = String(e.code || ''), st = res.status || 0, msg = String(e.message || '');
  if (code === '23505') return 'ok';                                   // aynı kayıt zaten var (tekrar gönderim)
  if (!st || /fetch|network|Failed|Load failed|timeout/i.test(msg)) return 'retry'; // ağ yok
  if (st === 401 || /JWT|token/i.test(msg)) return 'auth';             // oturum süresi doldu: yenile, sonra tekrar
  if (st >= 500 || st === 429 || st === 408) return 'retry';           // sunucu meşgul
  return 'reject';                                                      // kural reddi (RLS, kısıt): kullanıcıya göster
}
let flushing = false;
async function flush() {
  if (flushing || !navigator.onLine) return; flushing = true;
  try {
    for (const it of queue.get()) {
      let res;
      if (it.op === 'seg') res = await sb.from('segments').upsert(it.row, { onConflict: 'id', ignoreDuplicates: true });
      else if (it.op === 'entry') res = await sb.from('session_entries').update(it.patch).eq('id', it.id);
      else if (it.op === 'session') res = await sb.from('sessions').update(it.patch).eq('id', it.id);
      else if (it.op === 'delseg') res = await sb.from('segments').delete().eq('id', it.id);
      const c = classify(res);
      if (c === 'retry') break;
      if (c === 'auth') { try { await sb.auth.refreshSession(); } catch (e) {} break; }
      if (c === 'reject') { const f = queue.get(FKEY); f.push(Object.assign({}, it, { error: String(res.error.message || ''), at: new Date().toISOString() })); queue.set(f.slice(-200), FKEY); toast('Bir kayıt sunucuda reddedildi: ' + errMsg(res.error), true); }
      if (it.op === 'seg') forgetLocalSeg(it);
      dropFromQueue(it.qid); // iki sekme açık olsa da kimlikle silinir, başka kaydı silmez
    }
  } catch (e) { /* ağ hatası: kuyrukta kalır */ } finally { flushing = false; renderNet(); }
}
addEventListener('online', flush); setInterval(flush, 5000);
function renderNet() { const el = document.getElementById('net'); if (!el) return; const n = queue.get().length, f = queue.get(FKEY).length; el.hidden = navigator.onLine && n === 0 && f === 0; el.textContent = !navigator.onLine ? 'Çevrimdışı: kayıtlar telefonda tutuluyor (' + n + '), bağlantı gelince gönderilecek.' : n ? 'Gönderiliyor: ' + n + ' kayıt…' : f ? f + ' kayıt sunucuda reddedildi (Hesap sayfasında listelenir).' : ''; }
addEventListener('offline', renderNet);

// ---------------------------------------------------------------- oturum ve yönlendirme
async function loadContext() {
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

const routes = {};
async function router() {
  cleanup();
  const [path, ...rest] = (location.hash.replace(/^#\/?/, '') || 'pano').split('/');
  if (!S.user && path !== 'giris') return go('giris');
  if (S.user && !S.consentOk && path !== 'onay') return go('onay');
  if (S.user && S.consentOk && !S.org && !['salon', 'onay'].includes(path)) return go('salon');
  const fn = routes[path] || routes.pano;
  try { await fn(...rest); } catch (e) { console.error(e); page('Hata', '<div class="card"><p>' + esc(errMsg(e)) + '</p><a class="btn" href="#/pano">Panoya dön</a></div>'); }
}
const go = (p) => { if (location.hash !== '#/' + p) location.hash = '#/' + p; else router(); };
addEventListener('hashchange', router);

const ICON = {
  pano: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
  sporcular: '<path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0"/>',
  oturumlar: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  formatlar: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  uyeler: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87"/>',
  profil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const svg = (k) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + '</svg>';
function navItems() {
  const items = [['pano', 'Pano'], ['oturumlar', 'Simülasyon'], [isStaff() ? 'sporcular' : 'profil', isStaff() ? 'Sporcular' : 'Profilim'], ['formatlar', 'Formatlar']];
  if (S.role === 'owner') items.push(['uyeler', 'Üyeler']); else items.push(['hesap', 'Hesap']);
  return items;
}
function page(title, body, opts = {}) {
  const cur = (location.hash.replace(/^#\/?/, '') || 'pano').split('/')[0];
  if (!S.user || opts.bare) { $app.innerHTML = body; return; }
  const nav = navItems();
  const orgSel = S.orgs.length > 1 ? '<select id="orgsel" aria-label="Salon seç">' + S.orgs.map((o) => '<option value="' + o.id + '"' + (S.org && o.id === S.org.id ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') + '</select>' : '';
  $app.innerHTML = '<div class="shell"><aside class="side"><div class="brand"><img src="icon.svg" alt=""><span>RACE<b>LAB</b></span></div><nav class="nav">'
    + nav.map(([k, l]) => '<a href="#/' + k + '" class="' + (cur === k ? 'on' : '') + '">' + svg(ICON[k] ? k : 'profil') + l + '</a>').join('')
    + '</nav><div class="who">' + esc(S.org ? S.org.name : '') + '<br><span class="tag o">' + esc(roleTr[S.role] || '') + '</span>' + (orgSel ? '<div style="margin-top:8px">' + orgSel + '</div>' : '') + '</div></aside>'
    + '<main class="main"><div id="net" class="netbad" hidden></div><div class="top"><div><div class="k">' + esc(S.org ? S.org.name : APP_NAME) + '</div><h1>' + esc(title) + '</h1></div><div class="row">' + (opts.actions || '') + '</div></div>' + body + '</main>'
    + '<nav class="tabbar" aria-label="Alt menü">' + nav.map(([k, l]) => '<a href="#/' + k + '" class="' + (cur === k ? 'on' : '') + '">' + svg(ICON[k] ? k : 'profil') + l + '</a>').join('') + '</nav></div>';
  const os = document.getElementById('orgsel'); if (os) os.onchange = () => { localStorage.setItem('rl_org', os.value); loadContext().then(router); };
  renderNet();
}

// ---------------------------------------------------------------- giriş, onay, salon
routes.giris = async () => {
  page('', '<div class="auth"><div class="card"><div class="brand" style="justify-content:center"><img src="icon.svg" alt=""><span>RACE<b>LAB</b></span></div>'
    + '<p class="mut small" style="text-align:center;margin-top:-6px">Hibrit yarış performans laboratuvarı</p>'
    + '<div class="tabs"><button class="btn s p" id="t1">Giriş</button><button class="btn s" id="t2">Hesap oluştur</button></div>'
    + '<form id="af"><div class="f"><label for="em">E-posta</label><input id="em" type="email" autocomplete="email" required></div>'
    + '<div class="f"><label for="pw">Şifre</label><input id="pw" type="password" autocomplete="current-password" minlength="8" required></div>'
    + '<button class="btn p" style="width:100%" id="ab">Giriş yap</button></form>'
    + '<p class="small mut" style="margin-top:12px"><a href="#" id="ml">Şifresiz giriş bağlantısı gönder</a></p></div></div>', { bare: true });
  let mode = 'in';
  const sw = (m) => { mode = m; document.getElementById('t1').className = 'btn s' + (m === 'in' ? ' p' : ''); document.getElementById('t2').className = 'btn s' + (m === 'up' ? ' p' : ''); document.getElementById('ab').textContent = m === 'in' ? 'Giriş yap' : 'Hesap oluştur'; document.getElementById('pw').autocomplete = m === 'in' ? 'current-password' : 'new-password'; };
  document.getElementById('t1').onclick = () => sw('in'); document.getElementById('t2').onclick = () => sw('up');
  document.getElementById('af').onsubmit = async (ev) => {
    ev.preventDefault(); const email = document.getElementById('em').value.trim(), password = document.getElementById('pw').value;
    try {
      if (mode === 'in') { await q(sb.auth.signInWithPassword({ email, password })); await loadContext(); go('pano'); }
      else { const d = await q(sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })); if (d.session) { await loadContext(); go('onay'); } else toast('E-postanıza doğrulama bağlantısı gönderildi.'); }
    } catch (e) { toast(errMsg(e) === 'Invalid login credentials' ? 'E-posta veya şifre hatalı.' : errMsg(e), true); }
  };
  document.getElementById('ml').onclick = async (ev) => { ev.preventDefault(); const email = document.getElementById('em').value.trim(); if (!email) return toast('Önce e-postanızı yazın.', true);
    try { await q(sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } })); toast('Giriş bağlantısı e-postanıza gönderildi.'); } catch (e) { toast(errMsg(e), true); } };
};

routes.onay = async () => {
  page('', '<div class="auth"><div class="card" style="width:min(560px,100%)"><div class="k">KVKK</div><h2>Kişisel verilerin işlenmesi</h2>'
    + '<p class="small">RaceLab; antrenman, test ve yarış simülasyonu sonuçlarınızı (süreler, nabız, yük, beden ölçüleri) salonunuzun antrenörlerinin performansınızı takip etmesi ve size program önerebilmesi için işler. Video saklanmaz. Verileriniz AB (Frankfurt) bölgesindeki sunucularda tutulur. Verilerinizin silinmesini veya dışa aktarılmasını salonunuzdan isteyebilirsiniz.</p>'
    + '<p class="note">Bu metin taslaktır; yayından önce hukuk danışmanı tarafından onaylanmalıdır (sürüm ' + esc(KVKK_VERSION) + ').</p>'
    + '<label class="row" style="margin:12px 0;color:var(--tx)"><input type="checkbox" id="c1" style="width:22px;min-height:22px"> Aydınlatma metnini okudum.</label>'
    + '<label class="row" style="margin:12px 0;color:var(--tx)"><input type="checkbox" id="c2" style="width:22px;min-height:22px"> Sağlık ve performans verilerimin bu amaçla işlenmesine açık rıza veriyorum.</label>'
    + '<button class="btn p" id="cb" style="width:100%" disabled>Onayla ve devam et</button><p class="small mut" style="margin-top:10px"><a href="#" id="lo">Çıkış yap</a></p></div></div>', { bare: true });
  const c1 = document.getElementById('c1'), c2 = document.getElementById('c2'), cb = document.getElementById('cb');
  const upd = () => (cb.disabled = !(c1.checked && c2.checked)); c1.onchange = upd; c2.onchange = upd;
  cb.onclick = async () => { try { await q(sb.from('consents').insert([{ kind: 'kvkk_aydinlatma', text_version: KVKK_VERSION }, { kind: 'kvkk_acik_riza_saglik', text_version: KVKK_VERSION }])); await loadContext(); go(S.org ? 'pano' : 'salon'); } catch (e) { toast(errMsg(e), true); } };
  document.getElementById('lo').onclick = async (ev) => { ev.preventDefault(); await sb.auth.signOut(); S.user = null; go('giris'); };
};

routes.salon = async () => {
  page('', '<div class="auth"><div class="card" style="width:min(520px,100%)"><div class="k">Başlangıç</div><h2>Salonunuza katılın</h2>'
    + '<form id="jf"><div class="f"><label for="jc">Salon kodu (antrenörünüzden alın)</label><input id="jc" maxlength="8" autocapitalize="characters" required></div>'
    + '<div class="f"><label for="jn">Adınız soyadınız</label><input id="jn" maxlength="80" required></div><button class="btn p" style="width:100%">Katıl</button></form>'
    + '<hr style="border:0;border-top:1px solid var(--line);margin:20px 0"><h3>Salon sahibi misiniz?</h3>'
    + '<form id="cf" class="row"><input id="cn" placeholder="Salon adı" maxlength="80" required style="flex:1"><button class="btn">Salon oluştur</button></form>'
    + '<p class="small mut" style="margin-top:12px"><a href="#" id="lo">Çıkış yap</a></p></div></div>', { bare: true });
  document.getElementById('jf').onsubmit = async (ev) => { ev.preventDefault(); try { const id = await q(sb.rpc('join_org', { p_code: document.getElementById('jc').value, p_display_name: document.getElementById('jn').value })); localStorage.setItem('rl_org', id); await loadContext(); go('pano'); } catch (e) { toast(errMsg(e), true); } };
  document.getElementById('cf').onsubmit = async (ev) => { ev.preventDefault(); try { const o = await q(sb.rpc('create_org', { p_name: document.getElementById('cn').value })); localStorage.setItem('rl_org', o.id); await loadContext(); go('pano'); } catch (e) { toast(errMsg(e), true); } };
  document.getElementById('lo').onclick = async (ev) => { ev.preventDefault(); await sb.auth.signOut(); S.user = null; go('giris'); };
};

routes.hesap = async () => {
  const failed = queue.get(FKEY);
  page('Hesap', '<div class="card"><p>' + esc(S.user.email) + '</p><p class="mut small">Rol: ' + esc(roleTr[S.role]) + '</p><div class="row"><a class="btn" href="#/salon">Başka salona katıl</a><button class="btn d" id="lo">Çıkış yap</button></div></div>'
    + (failed.length ? '<div class="card"><h2>Sunucunun reddettiği kayıtlar (' + failed.length + ')</h2><div class="tw"><table><tbody>' + failed.slice(-30).reverse().map((f) => '<tr><td class="small">' + esc(new Date(f.at).toLocaleString('tr-TR')) + '</td><td>' + esc(f.op === 'seg' ? (f.row.ref_code + ' ' + ms2(f.row.duration_ms, true)) : f.op) + '</td><td class="small mut">' + esc(f.error) + '</td></tr>').join('') + '</tbody></table></div><button class="btn s" id="fc">Listeyi temizle</button></div>' : ''));
  const fc = document.getElementById('fc'); if (fc) fc.onclick = () => { queue.set([], FKEY); routes.hesap(); };
  document.getElementById('lo').onclick = async () => {
    const n = queue.get().length;
    if (n && !confirm(n + ' kayıt henüz sunucuya gönderilmedi. Çıkış yaparsanız bu telefondan silinecek. Yine de çıkılsın mı?')) return;
    try { Object.keys(localStorage).filter((k) => k.indexOf('rl_') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    await sb.auth.signOut(); S.user = null; go('giris');
  };
};

// ---------------------------------------------------------------- pano
routes.pano = async () => {
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
};

// ---------------------------------------------------------------- sporcular ve profil
routes.profil = async () => {
  const me = (await q(sb.from('athletes').select('id').eq('org_id', S.org.id).eq('user_id', S.user.id)))[0];
  if (!me) return page('Profilim', '<div class="card empty">Bu salonda sporcu kaydınız yok.</div>');
  go('sporcu/' + me.id);
};
routes.sporcular = async () => {
  if (!isStaff()) return go('profil');
  const list = await athletesOnly(await q(sb.from('athletes').select('id, display_name, sex, birth_year, division, user_id, weight_kg').eq('org_id', S.org.id).order('display_name')));
  page('Sporcular', '<div class="card"><form id="nf" class="row"><input id="nn" placeholder="Yeni sporcu adı soyadı" maxlength="80" required style="flex:1;min-width:200px"><button class="btn p">Ekle</button></form><p class="small mut" style="margin:8px 0 0">Sporcular kendi hesaplarıyla da katılabilir: salon kodu <b class="mono">' + esc(S.org.join_code) + '</b></p></div>'
    + '<div class="card"><div class="tw"><table><thead><tr><th>Sporcu</th><th>Kategori</th><th>Yaş</th><th>Hesap</th></tr></thead><tbody>'
    + (list.length ? list.map((a) => '<tr><td><a href="#/sporcu/' + a.id + '">' + esc(a.display_name) + '</a></td><td>' + esc(a.division || '—') + '</td><td>' + (a.birth_year ? new Date().getFullYear() - a.birth_year : '—') + '</td><td>' + (a.user_id ? '<span class="tag g">bağlı</span>' : '<span class="tag">yok</span>') + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">Henüz sporcu yok.</td></tr>')
    + '</tbody></table></div></div>');
  document.getElementById('nf').onsubmit = async (ev) => { ev.preventDefault(); try { const a = await q(sb.from('athletes').insert({ org_id: S.org.id, display_name: document.getElementById('nn').value.trim() }).select('id').single()); go('sporcu/' + a.id); } catch (e) { toast(errMsg(e), true); } };
};

// Rolü antrenör/hakem/sahip olan kişinin (eski) sporcu kaydı listelerde gösterilmez; verisi silinmez.
async function athletesOnly(list) {
  const staff = await q(sb.from('org_members').select('user_id, role').eq('org_id', S.org.id).neq('role', 'athlete'));
  const ids = new Set(staff.map((m) => m.user_id));
  return list.filter((a) => !a.user_id || !ids.has(a.user_id));
}
async function publishedVersions() {
  return q(sb.from('race_config_versions').select('id, version, payload, verified, race_configs(name, org_id)').eq('status', 'published').order('published_at', { ascending: false }));
}

routes.sporcu = async (id) => {
  const a = await q(sb.from('athletes').select('*').eq('id', id).single());
  const [stats, hist, vers, cn] = await Promise.all([q(sb.rpc('athlete_segment_stats', { p_athlete: id })), q(sb.from('athlete_profile_history').select('changed_at, old_values, new_values').eq('athlete_id', id).order('changed_at', { ascending: false }).limit(10)), publishedVersions(), isStaff() ? q(sb.from('athlete_coach_notes').select('notes').eq('athlete_id', id)) : Promise.resolve([])]);
  a.coach_notes = cn[0] ? cn[0].notes : '';
  const own = a.user_id === S.user.id;
  const fld = (k, l, type = 'text', extra = '') => '<div class="f"><label for="p_' + k + '">' + l + '</label><input id="p_' + k + '" type="' + type + '" value="' + esc(a[k] ?? '') + '" ' + extra + '></div>';
  const sel = (k, l, opts) => '<div class="f"><label for="p_' + k + '">' + l + '</label><select id="p_' + k + '"><option value="">—</option>' + opts.map(([v, t]) => '<option value="' + v + '"' + (a[k] === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>';
  const st = stats.slice().sort((x, y) => (x.ref_code > y.ref_code ? 1 : -1));
  const runs = st.filter((x) => /^run_\d+$/.test(x.ref_code)).sort((x, y) => x.ref_code.split('_')[1] - y.ref_code.split('_')[1]);
  let fatigue = '';
  const r1 = runs.find((x) => x.ref_code === 'run_1'), late = runs.filter((x) => +x.ref_code.split('_')[1] >= 5);
  if (r1 && late.length) { const avg = late.reduce((s, x) => s + x.median_ms, 0) / late.length; const pct = (avg / r1.median_ms - 1) * 100;
    fatigue = '<p class="note">Yorgunluk koşusu: 5.–8. koşuların ortancası, 1. koşuya göre <b>' + (pct >= 0 ? '%' + pct.toFixed(1) + ' yavaş' : '%' + (-pct).toFixed(1) + ' hızlı') + '</b> (' + late.length + ' koşu verisi). Yarış hedefi: %5–8 altı.</p>'; }
  const payloadOf = vers[0]?.payload;
  page(a.display_name, '<div class="grid g2"><div class="card"><h2>Profil</h2><form id="pf"><div class="grid g2">'
    + fld('display_name', 'Ad soyad', 'text', 'maxlength="80" required') + fld('birth_year', 'Doğum yılı', 'number', 'min="1920" max="2025"')
    + sel('sex', 'Cinsiyet', [['F', 'Kadın'], ['M', 'Erkek'], ['X', 'Belirtmek istemiyorum']]) + fld('division', 'Hedef kategori (ör. open_women)', 'text', 'maxlength="40"')
    + fld('height_cm', 'Boy (cm)', 'number', 'step="0.1"') + fld('weight_kg', 'Kilo (kg)', 'number', 'step="0.1"')
    + fld('training_age_years', 'Antrenman yaşı (yıl)', 'number', 'step="0.5"') + sel('hyrox_experience', 'Yarış deneyimi', [['yok', 'Yok'], ['ilk_yaris', 'İlk yarışa hazırlanıyor'], ['1_3_yaris', '1–3 yarış'], ['4_plus', '4+ yarış']])
    + '</div><div class="f"><label for="p_goals">Hedefler</label><textarea id="p_goals" maxlength="1000">' + esc(a.goals || '') + '</textarea></div>'
    + '<div class="f"><label for="p_limitations">Sakatlık / kısıtlılık</label><textarea id="p_limitations" maxlength="1000">' + esc(a.limitations || '') + '</textarea></div>'
    + (isStaff() ? '<div class="f"><label for="p_coach_notes">Antrenör notu (sporcu düzenleyemez)</label><textarea id="p_coach_notes" maxlength="4000">' + esc(a.coach_notes || '') + '</textarea></div>' : '')
    + '<label class="row" style="color:var(--tx);margin-bottom:12px"><input type="checkbox" id="p_share" style="width:22px;min-height:22px"' + (a.share_results ? ' checked' : '') + (own || isStaff() ? '' : ' disabled') + '> Adım canlı sıralamada görünsün</label>'
    + '<button class="btn p">Kaydet</button></form>'
    + (hist.length ? '<details style="margin-top:12px"><summary class="small mut">Değişiklik geçmişi (' + hist.length + ')</summary><ul class="small">' + hist.map((h) => '<li>' + new Date(h.changed_at).toLocaleString('tr-TR') + ': ' + esc(Object.keys(h.new_values).join(', ')) + '</li>').join('') + '</ul></details>' : '')
    + '</div><div><div class="card gold"><div class="k">Yarış tahmini</div><div class="f" style="margin-top:8px"><label for="pv">Format</label><select id="pv">' + vers.map((v) => '<option value="' + v.id + '">' + esc(v.race_configs?.name || 'Format') + ' · v' + v.version + (v.verified ? '' : ' (doğrulanmadı)') + '</option>').join('') + '</select></div><div id="pred" class="mut small">' + (vers.length ? 'Hesaplanıyor…' : 'Yayınlanmış format yok.') + '</div></div>'
    + '<div class="card"><h2>İstasyon ve koşu geçmişi</h2>' + fatigue + (st.length ? '<div class="tw"><table><thead><tr><th>Bölüm</th><th>En iyi</th><th>Son</th><th>Ortanca</th><th>n</th></tr></thead><tbody>' + st.map((x) => '<tr><td>' + esc(refLabel(x.ref_code, payloadOf)) + '</td><td class="mono">' + ms2(x.best_ms) + '</td><td class="mono">' + ms2(x.last_ms) + '</td><td class="mono">' + ms2(x.median_ms) + '</td><td>' + x.n + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty">Henüz süre kaydı yok.</div>')
    + (canRecord() ? '<form id="mf" class="row" style="margin-top:12px"><select id="mref" style="flex:2;min-width:150px">' + (payloadOf ? buildPlan(payloadOf, false).map((p) => '<option value="' + p.ref + '|' + p.kind + '">' + esc(p.label) + '</option>').join('') : '') + '</select><input id="mt" placeholder="süre ör. 4:35" style="flex:1;min-width:110px" required><button class="btn">Antrenman sonucu ekle</button></form>' : '')
    + '</div></div></div>');
  const g = (k) => document.getElementById('p_' + k);
  document.getElementById('pf').onsubmit = async (ev) => {
    ev.preventDefault();
    const num = (k) => (g(k).value === '' ? null : Number(g(k).value)), txt = (k) => (g(k).value.trim() || null);
    const patch = { display_name: g('display_name').value.trim(), birth_year: num('birth_year'), sex: txt('sex'), division: txt('division'), height_cm: num('height_cm'), weight_kg: num('weight_kg'), training_age_years: num('training_age_years'), hyrox_experience: txt('hyrox_experience'), goals: txt('goals'), limitations: txt('limitations'), share_results: document.getElementById('p_share').checked };
    try { await q(sb.from('athletes').update(patch).eq('id', id));
      if (isStaff()) await q(sb.from('athlete_coach_notes').upsert({ athlete_id: id, org_id: S.org.id, notes: g('coach_notes').value }, { onConflict: 'athlete_id' })); toast('Kaydedildi. Eski değerler geçmişte saklandı.'); routes.sporcu(id); } catch (e) { toast(errMsg(e), true); }
  };
  const pv = document.getElementById('pv');
  const pred = async () => {
    if (!pv || !pv.value) return; const box = document.getElementById('pred');
    try {
      const r = await q(sb.rpc('predict_race', { p_athlete: id, p_config_version: pv.value, p_track_roxzone: true }));
      const confTr = { yetersiz: ['r', 'Veri yetersiz'], dusuk: ['y', 'Düşük güven'], orta: ['g', 'Orta güven'] }[r.confidence] || ['', r.confidence];
      box.innerHTML = (r.complete ? '<div class="sc mono"><div><span class="small mut">İyimser</span><b>' + ms2(r.optimistic_ms) + '</b></div><div><span class="small mut">Gerçekçi</span><b style="color:var(--gold2)">' + ms2(r.realistic_ms) + '</b></div><div><span class="small mut">Kötümser</span><b>' + ms2(r.pessimistic_ms) + '</b></div></div>'
        : '<p>Toplam tahmin için eksik bölüm var: <b>' + r.missing.map((m) => esc(refLabel(m, payloadOf))).join(', ') + '</b></p><p class="small">Mevcut ' + r.segments_used + '/' + r.segments_total + ' bölümün ortanca toplamı: <span class="mono">' + ms2(r.partial_realistic_ms) + '</span></p>')
        + '<p style="margin:10px 0 4px"><span class="tag ' + confTr[0] + '">' + confTr[1] + '</span></p><p class="small mut">' + esc(r.method) + (r.newest_data_at ? ' En yeni veri: ' + new Date(r.newest_data_at).toLocaleDateString('tr-TR') + '.' : '') + '</p>';
    } catch (e) { box.textContent = errMsg(e); }
  };
  if (pv) { pv.onchange = pred; pred(); }
  const mf = document.getElementById('mf');
  if (mf) mf.onsubmit = async (ev) => {
    ev.preventDefault(); const dur = parseTime(document.getElementById('mt').value); if (!dur) return toast('Süreyi dakika:saniye olarak yazın (ör. 4:35).', true);
    const [ref, kind] = document.getElementById('mref').value.split('|');
    try {
      const day = new Date().toISOString().slice(0, 10), title = 'Antrenman kayıtları ' + new Date().toLocaleDateString('tr-TR');
      let s = (await q(sb.from('sessions').select('id').eq('org_id', S.org.id).eq('kind', 'training').eq('title', title).limit(1)))[0];
      if (!s) s = await q(sb.from('sessions').insert({ org_id: S.org.id, kind: 'training', title, status: 'finished', scheduled_at: day }).select('id').single());
      let e = (await q(sb.from('session_entries').select('id').eq('session_id', s.id).eq('athlete_id', id)))[0];
      if (!e) e = await q(sb.from('session_entries').insert({ session_id: s.id, org_id: S.org.id, athlete_id: id, display_name: a.display_name, status: 'finished' }).select('id').single());
      const last = await q(sb.from('segments').select('segment_index').eq('entry_id', e.id).order('segment_index', { ascending: false }).limit(1));
      await q(sb.from('segments').insert({ id: uuid(), entry_id: e.id, org_id: S.org.id, segment_index: (last[0]?.segment_index || 0) + 1, kind, ref_code: ref, duration_ms: dur, ended_at: new Date().toISOString(), source: 'manual' }));
      toast('Sonuç eklendi.'); routes.sporcu(id);
    } catch (e) { toast(errMsg(e), true); }
  };
};

// ---------------------------------------------------------------- oturumlar
routes.oturumlar = async (sub) => {
  if (sub === 'yeni') return newSession();
  const list = await q(sb.from('sessions').select('id, title, kind, status, created_at, track_roxzone').eq('org_id', S.org.id).order('created_at', { ascending: false }).limit(50));
  page('Oturumlar', '<div class="card"><div class="tw"><table><thead><tr><th>Oturum</th><th>Tür</th><th>Durum</th><th>Tarih</th></tr></thead><tbody>'
    + (list.length ? list.map((s) => '<tr><td><a href="#/canli/' + s.id + '">' + esc(s.title) + '</a></td><td>' + esc(kindTr[s.kind]) + '</td><td><span class="tag ' + (s.status === 'live' ? 'g' : s.status === 'finished' ? 'o' : '') + '">' + esc(statusTr[s.status]) + '</span></td><td class="mut small">' + new Date(s.created_at).toLocaleDateString('tr-TR') + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">Henüz oturum yok.</td></tr>')
    + '</tbody></table></div></div>', { actions: isStaff() ? '<a class="btn p" href="#/oturumlar/yeni">Yeni simülasyon</a>' : '' });
};

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

// ---------------------------------------------------------------- canlı: kronometre + sıralama
routes.canli = async (sid) => {
  const s = await q(sb.from('sessions').select('*, race_config_versions(payload)').eq('id', sid).single());
  const payload = s.race_config_versions?.payload;
  const plan = payload ? buildPlan(payload, s.track_roxzone) : [];
  const rec = canRecord() && s.kind !== 'training';
  let entries = [], segs = {};
  const LKEY = 'rl_live_' + sid; // yerel tampon: çevrimdışı dokunuşlar
  const local = () => { try { return JSON.parse(localStorage.getItem(LKEY) || '{}'); } catch (e) { return {}; } };
  const saveLocal = (o) => { try { localStorage.setItem(LKEY, JSON.stringify(o)); } catch (e) {} };

  async function loadAll() {
    if (rec) {
      entries = await q(sb.from('session_entries').select('*').eq('session_id', sid).order('wave').order('bib'));
      const rows = entries.length ? await q(sb.from('segments').select('id, entry_id, segment_index, duration_ms, ref_code').in('entry_id', entries.map((e) => e.id)).order('segment_index')) : [];
      segs = {}; rows.forEach((r) => (segs[r.entry_id] = segs[r.entry_id] || []).push(r));
      const L = local(); // sunucuya henüz gitmemiş yerel dokunuşları ekle
      Object.entries(L.segs || {}).forEach(([eid, arr]) => { const have = new Set((segs[eid] || []).map((x) => x.id)); arr.forEach((x) => { if (!have.has(x.id)) (segs[eid] = segs[eid] || []).push(x); }); (segs[eid] || []).sort((a, b) => a.segment_index - b.segment_index); });
      Object.entries(L.starts || {}).forEach(([eid, t]) => { const e = entries.find((x) => x.id === eid); if (e && !e.started_at) { e.started_at = t; e.status = 'running'; } });
    }
  }
  await Promise.all([loadAll(), syncClock()]);
  const waves = [...new Set(entries.map((e) => e.wave))].sort((a, b) => a - b);
  const exportBtns = rec ? '<button class="btn s" id="csv">CSV (Excel)</button><button class="btn s" id="prt">Yazdır</button>' : '';
  const actions = exportBtns + (rec ? (s.status !== 'finished' ? waves.map((w) => '<button class="btn p s" data-start="' + w + '">' + (waves.length > 1 ? w + '. dalgayı' : 'Herkesi') + ' başlat</button>').join('') + '<button class="btn s" id="fin">Oturumu bitir</button>' : '') : '');
  page(s.title, '<div class="timer-head"><div class="row" style="justify-content:space-between"><div><span class="tag ' + (s.status === 'live' ? 'g' : '') + '">' + esc(statusTr[s.status]) + '</span> <span class="small mut">' + esc(kindTr[s.kind]) + ' · ' + plan.length + ' bölüm' + (s.track_roxzone ? ' (geçişler dahil)' : '') + '</span></div><div class="clock mono" id="clk">' + ms2(0) + '</div></div></div>'
    + (rec ? '<div class="lanes" id="lanes"></div>' : '') + '<div class="card" style="margin-top:14px"><h2>Canlı sıralama</h2><div class="tw"><table class="lb"><thead><tr><th>#</th><th>Sporcu</th><th>Kategori</th><th>Bölüm</th><th>Süre</th></tr></thead><tbody id="lb"><tr><td colspan="5" class="empty">Yükleniyor…</td></tr></tbody></table></div><p class="small mut">Sıralama her birkaç saniyede bir güncellenir.</p></div>', { actions });

  const firstStart = () => entries.map((e) => e.started_at && Date.parse(e.started_at)).filter(Boolean).sort()[0];
  function laneHtml(e) {
    const done = segs[e.id] || [], i = done.length, cur = plan[i], fin = e.status === 'finished' || i >= plan.length;
    const elapsed = done.reduce((t, x) => t + x.duration_ms, 0);
    const since = e.started_at ? now() - Date.parse(e.started_at) - elapsed : 0;
    return '<div class="lane' + (fin ? ' fin' : '') + '" data-e="' + e.id + '"><div class="nm"><span>#' + esc(e.bib ?? '') + ' ' + esc(e.display_name) + '</span><span class="tag">' + esc(e.division_code || '') + '</span></div>'
      + '<div class="bar"><i style="width:' + Math.round((i / Math.max(1, plan.length)) * 100) + '%"></i></div>'
      + '<div class="seg">' + (fin ? '<b>Bitirdi</b>' : e.started_at ? 'Şu an: <b>' + esc(cur ? cur.label : '') + '</b>' : 'Başlamadı') + '</div>'
      + '<div class="row" style="justify-content:space-between"><span class="t mono" data-tick="' + e.id + '">' + (fin ? ms2(e.total_ms || elapsed, true) : e.started_at ? ms2(since, true) : '—') + '</span><span class="small mut mono">Toplam ' + ms2(elapsed) + '</span></div>'
      + (fin ? '' : e.started_at ? '<button class="btn p go" data-next="' + e.id + '">' + esc(cur ? cur.label : '') + ' bitti →</button>' : '<button class="btn go" data-solo="' + e.id + '">Tek başlat</button>')
      + (done.length && !fin ? '<button class="btn s" data-undo="' + e.id + '">Son dokunuşu geri al</button>' : '') + (!fin && e.started_at ? '<button class="btn s d" data-dnf="' + e.id + '">Bitiremedi</button>' : '') + '</div>';
  }
  function drawLanes() { const el = document.getElementById('lanes'); if (el) el.innerHTML = entries.map(laneHtml).join('') || '<div class="card empty">Bu oturumda sporcu yok.</div>'; }
  function startEntries(list) {
    const t = new Date(now()).toISOString(), L = local(); L.starts = L.starts || {};
    list.forEach((e) => { if (e.started_at) return; e.started_at = t; e.status = 'running'; L.starts[e.id] = t; enqueue({ op: 'entry', id: e.id, patch: { started_at: t, status: 'running' } }); });
    saveLocal(L);
    if (s.status !== 'live') { s.status = 'live'; enqueue({ op: 'session', id: sid, patch: { status: 'live', started_at: t } }); const tg = document.querySelector('.timer-head .tag'); if (tg) { tg.textContent = statusTr.live; tg.className = 'tag g'; } }
    drawLanes();
  }
  if (rec) {
    drawLanes();
    document.getElementById('lanes').addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const id = b.dataset.next || b.dataset.solo || b.dataset.undo || b.dataset.dnf, e = entries.find((x) => x.id === id); if (!e) return;
      if (b.dataset.solo) return startEntries([e]);
      const done = segs[e.id] = segs[e.id] || [], L = local(); L.segs = L.segs || {}; L.segs[e.id] = L.segs[e.id] || [];
      if (b.dataset.next) {
        const i = done.length, p = plan[i]; if (!p) return;
        const tnow = now(), elapsed = done.reduce((t, x) => t + x.duration_ms, 0), dur = tnow - Date.parse(e.started_at) - elapsed;
        if (dur < 500) return; // çift dokunma koruması
        const row = { id: uuid(), entry_id: e.id, org_id: S.org.id, segment_index: i + 1, kind: p.kind, ref_code: p.ref, duration_ms: Math.round(dur), ended_at: new Date(tnow).toISOString(), source: 'timer' };
        done.push(row); L.segs[e.id].push(row); saveLocal(L); enqueue({ op: 'seg', row, sid });
        if (navigator.vibrate) navigator.vibrate(30);
        if (done.length >= plan.length) { const total = elapsed + Math.round(dur); e.status = 'finished'; e.total_ms = total; enqueue({ op: 'entry', id: e.id, patch: { status: 'finished', finished_at: new Date(tnow).toISOString(), total_ms: total } }); }
      } else if (b.dataset.undo) {
        const last = done.pop(); if (!last) return; L.segs[e.id] = L.segs[e.id].filter((x) => x.id !== last.id); saveLocal(L); enqueue({ op: 'delseg', id: last.id });
      } else if (b.dataset.dnf) {
        if (!confirm(e.display_name + ' bitiremedi olarak işaretlensin mi?')) return; e.status = 'dnf'; enqueue({ op: 'entry', id: e.id, patch: { status: 'dnf' } });
      }
      drawLanes(); drawBoard();
    });
    document.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => startEntries(entries.filter((e) => e.wave === +b.dataset.start))));
    const fin = document.getElementById('fin');
    if (fin) fin.onclick = () => { if (!confirm('Oturum bitirilsin mi?')) return; enqueue({ op: 'session', id: sid, patch: { status: 'finished', finished_at: new Date().toISOString() } }); s.status = 'finished'; toast('Oturum bitirildi.'); setTimeout(() => routes.canli(sid), 600); };
  }
  // Sonuç dışa aktarma: sıra, sporcu, kategori, durum, toplam + her bölümün ara süresi (Excel Türkçe için ; ayraç + BOM).
  function exportCsv() {
    const rows = entries.slice().sort((a, b) => { const fa = a.status === 'finished', fb = b.status === 'finished'; if (fa !== fb) return fa ? -1 : 1; const ta = a.total_ms || (segs[a.id] || []).reduce((t, x) => t + x.duration_ms, 0), tb = b.total_ms || (segs[b.id] || []).reduce((t, x) => t + x.duration_ms, 0); return fa ? ta - tb : ((segs[b.id] || []).length - (segs[a.id] || []).length) || ta - tb; });
    const q2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const head = ['Sıra', 'No', 'Sporcu', 'Kategori', 'Dalga', 'Durum', 'Toplam'].concat(plan.map((p) => p.label));
    const lines = [head.map(q2).join(';')];
    rows.forEach((e, i) => { const d = segs[e.id] || []; const tot = e.total_ms || d.reduce((t, x) => t + x.duration_ms, 0);
      lines.push([i + 1, e.bib ?? '', e.display_name, e.division_code || '', e.wave, statusTr[e.status] || e.status, ms2(tot, true)].concat(plan.map((p, k) => { const x = d.find((y) => y.segment_index === k + 1); return x ? ms2(x.duration_ms, true) : ''; })).map(q2).join(';')); });
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (s.title || 'simulasyon').replace(/[^\wçğıöşüÇĞİÖŞÜ -]+/g, '').trim().replace(/\s+/g, '-') + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  if (rec) { const c = document.getElementById('csv'), pr = document.getElementById('prt'); if (c) c.onclick = exportCsv; if (pr) pr.onclick = () => window.print(); }
  async function drawBoard() {
    const el = document.getElementById('lb'); if (!el) return;
    try {
      const rows = await q(sb.rpc('session_leaderboard', { p_session: sid }));
      el.innerHTML = rows.length ? rows.map((r, i) => '<tr class="' + (r.is_me ? 'me' : '') + '"><td>' + (i + 1) + '</td><td>' + esc(r.name) + (r.bib ? ' <span class="mut small">#' + r.bib + '</span>' : '') + '</td><td>' + esc(r.division_code || '') + '</td><td>' + (r.status === 'finished' ? '<span class="tag g">Bitti</span>' : r.status === 'dnf' ? '<span class="tag r">DNF</span>' : r.segments_done + '/' + plan.length + (r.last_ref ? ' <span class="mut small">' + esc(refLabel(r.last_ref, payload)) + '</span>' : '')) + '</td><td class="mono">' + ms2(r.total_ms || r.elapsed_ms) + '</td></tr>').join('') : '<tr><td colspan="5" class="empty">Sporcu yok.</td></tr>';
    } catch (e) { /* çevrimdışı: son tablo kalır */ }
  }
  drawBoard();
  S.timers.push(setInterval(() => {
    const t0 = firstStart(); const c = document.getElementById('clk'); if (c && t0 && s.status !== 'finished') c.textContent = ms2(now() - t0, true);
    document.querySelectorAll('[data-tick]').forEach((el) => { const e = entries.find((x) => x.id === el.dataset.tick); if (!e || !e.started_at || e.status === 'finished' || e.status === 'dnf') return; const el2 = (segs[e.id] || []).reduce((t, x) => t + x.duration_ms, 0); el.textContent = ms2(now() - Date.parse(e.started_at) - el2, true); });
  }, 100));
  // Birden çok cihaz (ör. iki hakem) aynı oturumu yönetebilir: şeritler de düzenli tazelenir.
  // Henüz gönderilmemiş yerel dokunuşlar korunur; silinmek üzere kuyruktaki ara süreler gösterilmez.
  async function refresh() {
    if (document.hidden) return;
    try {
      const fresh = await q(sb.from('sessions').select('status').eq('id', sid).single()); s.status = fresh.status;
      if (rec) {
        await loadAll();
        const del = new Set(queue.get().filter((x) => x.op === 'delseg').map((x) => x.id));
        Object.keys(segs).forEach((k) => (segs[k] = segs[k].filter((x) => !del.has(x.id))));
        drawLanes();
      }
      const tag = document.querySelector('.timer-head .tag'); if (tag) { tag.textContent = statusTr[s.status]; tag.className = 'tag ' + (s.status === 'live' ? 'g' : ''); }
    } catch (e) { /* çevrimdışı */ }
    drawBoard();
  }
  S.timers.push(setInterval(refresh, 4000));
  const ch = sb.channel('ses-' + sid).on('postgres_changes', { event: '*', schema: 'public', table: 'session_entries', filter: 'session_id=eq.' + sid }, drawBoard).subscribe();
  S.channels.push(ch);
};

// ---------------------------------------------------------------- formatlar
routes.formatlar = async (vid) => {
  if (vid) return formatDetail(vid);
  const cfgs = await q(sb.from('race_configs').select('id, code, name, season, org_id, race_config_versions(id, version, status, verified)').order('created_at'));
  page('Yarış formatları', '<p class="note">Kurallar koda yazılmaz; her format sürümlenir. Yayınlanan sürüm değiştirilemez, böylece eski sonuçlar kendi kurallarıyla kalır.</p>'
    + cfgs.map((c) => '<div class="card"><div class="row" style="justify-content:space-between"><div><h3>' + esc(c.name) + '</h3><span class="small mut">' + (c.org_id ? 'Salonunuza özel' : 'Platform formatı') + (c.season ? ' · ' + esc(c.season) : '') + '</span></div></div><div class="row" style="margin-top:8px">'
      + (c.race_config_versions || []).sort((a, b) => a.version - b.version).map((v) => '<a class="btn s" href="#/formatlar/' + v.id + '">v' + v.version + ' <span class="tag ' + (v.status === 'published' ? (v.verified ? 'g' : 'y') : '') + '">' + (v.status === 'published' ? (v.verified ? 'yayında' : 'yayında, doğrulanmadı') : 'taslak') + '</span></a>').join('') + '</div></div>').join('') || '<div class="card empty">Format yok.</div>');
};

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

// ---------------------------------------------------------------- üyeler (salon sahibi)
routes.uyeler = async () => {
  if (S.role !== 'owner') return go('pano');
  const ms = await q(sb.from('org_members').select('user_id, role, status, created_at').eq('org_id', S.org.id).order('created_at'));
  const aths = await q(sb.from('athletes').select('user_id, display_name').eq('org_id', S.org.id).not('user_id', 'is', null));
  const nm = (u) => (aths.find((a) => a.user_id === u)?.display_name) || (u === S.user.id ? 'Siz' : 'Üye ' + u.slice(0, 6));
  page('Üyeler ve roller', '<div class="card"><p>Salon katılım kodu: <b class="mono">' + esc(S.org.join_code) + '</b> <button class="btn s" id="rc">Yeni kod üret</button></p><p class="small mut">Kodu alan kişi sporcu olarak katılır; antrenör veya hakem yapmak için aşağıdan rolünü değiştirin.</p></div>'
    + '<div class="card"><div class="tw"><table><thead><tr><th>Üye</th><th>Rol</th></tr></thead><tbody>' + ms.map((m) => '<tr><td>' + esc(nm(m.user_id)) + '</td><td>' + (m.role === 'owner' ? '<span class="tag o">Salon sahibi</span>' : '<select data-u="' + m.user_id + '">' + ['athlete', 'coach', 'judge'].map((r) => '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + roleTr[r] + '</option>').join('') + '</select>') + '</td></tr>').join('') + '</tbody></table></div></div>');
  document.querySelectorAll('[data-u]').forEach((s) => (s.onchange = async () => { try { await q(sb.rpc('set_member_role', { p_org: S.org.id, p_user: s.dataset.u, p_role: s.value })); toast('Rol güncellendi.'); } catch (e) { toast(errMsg(e), true); } }));
  document.getElementById('rc').onclick = async () => { if (!confirm('Eski kod geçersiz olur. Devam?')) return; try { const c = await q(sb.rpc('regenerate_join_code', { p_org: S.org.id })); S.org.join_code = c; routes.uyeler(); } catch (e) { toast(errMsg(e), true); } };
};

// ---------------------------------------------------------------- başlat
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { S.user = null; } });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => { try { await loadContext(); } catch (e) { console.error(e); } router(); flush(); })();
