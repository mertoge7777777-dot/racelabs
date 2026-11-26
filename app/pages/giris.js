import { register, page, go, toast } from '../core/router.js';
import { sb, q, loadContext, errMsg } from '../core/supabase.js';

export async function giris() {
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
}
register('giris', giris);
