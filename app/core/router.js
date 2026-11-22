// Hash yönlendirme ve sayfa kabuğu. Sayfalar register() ile bağlanır.
import { APP_NAME } from '../config.js';
import { S, sb, isStaff, loadContext, errMsg } from './supabase.js';
import { esc, roleTr } from './format.js';
import { renderNet } from './queue.js';

const $app = document.getElementById('app');
const routes = {};
export function register(name, fn) { routes[name] = fn; }

function cleanup() { S.timers.forEach(clearInterval); S.timers = []; S.channels.forEach((c) => sb.removeChannel(c)); S.channels = []; }

export async function router() {
  cleanup();
  const [path, ...rest] = (location.hash.replace(/^#\/?/, '') || 'pano').split('/');
  if (!S.user && path !== 'giris') return go('giris');
  if (S.user && !S.consentOk && path !== 'onay') return go('onay');
  if (S.user && S.consentOk && !S.org && !['salon', 'onay'].includes(path)) return go('salon');
  const fn = routes[path] || routes.pano;
  try { await fn(...rest); } catch (e) { console.error(e); page('Hata', '<div class="card"><p>' + esc(errMsg(e)) + '</p><a class="btn" href="#/pano">Panoya dön</a></div>'); }
}
export const go = (p) => { if (location.hash !== '#/' + p) location.hash = '#/' + p; else router(); };
addEventListener('hashchange', router);

export function toast(msg, err) { const t = document.getElementById('toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 6000 : 3000); }

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
export function page(title, body, opts = {}) {
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
