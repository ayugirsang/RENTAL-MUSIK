-- Data demo: 7 transaksi penyewaan dengan variasi kasus.
-- Target periode: September-November 2026.
-- Jalankan sekali di Supabase SQL Editor setelah schema, triggers, dan migrasi
-- pembayaran/damage handling sudah diterapkan.

do $$
declare
  v_pelanggan bigint;
  v_sewa bigint;
  v_pengembalian bigint;
  v_gitar bigint;
  v_keyboard bigint;
  v_mic bigint;
  v_drum bigint;
  v_bass bigint;
  v_cajon bigint;
  v_biola bigint;
  v_ukulele bigint;
  v_saksofon bigint;
begin
  -- Kasus 1: Gitar Akustik, tepat waktu, dibayar tunai penuh.
  select id_alat into v_gitar from public.alat_musik where nama_alat = 'Gitar Akustik' limit 1;
  if v_gitar is not null and not exists (
    select 1 from public.penyewaan p
    join public.pelanggan c on c.id_pelanggan = p.id_pelanggan
    where c.nama = 'Dimas Aditya' and p.tgl_sewa = date '2026-09-05'
  ) then
    insert into public.pelanggan (nama, no_hp, alamat)
    values ('Dimas Aditya', '081234560001', 'Jl. Melati No. 12, Medan')
    returning id_pelanggan into v_pelanggan;

    select public.buat_penyewaan(v_pelanggan, date '2026-09-05', date '2026-09-08',
      jsonb_build_array(jsonb_build_object('id_alat', v_gitar, 'jumlah', 1)))
    into v_sewa;

    insert into public.pembayaran_sewa (id_sewa, tgl_bayar, jumlah_bayar, metode_bayar)
    values (v_sewa, date '2026-09-05', 150000, 'Tunai');

    insert into public.pengembalian (id_sewa, tgl_kembali_aktual)
    values (v_sewa, date '2026-09-08')
    returning id_pengembalian into v_pengembalian;
  end if;

  -- Kasus 2: Keyboard + mikrofon, pembayaran cicilan dua kali.
  select id_alat into v_keyboard from public.alat_musik where nama_alat = 'Keyboard 61 Key' limit 1;
  select id_alat into v_mic from public.alat_musik where nama_alat = 'Mikrofon Wireless' limit 1;
  if v_keyboard is not null and v_mic is not null and not exists (
    select 1 from public.penyewaan p
    join public.pelanggan c on c.id_pelanggan = p.id_pelanggan
    where c.nama = 'Nadia Putri' and p.tgl_sewa = date '2026-09-18'
  ) then
    insert into public.pelanggan (nama, no_hp, alamat)
    values ('Nadia Putri', '081234560002', 'Jl. Kenanga No. 8, Medan')
    returning id_pelanggan into v_pelanggan;

    select public.buat_penyewaan(v_pelanggan, date '2026-09-18', date '2026-09-23',
      jsonb_build_array(
        jsonb_build_object('id_alat', v_keyboard, 'jumlah', 1),
        jsonb_build_object('id_alat', v_mic, 'jumlah', 1)))
    into v_sewa;

    insert into public.pembayaran_sewa (id_sewa, tgl_bayar, jumlah_bayar, metode_bayar)
    values
      (v_sewa, date '2026-09-18', 500000, 'Transfer'),
      (v_sewa, date '2026-09-23', 325000, 'QRIS');

    insert into public.pengembalian (id_sewa, tgl_kembali_aktual)
    values (v_sewa, date '2026-09-23');
  end if;

  -- Kasus 3: Drum terlambat 4 hari dan denda dibayar sebagian.
  select id_alat into v_drum from public.alat_musik where nama_alat = 'Drum Set' limit 1;
  if v_drum is not null and not exists (
    select 1 from public.penyewaan p
    join public.pelanggan c on c.id_pelanggan = p.id_pelanggan
    where c.nama = 'Bima Saputra' and p.tgl_sewa = date '2026-10-03'
  ) then
    insert into public.pelanggan (nama, no_hp, alamat)
    values ('Bima Saputra', '081234560003', 'Jl. Mawar No. 21, Medan')
    returning id_pelanggan into v_pelanggan;

    select public.buat_penyewaan(v_pelanggan, date '2026-10-03', date '2026-10-05',
      jsonb_build_array(jsonb_build_object('id_alat', v_drum, 'jumlah', 1)))
    into v_sewa;

    insert into public.pembayaran_sewa (id_sewa, tgl_bayar, jumlah_bayar, metode_bayar)
    values (v_sewa, date '2026-10-03', 400000, 'Tunai');

    insert into public.pengembalian (id_sewa, tgl_kembali_aktual)
    values (v_sewa, date '2026-10-09')
    returning id_pengembalian into v_pengembalian;

    insert into public.pembayaran_denda (id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar)
    values (v_pengembalian, date '2026-10-09', 100000, 'Tunai');
  end if;

  -- Kasus 4: Gitar + bass terlambat dan alat rusak ringan.
  select id_alat into v_gitar from public.alat_musik where nama_alat = 'Gitar Akustik' limit 1;
  select id_alat into v_bass from public.alat_musik where nama_alat = 'Bass Elektrik' limit 1;
  if v_gitar is not null and v_bass is not null and not exists (
    select 1 from public.penyewaan p
    join public.pelanggan c on c.id_pelanggan = p.id_pelanggan
    where c.nama = 'Salsa Rahma' and p.tgl_sewa = date '2026-10-12'
  ) then
    insert into public.pelanggan (nama, no_hp, alamat)
    values ('Salsa Rahma', '081234560004', 'Jl. Anggrek No. 33, Medan')
    returning id_pelanggan into v_pelanggan;

    select public.buat_penyewaan(v_pelanggan, date '2026-10-12', date '2026-10-15',
      jsonb_build_array(
        jsonb_build_object('id_alat', v_gitar, 'jumlah', 1),
        jsonb_build_object('id_alat', v_bass, 'jumlah', 1)))
    into v_sewa;

    insert into public.pembayaran_sewa (id_sewa, tgl_bayar, jumlah_bayar, metode_bayar)
    values (v_sewa, date '2026-10-12', 390000, 'Transfer');

    insert into public.pengembalian
      (id_sewa, tgl_kembali_aktual, kondisi_alat, biaya_kerusakan, catatan_kerusakan)
    values
      (v_sewa, date '2026-10-17', 'Rusak Ringan', 150000,
       'Jack gitar longgar dan senar harus diganti')
    returning id_pengembalian into v_pengembalian;

    insert into public.pembayaran_denda (id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar)
    values (v_pengembalian, date '2026-10-17', 80000, 'QRIS');

    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'pembayaran_kerusakan'
    ) then
      insert into public.pembayaran_kerusakan
        (id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar)
      values (v_pengembalian, date '2026-10-20', 50000, 'Transfer');
    end if;
  end if;

  -- Kasus 5: Cajon masih berlangsung dan belum ada pembayaran.
  select id_alat into v_cajon from public.alat_musik where nama_alat = 'Cajon' limit 1;
  if v_cajon is not null and not exists (
    select 1 from public.penyewaan p
    join public.pelanggan c on c.id_pelanggan = p.id_pelanggan
    where c.nama = 'Raka Pratama' and p.tgl_sewa = date '2026-10-25'
  ) then
    insert into public.pelanggan (nama, no_hp, alamat)
    values ('Raka Pratama', '081234560005', 'Jl. Dahlia No. 44, Medan')
    returning id_pelanggan into v_pelanggan;

    select public.buat_penyewaan(v_pelanggan, date '2026-10-25', date '2026-10-28',
      jsonb_build_array(jsonb_build_object('id_alat', v_cajon, 'jumlah', 1)))
    into v_sewa;
  end if;

  -- Kasus 6: Biola + ukulele, tepat waktu, dibayar QRIS penuh.
  select id_alat into v_biola from public.alat_musik where nama_alat = 'Biola' limit 1;
  select id_alat into v_ukulele from public.alat_musik where nama_alat = 'Ukulele' limit 1;
  if v_biola is not null and v_ukulele is not null and not exists (
    select 1 from public.penyewaan p
    join public.pelanggan c on c.id_pelanggan = p.id_pelanggan
    where c.nama = 'Maya Larasati' and p.tgl_sewa = date '2026-11-10'
  ) then
    insert into public.pelanggan (nama, no_hp, alamat)
    values ('Maya Larasati', '081234560006', 'Jl. Flamboyan No. 19, Medan')
    returning id_pelanggan into v_pelanggan;

    select public.buat_penyewaan(v_pelanggan, date '2026-11-10', date '2026-11-12',
      jsonb_build_array(
        jsonb_build_object('id_alat', v_biola, 'jumlah', 1),
        jsonb_build_object('id_alat', v_ukulele, 'jumlah', 1)))
    into v_sewa;

    insert into public.pembayaran_sewa (id_sewa, tgl_bayar, jumlah_bayar, metode_bayar)
    values (v_sewa, date '2026-11-10', 210000, 'QRIS');

    insert into public.pengembalian (id_sewa, tgl_kembali_aktual)
    values (v_sewa, date '2026-11-12');
  end if;

  -- Kasus 7: Saksofon terlambat, cicilan sewa, dan alat dinyatakan hilang.
  select id_alat into v_saksofon from public.alat_musik where nama_alat = 'Saksofon' limit 1;
  if v_saksofon is not null and not exists (
    select 1 from public.penyewaan p
    join public.pelanggan c on c.id_pelanggan = p.id_pelanggan
    where c.nama = 'Kevin Wijaya' and p.tgl_sewa = date '2026-11-20'
  ) then
    insert into public.pelanggan (nama, no_hp, alamat)
    values ('Kevin Wijaya', '081234560007', 'Jl. Cempaka No. 27, Medan')
    returning id_pelanggan into v_pelanggan;

    select public.buat_penyewaan(v_pelanggan, date '2026-11-20', date '2026-11-22',
      jsonb_build_array(jsonb_build_object('id_alat', v_saksofon, 'jumlah', 1)))
    into v_sewa;

    insert into public.pembayaran_sewa (id_sewa, tgl_bayar, jumlah_bayar, metode_bayar)
    values
      (v_sewa, date '2026-11-20', 250000, 'Tunai'),
      (v_sewa, date '2026-11-22', 50000, 'Transfer');

    insert into public.pengembalian
      (id_sewa, tgl_kembali_aktual, kondisi_alat, biaya_kerusakan, catatan_kerusakan)
    values
      (v_sewa, date '2026-11-24', 'Hilang', 350000,
       'Saksofon tidak dikembalikan dan dinyatakan hilang')
    returning id_pengembalian into v_pengembalian;

    insert into public.pembayaran_denda (id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar)
    values (v_pengembalian, date '2026-11-24', 80000, 'Transfer');

    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'pembayaran_kerusakan'
    ) then
      insert into public.pembayaran_kerusakan
        (id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar)
      values (v_pengembalian, date '2026-11-25', 100000, 'Tunai');
    end if;
  end if;
end;
$$;
