-- Jalankan melalui Supabase SQL Editor untuk menambahkan instrumen awal
-- pada database yang sudah pernah menjalankan schema.sql.
insert into public.alat_musik (nama_alat, harga_sewa_per_hari, denda_per_hari)
select seed.nama_alat, seed.harga_sewa_per_hari, seed.denda_per_hari
from (values
  ('Biola', 70000, 20000),
  ('Ukulele', 35000, 10000),
  ('Cajon', 65000, 18000),
  ('Saksofon', 150000, 40000),
  ('Trompet', 125000, 35000),
  ('Seruling', 30000, 8000),
  ('Ampli Gitar', 75000, 20000),
  ('Speaker Aktif', 100000, 25000)
) as seed(nama_alat, harga_sewa_per_hari, denda_per_hari)
where not exists (
  select 1 from public.alat_musik a where a.nama_alat = seed.nama_alat
);
