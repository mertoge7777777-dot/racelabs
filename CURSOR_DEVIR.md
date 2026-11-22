# RaceLab — Cursor'a Devir Dokümanı

Bu belge, RaceLab'ın (HYROX biçimli hibrit yarış modülü) bugünkü durumunu ve sonraki adımları anlatır. Cursor ile geliştirmeye başlamadan önce oku.

## 1. Ne var?

- **Veritabanı:** Supabase (Postgres + RLS). Şema `supabase/migrations/` içinde 6 dosya, sırayla uygulanır. Canlı proje uygulandı.
- **Uygulama:** `app/` — saf HTML/CSS/JS PWA (derleme adımı yok). Bağımlılık: `app/vendor/supabase-2.45.4.js` (MIT, gömülü).
- **Testler:**
  - `supabase/tests/rls_test.sql` — 57 güvenlik ve iş kuralı testi. Tek işlemde çalışır, sonunda geri alır.
  - `tests/e2e.js` — Playwright ile 22 adımlı uçtan uca prova (gerçek Supabase'e karşı). Test hesapları gerekir.

## 2. Mimari (kısa)

| Katman | Dosya | Not |
|---|---|---|
| Yetki | RLS politikaları + `app.*` fonksiyonları | Yetki her zaman veritabanında. Arayüz gizlemesi güvenlik değildir. |
| Salon/rol | `orgs`, `org_members`, `create_org`, `join_org`, `set_member_role` | Roller: owner, coach, athlete, judge |
| Sporcu | `athletes`, `athlete_profile_history`, `athlete_coach_notes` | Antrenör notu ayrı tabloda, sporcu okuyamaz |
| Yarış formatı | `race_configs`, `race_config_versions` | Yayınlanan sürüm değişmez. Payload: runs, stations, divisions |
| Oturum | `sessions`, `session_entries`, `segments` | `segments.id` istemci UUID'si: çift kayıt olmaz |
| Analiz | `session_leaderboard`, `athlete_segment_stats`, `predict_race` | Tahmin v1 istatistiksel, garanti değil |
| Arayüz | `app/app.js` tek dosya (~650 satır) | Router: `#/pano`, `#/canli/<id>`, `#/sporcu/<id>`, ... |
| Çevrimdışı | `localStorage` kuyruğu (`rl_queue_v1`) | Hata sınıflandırma: `classify()`; reddedilenler `rl_failed_v1` |

## 3. Yerel geliştirme

Adım adım kurulum: `tests/local/README.md` (stub, migration, test hesapları).

```bash
# 1) Statik sunucu
cd app && python3 -m http.server 8090

# 2) Yerel Postgres ile RLS testi (Supabase benzeri stub gerekir; bkz. KURULUM rehberi)
psql -d rl -f supabase/tests/rls_test.sql

# 3) Uçtan uca (canlı Supabase'e yazar! önce test hesaplarını hazırla)
node tests/e2e.js http://127.0.0.1:8090/ ./tests/ekran
```

- `app/config.js` içindeki anahtar **publishable/anon** anahtarıdır; tarayıcıda durması güvenlidir. `service_role` anahtarı repoda **olmamalı**; asla ekleme.

## 4. Kurallar (değiştirme)

1. Yayınlanmış format sürümü değişmez; düzeltme yeni sürüm olur (`new_race_config_version`).
2. Yeni kural = yeni migration dosyası. Eski migration'ı düzenleme.
3. Her yeni yetki kuralına RLS testi ekle. `rls_test.sql` hepsi geçmeden birleştirme yok.
4. Arayüze eklenen her kullanıcı metni `esc()` ile kaçışlanır.

## 5. Açık işler (öncelik sırasıyla)

**A. Güvenlik (denetçi bulguları, bekliyor):**
- Lisans/deneme sistemi için fikir denetimi 4 açık buldu. Düzeltmeler yapılmadı:
  1. Askıdaki salon (`plan='askida'`) deneme süresi sürerken yazmaya devam edebiliyor. Kural: `plan <> 'askida'` şartı formüle girmeli.
  2. Faturalama notu, `orgs` satırında olursa sahibe sızar. Ayrı `org_billing` tablosu, yalnız platform admin.
  3. Süresi geçmiş salonda `finished` oturum `planned`'a çekilip değiştirilebiliyor; `planned` oturuma sporcu eklenebiliyor. Kilit yalnız `sessions`/`session_entries` yazmalarına tetikleyiciyle uygulanmalı.
  4. Platform admin RPC'leri (`admin_list_orgs`, `admin_set_plan`) için `is_platform_admin` kontrolü, `search_path=''`, `public/anon` execute geri alma.
- Kod denetimi (ikinci tur) yarıda kaldı; kalan bulgular bu listeye eklenecek.

**B. Ürün:**
- Lisans / deneme süresi (30 gün), platform yönetim paneli, salt okunur mod. Fikir planı hazır, onaylanmadı.
- Doubles / Relay takım simülasyonu.
- Salon markası (logo) ve yarış günü TV ekranı (büyük canlı sıralama).
- Kamera ile hareket analizi: MergeSport'taki AthleteLab motoru (`/home/user/mu/mergesport-athletelab-olcum.php`) squat, lunge ve wall ball için uyarlanabilir.

**C. Veri ve içerik:**
- Yarış formatı v1'de kategori yükleri boş ve "doğrulanmadı". Resmî 2026/27 kural kitabından yükler girilip v2 yayınlanmalı.
- KVKK aydınlatma metni taslak; avukat onayı gerekli.

**D. Yayın:**
- Şu an yalnız geliştirme ortamında. Üretim için: Hostinger'da `racelab/` klasörü veya ayrı alan adı, Supabase Site URL ve Redirect URL ayarı, SMTP (e-posta) ayarı. Ayrıntı: `KURULUM_VE_SATIS_REHBERI.md`.

## 6. Bilinen sınırlar

- Gerçek iPhone ve Android cihazlarında henüz denenmedi (yalnız tarayıcı benzetimi).
- Dört sayfa dışında erişilebilirlik (ekran okuyucu, klavye) denetlenmedi.
- `app.js` tek dosya ve büyüdü; Cursor'da bölmek iyi bir ilk iş olabilir (router, sayfalar, kuyruk, canlı ekran).

## 7. İlk görev önerisi (Cursor)

1. Açık işler A-1 ile A-4'ü, her biri için RLS testi yazarak uygula.
2. Ardından `app.js` içindeki canlı ekranı (`routes.canli`) ayrı modüle taşı; davranışı `tests/e2e.js` ile koru.
