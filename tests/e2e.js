// RaceLab uçtan uca test (gerçek Supabase projesine karşı). Kullanım: node tests/e2e.js <uygulama-adresi> <ekran-klasoru>
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8090/';
const SHOTS = process.argv[3] || '.';
const PW = 'RaceLab-Test-2026!';
const U = { sahip: 'rl-e2e-sahip@example.test', hakem: 'rl-e2e-hakem@example.test', sporcu: 'rl-e2e-sporcu@example.test' };
let fail = 0; const ok = (c, n, d) => { console.log((c ? 'GECTI ' : 'KALDI ') + n + (d ? ' — ' + d : '')); if (!c) fail++; };
const errors = [];

async function ctxFor(b, mobile) {
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'tr-TR' } : { viewport: { width: 1366, height: 860 }, locale: 'tr-TR' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('dialog', (d) => d.accept());
  return { ctx, p };
}
async function login(p, email) {
  await p.goto(BASE + '#/giris'); await p.fill('#em', email); await p.fill('#pw', PW); await p.click('#ab');
  await p.waitForFunction(() => !location.hash.includes('giris'), null, { timeout: 20000 });
}
async function consentIfAsked(p) {
  await p.waitForTimeout(800);
  if (p.url().includes('#/onay')) { await p.check('#c1'); await p.check('#c2'); await p.click('#cb'); await p.waitForFunction(() => !location.hash.includes('onay'), null, { timeout: 15000 }); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch();
  // 1) Salon sahibi: giriş, KVKK onayı, salon oluşturma
  const A = await ctxFor(b, false);
  await login(A.p, U.sahip); await consentIfAsked(A.p);
  if (A.p.url().includes('#/salon')) { await A.p.fill('#cn', 'Demo Hibrit Salon'); await A.p.click('#cf button'); }
  await A.p.waitForSelector('h1:has-text("Pano")', { timeout: 20000 });
  ok(true, 'Sahip giriş + KVKK onayı + salon oluşturma');
  const code = (await A.p.textContent('.kpi:has-text("katılım kodu") b')).trim();
  ok(/^[A-Z0-9]{8}$/.test(code), 'Salon katılım kodu üretildi', code);
  await A.p.screenshot({ path: SHOTS + '/1-pano-masaustu.png' });

  // 2) Sporcu ekleme (hesapsız)
  for (const n of ['Ayşe Koşar', 'Mehmet Kızak']) { await A.p.goto(BASE + '#/sporcular'); await A.p.fill('#nn', n); await A.p.click('#nf button'); await A.p.waitForSelector('h1:has-text("' + n + '")'); }
  ok(true, 'Antrenör 2 hesapsız sporcu ekledi');

  // 3) Sporcu kendi hesabıyla katılır, profilini düzenler
  const C = await ctxFor(b, true);
  await login(C.p, U.sporcu); await consentIfAsked(C.p);
  if (C.p.url().includes('#/salon')) { await C.p.fill('#jc', code); await C.p.fill('#jn', 'Ceren Sporcu'); await C.p.click('#jf button'); }
  await C.p.waitForSelector('h1:has-text("Pano")', { timeout: 20000 });
  ok(true, 'Sporcu kodla salona katıldı (telefon)');
  await C.p.click('a:has-text("Profilim ve tahminim")'); await C.p.waitForSelector('#pf');
  await C.p.fill('#p_weight_kg', '61.5'); await C.p.selectOption('#p_sex', 'F'); await C.p.fill('#p_division', 'open_women'); await C.p.click('#pf button.btn.p');
  await C.p.waitForTimeout(1500);
  ok(await C.p.isVisible('summary:has-text("Değişiklik geçmişi")'), 'Profil kaydedildi, eski değer geçmişte');
  ok(!(await C.p.isVisible('#p_coach_notes')), 'Sporcu antrenör notu alanını görmez');

  // 4) Hakem rolü
  const J = await ctxFor(b, true);
  await login(J.p, U.hakem); await consentIfAsked(J.p);
  if (J.p.url().includes('#/salon')) { await J.p.fill('#jc', code); await J.p.fill('#jn', 'Hakan Hakem'); await J.p.click('#jf button'); }
  await J.p.waitForSelector('h1:has-text("Pano")', { timeout: 20000 });
  await A.p.goto(BASE + '#/uyeler'); await A.p.waitForSelector('[data-u]');
  const sel = await A.p.$$('[data-u]'); for (const s of sel) { const opt = await s.evaluate((el) => el.closest('tr').textContent); if (/Hakan/.test(opt)) { await s.selectOption('judge'); await A.p.waitForTimeout(1200); } }
  ok(true, 'Sahip üyeyi hakem yaptı');

  // 5) Simülasyon oluşturma
  await A.p.goto(BASE + '#/oturumlar/yeni'); await A.p.waitForSelector('#sf');
  await A.p.fill('#st', 'E2E Cumartesi Simülasyonu');
  const boxes = await A.p.$$('[data-a]'); for (const x of boxes) await x.check();
  await A.p.click('#sf > button.btn.p'); await A.p.waitForFunction(() => location.hash.includes('#/canli/'), null, { timeout: 20000 });
  const sid = A.p.url().split('#/canli/')[1];
  ok(!!sid, 'Simülasyon oluşturuldu (3 sporcu, geçişler dahil)');
  await A.p.screenshot({ path: SHOTS + '/2-simulasyon-baslamadan.png' });

  // 6) Hakem telefonda kronometreyi yönetir
  await J.p.goto(BASE + '#/canli/' + sid); await J.p.reload(); await J.p.waitForSelector('[data-start]', { timeout: 30000 });
  await J.p.click('[data-start]'); await J.p.waitForSelector('[data-next]');
  const laneOf = (name) => J.p.locator('.lane', { hasText: name });
  // Ceren tüm parkuru bitirir (24 bölüm), Ayşe 5 bölüm, Mehmet 2 bölüm
  for (let i = 0; i < 24; i++) {
    await wait(620);
    if (i === 8) { await J.ctx.setOffline(true); }
    if (i === 12) { await J.ctx.setOffline(false); }
    await laneOf('Ceren').locator('[data-next]').click();
    if (i < 5) await laneOf('Ayşe').locator('[data-next]').click();
    if (i < 2) await laneOf('Mehmet').locator('[data-next]').click();
  }
  await J.p.screenshot({ path: SHOTS + '/3-hakem-kronometre-telefon.png', fullPage: false });
  ok(await laneOf('Ceren').locator('text=Bitirdi').isVisible(), 'Ceren 24 bölümü bitirdi (8.–12. dokunuşlar çevrimdışı)');
  // geri al
  await laneOf('Mehmet').locator('[data-undo]').click(); await wait(300);
  await J.p.waitForFunction(() => !JSON.parse(localStorage.getItem('rl_queue_v1') || '[]').length, null, { timeout: 30000 });
  ok(true, 'Çevrimdışı kuyruk boşaldı (kayıtlar sunucuya gitti)');

  // 7) Canlı sıralama (sahip ekranı ve sporcu telefonu)
  await A.p.waitForTimeout(5000);
  ok(/Bitirdi/.test(await A.p.textContent('#lanes')) && /Canlı/.test(await A.p.textContent('.timer-head')), 'Açık duran antrenör ekranı hakemin girişleriyle kendiliğinden güncellendi');
  const rows = await A.p.$$eval('#lb tr', (t) => t.map((r) => r.textContent));
  ok(rows.length === 3 && /Ceren/.test(rows[0]) && /Bitti/.test(rows[0]), 'Sıralama: bitiren ilk sırada', rows[0]);
  ok(/5\/24/.test(rows.join('|')) && /1\/24/.test(rows.join('|')), 'Ara durumlar doğru (Ayşe 5/24, Mehmet geri alma sonrası 1/24)');
  await A.p.screenshot({ path: SHOTS + '/4-canli-siralama-masaustu.png', fullPage: true });
  const [dl] = await Promise.all([A.p.waitForEvent('download', { timeout: 15000 }), A.p.click('#csv')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  const first = csv.split(/\r?\n/)[1] || '';
  ok(csv.charCodeAt(0) === 0xFEFF && /Sıra";"No";"Sporcu/.test(csv) && /Ceren/.test(first) && first.split(';').length === 7 + 24, 'CSV indirildi: Excel uyumlu, bitiren ilk satırda, 24 ara süre sütunu', dl.suggestedFilename());
  await C.p.goto(BASE + '#/canli/' + sid); await C.p.waitForTimeout(2500);
  ok((await C.p.$$('#lb tr')).length === 3 && !(await C.p.isVisible('#lanes')), 'Sporcu sıralamayı görür, kronometre düğmelerini görmez');
  await C.p.screenshot({ path: SHOTS + '/5-sporcu-siralama-telefon.png', fullPage: true });

  // 8) Tahmin (sporcu kendi profilinde)
  await C.p.goto(BASE + '#/profil'); await C.p.waitForSelector('#pred .sc, #pred p', { timeout: 20000 }); await C.p.waitForTimeout(1500);
  const pred = await C.p.textContent('#pred');
  ok(/İyimser/.test(pred) && /Gerçekçi/.test(pred) && /Düşük güven/.test(pred), 'Tahmin: 3 senaryo + "düşük güven" (tek simülasyon)', pred.replace(/\s+/g, ' ').slice(0, 120));
  await C.p.screenshot({ path: SHOTS + '/6-sporcu-tahmin-telefon.png', fullPage: true });
  // Ayşe (eksik veri): toplam verilmez
  await A.p.goto(BASE + '#/sporcular'); await A.p.click('a:has-text("Ayşe Koşar")'); await A.p.waitForSelector('#pred'); await A.p.waitForTimeout(2500);
  ok(/eksik bölüm/.test(await A.p.textContent('#pred')), 'Eksik veride toplam tahmin verilmez, eksikler listelenir');
  // elle antrenman sonucu
  await A.p.fill('#mt', '4:35'); await A.p.click('#mf button');
  ok(await A.p.waitForSelector('td:has-text("4:35")', { timeout: 15000 }).then(() => true, () => false), 'Antrenör elle antrenman sonucu ekledi (4:35)');

  // 9) Format sayfası
  await A.p.goto(BASE + '#/formatlar'); await A.p.waitForSelector('a:has-text("v1")'); await A.p.click('a:has-text("v1")'); await A.p.waitForSelector('text=SkiErg');
  ok(/doğrulanmadı/.test(await A.p.textContent('main')), 'Platform formatı "doğrulanmadı" etiketiyle görünür');
  await A.p.screenshot({ path: SHOTS + '/7-format-masaustu.png', fullPage: true });

  // 10) Telefon görünümünde yatay taşma yok
  for (const [n, P] of [['sporcu', C.p], ['hakem', J.p]]) { const r = await P.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); ok(r[0] <= r[1] + 1, n + ' telefonda yatay taşma yok', r.join('/')); }
  ok(errors.length === 0, 'Tarayıcıda JavaScript hatası yok', errors.slice(0, 3).join(' | '));
  await b.close();
  console.log(fail ? 'HATA: ' + fail : 'TUMU GECTI'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('KALDI (istisna)', e.message.split('\n')[0]); process.exit(2); });
