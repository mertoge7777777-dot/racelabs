# RaceLab (HYROX biçimli hibrit yarış modülü) — Kurulum ve Satış Rehberi

**Durum (21.11.2026):**
- **Veritabanı:** Supabase projesi `racelab` (Frankfurt) **canlı ve hazır**. 6 şema dosyası uygulandı (6.: bağımsız denetim düzeltmeleri).
- **Testler:** 57 güvenlik/iş kuralı testi ve 22 adımlı uçtan uca prova **geçti** (gerçek veritabanında).
- **Uygulama:** `app/` klasörü — telefona kurulabilen web uygulaması (PWA). **Henüz hiçbir yere yüklenmedi.**

---

## 1. Uygulamayı yayına alma (yaklaşık 10 dakika)

1. Hostinger **Dosya Yöneticisi** veya FTP ile `public_html/` içinde `racelab` adında bir klasör aç.
2. Paketteki **`app/` klasörünün İÇİNDEKİ** tüm dosyaları oraya yükle: `index.html`, `app.js`, `styles.css`, `config.js`, `sw.js`, `manifest.webmanifest`, `icon.svg` ve `vendor/` klasörü.
3. Tarayıcıda **https://mergesport.com/racelab/** adresini aç; giriş ekranı gelmeli.
   - Uygulama HTTPS ister. Hostinger'da SSL zaten açık.
4. **Supabase panelinde** (supabase.com → racelab projesi) şu iki ayarı yap:
   - **Authentication → URL Configuration → Site URL:** `https://mergesport.com/racelab/`
   - **Redirect URLs:** aynı adresi ekle.

   Bunu yapmazsan e-postadaki doğrulama ve şifresiz giriş bağlantıları yanlış adrese gider.
5. **E-posta gönderimi:** Supabase'in yerleşik e-postası saatte yalnız birkaç e-posta gönderir. Satışa çıkmadan önce şunu ayarla: **Authentication → Emails → SMTP Settings**. Buraya Hostinger e-posta hesabının bilgilerini gir (ör. `noreply@mergesport.com`, smtp.hostinger.com, port 465).
   - Yalnız demo yapacaksan alternatif: **Authentication → Providers → Email → "Confirm email"** seçeneğini geçici olarak kapat.

## 2. Kendini platform yöneticisi yap (bir kez)

1. **https://mergesport.com/racelab/** adresinden kendi e-postanla hesap oluştur.
2. Bana "hesabımı açtım" yaz; seni platform yöneticisi yaparım.
   - Ya da Supabase → SQL Editor'da şunu çalıştır (e-postanı yaz):

   ```sql
   insert into public.platform_admins (user_id) select id from auth.users where email = 'SENIN-EPOSTAN';
   ```
3. Platform yöneticisi olarak **Formatlar → Hibrit yarış — standart format → v1 → "Yeni sürüm taslağı aç"** yolunu izle.
   - Resmî 2026/27 kural kitabındaki ağırlıkları (kızak itme/çekme, çiftçi taşıma, kum torbası, wall ball) kategori kategori gir.
   - "Doğrulama notu" alanına kural kitabının sürümünü yaz ve **Yayınla**.
   - Yayınlanan sürüm bir daha değişmez. Eski sonuçlar eski sürüme bağlı kalır.

## 3. Bir salona satış ve ilk kullanım (salon sahibinin yapacakları)

| Adım | Kim | Ne yapar |
|---|---|---|
| 1 | Salon sahibi | Hesap açar → KVKK onayı → **"Salon oluştur"**. Panoda 8 haneli **salon kodu** görünür. |
| 2 | Sporcu | Hesap açar → salon kodunu girer → salona katılır. Hesabı olmayan sporcuları antrenör de ekleyebilir. |
| 3 | Salon sahibi | **Üyeler** bölümünde antrenör ve hakemlerin rolünü değiştirir. |
| 4 | Antrenör | **Simülasyon → Yeni simülasyon:** format seçer, sporcuları, göğüs numarasını, kategoriyi ve dalgayı belirler. |
| 5 | Hakem (telefon) | **Herkesi başlat** ya da dalga dalga başlatır. Her sporcu bir bölümü bitirince o sporcunun kartındaki büyük düğmeye dokunur. **İnternet koparsa kayıtlar telefonda tutulur, bağlantı gelince kendiliğinden gider.** |
| 6 | Herkes | **Canlı sıralama** herkesin telefonunda kendiliğinden güncellenir. Sporcu isterse adını gizler ("Sporcu #7" görünür). |
| 7 | Sporcu / antrenör | Sporcu profilinde: istasyon ve koşu geçmişi, yorgunluk koşusu analizi, **yarış tahmini** (iyimser / gerçekçi / kötümser + güven düzeyi). |

**Telefona kurma:**
- **iPhone:** Safari → Paylaş → "Ana Ekrana Ekle".
- **Android:** Chrome → menü → "Uygulamayı yükle".

## 4. Satış konuşması için gerçek özellikler (abartmadan)

- **Simülasyon Günü yönetimi:** 8 × 1 km koşu + 8 istasyon + geçiş (Roxzone) süreleri, sporcu başına ayrı ayrı. Çoklu sporcu ve dalgalı başlangıç desteklenir; birden çok hakem aynı yarışı birlikte yönetebilir.
- **Çevrimdışı çalışan kronometre:** Salonun interneti koptuğunda kayıp olmaz.
- **Canlı sıralama:** Sporcuların telefonunda güncellenir; isim gizleme seçeneği var.
- **Açıklamalı yarış tahmini:** Hangi verilere dayandığını, eksik bölümleri ve güven düzeyini gösterir. **Garanti vermez.**
- **Sürümlü yarış formatları:** Kural değişse de eski sonuçlar bozulmaz. Salon kendi kısa simülasyon formatını oluşturabilir.
- **Salon verileri birbirinden tamamen ayrı:** Veritabanı düzeyinde ayrılır ve 57 otomatik testle sınanmıştır.
- **KVKK:** Açık rıza ekranı, değişiklik geçmişi, denetim kaydı. Video saklanmaz.

**Söylenmemesi gerekenler:**
- "Resmî HYROX uygulaması", "HYROX onaylı" gibi ifadeler (marka izni yok).
- Tahminlerin "kesin" olduğu (v1 basit istatistik; daha çok veriyle iyileşir).

## 5. Bilinen sınırlar ve sıradaki adımlar

| Konu | Durum |
|---|---|
| Uygulama gerçek telefonda | Telefon tarayıcısı benzetimiyle test edildi; **gerçek iPhone/Android'de henüz denenmedi**. İlk yüklemeden sonra bir simülasyon provası yap. |
| Kategori ağırlıkları | v1'de boş ("doğrulanmadı"). Resmî kural kitabından girilip v2 yayınlanmalı (Bölüm 2). |
| KVKK metni | Taslak; avukat onayı gerekli. Veriler AB'de (Frankfurt): yurt dışı aktarım yükümlülüklerini hukukçuya sor. |
| Supabase ücretsiz plan | 1 hafta hiç kullanılmazsa proje duraklar; satışta **Pro (~25 $/ay)** önerilir. |
| Ad | "RaceLab" çalışma adı; marka araştırması yapılmalı. |
| Ödeme / abonelik | Salonlardan ücret alma (aylık lisans) henüz yok; sonraki faz. |
| Sonraki fazlar | Kamera ile hareket analizi (AthleteLab motorundan), antrenman motoru, ADS gelişim skoru, Doubles/Relay, MergeSport köprüsü. |

## 6. Teknik bilgiler (geliştirici için)

- **Supabase projesi:** `mgywdeoxkssvpkhiircj` (eu-central-1)
- **Şema:** `supabase/migrations/` içinde 6 dosya, sırayla uygulandı.
- **Testler:**
  - `supabase/tests/rls_test.sql` — tek işlemde çalışır, sonunda geri alır; 57/57.
  - `tests/e2e.js` — gerçek veritabanına karşı 22 adım: `node tests/e2e.js https://adres/racelab/ ekran-klasoru`. Test hesapları gerekir.
- **Güvenlik:**
  - Uygulamadaki anahtar "anon/publishable" anahtardır; tarayıcıda durması güvenlidir.
  - Yetkiyi veritabanındaki RLS kuralları uygular.
  - `service_role` anahtarı hiçbir dosyada yok.
- **Bağımlılık:** supabase-js 2.45.4 (MIT), `app/vendor/` içine gömülü; dış CDN yok.
