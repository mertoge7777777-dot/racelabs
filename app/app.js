// RaceLab — hibrit yarış (HYROX biçimli) performans uygulaması. FAZ 1 + Simülasyon Günü.
// Bağımlılık: supabase-js 2.45.4 (uygulamaya gömülü, MIT). Tüm yetki veritabanında (RLS) uygulanır.
// Modüller: core/supabase.js, core/router.js, core/queue.js, core/format.js, pages/*.js.
import { sb, S, loadContext } from './core/supabase.js';
import { router } from './core/router.js';
import { flush } from './core/queue.js';
import './pages/giris.js';
import './pages/onay.js';
import './pages/salon.js';
import './pages/hesap.js';
import './pages/pano.js';
import './pages/profil.js';
import './pages/sporcular.js';
import './pages/sporcu.js';
import './pages/oturumlar.js';
import './pages/canli.js';
import './pages/formatlar.js';
import './pages/uyeler.js';

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { S.user = null; } });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => { try { await loadContext(); } catch (e) { console.error(e); } router(); flush(); })();
