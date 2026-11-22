# Yerel test ortamı (Cursor ve geliştirici için)

Canlı Supabase'e dokunmadan SQL testlerini çalıştırmak için. Gerekli: PostgreSQL 16 (Ubuntu: `apt install postgresql`).

```bash
# 1) Geçici bir Postgres kümesi (örnek: /var/tmp/rl)
initdb -D /var/tmp/rl/data -A trust -U postgres
pg_ctl -D /var/tmp/rl/data -o "-p 5499 -k /var/tmp/rl" -l /var/tmp/rl/log start

# 2) Veritabanı, Supabase taklidi ve migration'lar (sırayla)
P="psql -h /var/tmp/rl -p 5499 -U postgres"
$P -c "create database rl"
$P -d rl -v ON_ERROR_STOP=1 -f tests/local/stub.sql
for f in supabase/migrations/*.sql; do $P -d rl -v ON_ERROR_STOP=1 -1 -f "$f"; done

# 3) SQL güvenlik testleri (beklenen: gecti = 57, kaldi = 0)
$P -d rl -f supabase/tests/rls_test.sql

# 4) (İsteğe bağlı) Uçtan uca test hesapları: yalnız yerel bir Supabase'de
#    ya da canlı projede TEST amaçlı; sonra temizle (bkz. CURSOR_DEVIR.md 7.3)
$P -d rl -f tests/local/create_test_users.sql
