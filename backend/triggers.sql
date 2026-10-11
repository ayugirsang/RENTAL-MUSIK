-- Fungsi bisnis dan trigger untuk rental, pengembalian, pembayaran, dan jurnal.
-- Jalankan setelah schema.sql.

-- Satu baris alat mewakili satu unit fisik; jumlah per unit pada transaksi adalah 1.
create or replace function public.buat_penyewaan(
  p_id_pelanggan bigint,
  p_tgl_sewa date,
  p_tgl_rencana_kembali date,
  p_items jsonb
) returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id_sewa bigint;
  v_hari integer;
  v_total numeric(14,2);
  v_jumlah_item integer;
  v_item record;
begin
  if p_tgl_rencana_kembali < p_tgl_sewa then
    raise exception 'Tanggal rencana kembali harus sama atau setelah tanggal sewa';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Pilih minimal satu alat musik';
  end if;

  v_jumlah_item := jsonb_array_length(p_items);
  if (select count(distinct (item.value->>'id_alat')::bigint)
      from jsonb_array_elements(p_items) as item(value)) <> v_jumlah_item then
    raise exception 'Alat yang sama tidak boleh dipilih lebih dari sekali';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as item(value)
    where coalesce((item.value->>'jumlah')::integer, 1) <> 1
  ) then
    raise exception 'Setiap baris alat mewakili satu unit';
  end if;

  perform a.id_alat
  from public.alat_musik a
  join jsonb_array_elements(p_items) as item(value) on a.id_alat = (item.value->>'id_alat')::bigint
  order by a.id_alat
  for update of a;

  if (select count(*) from public.alat_musik a
      join jsonb_array_elements(p_items) as item(value) on a.id_alat = (item.value->>'id_alat')::bigint
      where a.status = 'Tersedia') <> v_jumlah_item then
    raise exception 'Satu atau lebih alat sudah tidak tersedia';
  end if;

  v_hari := greatest(p_tgl_rencana_kembali - p_tgl_sewa, 1);
  select coalesce(sum(a.harga_sewa_per_hari * v_hari), 0)
    into v_total
    from public.alat_musik a
    join jsonb_array_elements(p_items) as item(value) on a.id_alat = (item.value->>'id_alat')::bigint;

  insert into public.penyewaan (id_pelanggan, tgl_sewa, tgl_rencana_kembali, total_biaya)
  values (p_id_pelanggan, p_tgl_sewa, p_tgl_rencana_kembali, v_total)
  returning id_sewa into v_id_sewa;

  for v_item in
    select a.id_alat, a.harga_sewa_per_hari
    from public.alat_musik a
    join jsonb_array_elements(p_items) as item(value) on a.id_alat = (item.value->>'id_alat')::bigint
  loop
    insert into public.detail_penyewaan (id_sewa, id_alat, jumlah, subtotal)
    values (v_id_sewa, v_item.id_alat, 1, v_item.harga_sewa_per_hari * v_hari);
    update public.alat_musik set status = 'Disewa' where id_alat = v_item.id_alat;
  end loop;

  return v_id_sewa;
end;
$$;

grant execute on function public.buat_penyewaan(bigint, date, date, jsonb) to anon, authenticated;

-- Saat barang dikembalikan, hitung denda dari detail alat dan akrual jurnal.
create or replace function public.proses_pengembalian()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_rencana date;
  v_tgl_sewa date;
  v_status text;
  v_hari integer;
  v_total numeric(14,2);
begin
  select p.tgl_rencana_kembali, p.tgl_sewa, p.status_sewa
    into v_rencana, v_tgl_sewa, v_status
  from public.penyewaan p where p.id_sewa = new.id_sewa;
  if not found then
    raise exception 'Data penyewaan tidak ditemukan';
  end if;
  if v_status <> 'Berlangsung' then
    raise exception 'Penyewaan ini sudah selesai';
  end if;
  if new.tgl_kembali_aktual < v_tgl_sewa then
    raise exception 'Tanggal kembali tidak boleh sebelum tanggal sewa';
  end if;

  v_hari := greatest(new.tgl_kembali_aktual - v_rencana, 0);
  select coalesce(sum(d.jumlah * a.denda_per_hari * v_hari), 0)
    into v_total
    from public.detail_penyewaan d
    join public.alat_musik a on a.id_alat = d.id_alat
    where d.id_sewa = new.id_sewa;

  new.hari_terlambat := v_hari;
  new.total_denda := v_total;
  new.status_pembayaran_denda := case when v_total = 0 then 'Lunas' else 'Belum Lunas' end;
  return new;
end;
$$;

create or replace function public.catat_penyewaan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.total_biaya > 0 and new.basis_pencatatan = 'Akrual' then
    insert into public.jurnal_akuntansi
      (id_sewa, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan)
    values
      (new.id_sewa, new.tgl_sewa, '1120', 'Piutang Sewa', new.total_biaya, 0,
       'Pengakuan pendapatan sewa #' || new.id_sewa),
      (new.id_sewa, new.tgl_sewa, '4100', 'Pendapatan Sewa Alat Musik', 0, new.total_biaya,
       'Pengakuan pendapatan sewa #' || new.id_sewa);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_catat_penyewaan on public.penyewaan;
create trigger trg_catat_penyewaan
after insert on public.penyewaan
for each row execute function public.catat_penyewaan();

create or replace function public.validasi_pembayaran_sewa()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_terbayar numeric(14,2);
begin
  select total_biaya into v_total
  from public.penyewaan where id_sewa = new.id_sewa
  for update;
  if not found then
    raise exception 'Data penyewaan tidak ditemukan';
  end if;
  select coalesce(sum(jumlah_bayar), 0) into v_terbayar
  from public.pembayaran_sewa where id_sewa = new.id_sewa;
  if new.jumlah_bayar > v_total - v_terbayar then
    raise exception 'Pembayaran melebihi sisa tagihan sewa';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validasi_pembayaran_sewa on public.pembayaran_sewa;
create trigger trg_validasi_pembayaran_sewa
before insert on public.pembayaran_sewa
for each row execute function public.validasi_pembayaran_sewa();

create or replace function public.catat_pembayaran_sewa()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_terbayar numeric(14,2);
  v_basis text;
  v_kode_akun text;
  v_nama_akun text;
  v_keterangan text;
begin
  select total_biaya, basis_pencatatan into v_total, v_basis
  from public.penyewaan where id_sewa = new.id_sewa;
  select coalesce(sum(jumlah_bayar), 0) into v_terbayar
  from public.pembayaran_sewa where id_sewa = new.id_sewa;

  update public.penyewaan
  set status_pembayaran_sewa = case
    when v_terbayar >= v_total then 'Lunas'
    when v_terbayar > 0 then 'Sebagian'
    else 'Belum Lunas'
  end
  where id_sewa = new.id_sewa;

  if v_basis = 'Akrual' then
    v_kode_akun := '1120';
    v_nama_akun := 'Piutang Sewa';
    v_keterangan := 'Pengurangan piutang sewa #' || new.id_sewa;
  else
    v_kode_akun := '4100';
    v_nama_akun := 'Pendapatan Sewa Alat Musik';
    v_keterangan := 'Penerimaan sewa lama #' || new.id_sewa;
  end if;

  insert into public.jurnal_akuntansi
    (id_sewa, id_pembayaran_sewa, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan)
  values
    (new.id_sewa, new.id_pembayaran_sewa, new.tgl_bayar, '1110', 'Kas', new.jumlah_bayar, 0,
     'Pembayaran sewa #' || new.id_pembayaran_sewa || ' (' || new.metode_bayar || ')'),
    (new.id_sewa, new.id_pembayaran_sewa, new.tgl_bayar, v_kode_akun, v_nama_akun, 0, new.jumlah_bayar,
     v_keterangan);
  return new;
end;
$$;

drop trigger if exists trg_catat_pembayaran_sewa on public.pembayaran_sewa;
create trigger trg_catat_pembayaran_sewa
after insert on public.pembayaran_sewa
for each row execute function public.catat_pembayaran_sewa();

drop trigger if exists trg_hitung_pengembalian on public.pengembalian;
create trigger trg_hitung_pengembalian
before insert on public.pengembalian
for each row execute function public.proses_pengembalian();

create or replace function public.catat_pengembalian()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.penyewaan set status_sewa = 'Selesai' where id_sewa = new.id_sewa;
  update public.alat_musik a set status = 'Tersedia'
  from public.detail_penyewaan d
  where d.id_sewa = new.id_sewa and d.id_alat = a.id_alat;

  if new.total_denda > 0 then
    insert into public.jurnal_akuntansi
      (id_pengembalian, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan)
    values
      (new.id_pengembalian, new.tgl_kembali_aktual, '1130', 'Piutang Denda', new.total_denda, 0,
       'Akrual denda keterlambatan sewa #' || new.id_sewa),
      (new.id_pengembalian, new.tgl_kembali_aktual, '4110', 'Pendapatan Denda Keterlambatan', 0, new.total_denda,
       'Akrual denda keterlambatan sewa #' || new.id_sewa);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_catat_pengembalian on public.pengembalian;
create trigger trg_catat_pengembalian
after insert on public.pengembalian
for each row execute function public.catat_pengembalian();

-- Pembayaran melunasi piutang; jurnal pendapatan sudah dibuat ketika denda diakui.
create or replace function public.validasi_pembayaran_denda()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_terbayar numeric(14,2);
begin
  select total_denda into v_total
  from public.pengembalian where id_pengembalian = new.id_pengembalian
  for update;
  if not found then
    raise exception 'Data pengembalian tidak ditemukan';
  end if;
  select coalesce(sum(jumlah_bayar), 0) into v_terbayar
  from public.pembayaran_denda where id_pengembalian = new.id_pengembalian;
  if new.jumlah_bayar > v_total - v_terbayar then
    raise exception 'Pembayaran melebihi sisa denda';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validasi_pembayaran_denda on public.pembayaran_denda;
create trigger trg_validasi_pembayaran_denda
before insert on public.pembayaran_denda
for each row execute function public.validasi_pembayaran_denda();

create or replace function public.catat_pembayaran_denda()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_terbayar numeric(14,2);
begin
  select total_denda into v_total from public.pengembalian
  where id_pengembalian = new.id_pengembalian;
  select coalesce(sum(jumlah_bayar), 0) into v_terbayar
  from public.pembayaran_denda where id_pengembalian = new.id_pengembalian;

  update public.pengembalian
  set status_pembayaran_denda = case
    when v_terbayar >= v_total then 'Lunas'
    when v_terbayar > 0 then 'Sebagian'
    else 'Belum Lunas'
  end
  where id_pengembalian = new.id_pengembalian;

  insert into public.jurnal_akuntansi
    (id_pengembalian, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan)
  values
    (new.id_pengembalian, new.tgl_bayar, '1110', 'Kas', new.jumlah_bayar, 0,
     'Pembayaran denda #' || new.id_pembayaran || ' (' || new.metode_bayar || ')'),
    (new.id_pengembalian, new.tgl_bayar, '1130', 'Piutang Denda', 0, new.jumlah_bayar,
     'Pelunasan piutang denda #' || new.id_pembayaran);
  return new;
end;
$$;

drop trigger if exists trg_catat_pembayaran_denda on public.pembayaran_denda;
create trigger trg_catat_pembayaran_denda
after insert on public.pembayaran_denda
for each row execute function public.catat_pembayaran_denda();
