-- Apply once to add return-condition tracking and separate damage accounting.
-- Existing late-fee calculation and accounting triggers are intentionally unchanged.

alter table public.pengembalian
  add column if not exists kondisi_alat text not null default 'Baik',
  add column if not exists biaya_kerusakan numeric(14,2) not null default 0,
  add column if not exists catatan_kerusakan text not null default '-';

alter table public.pengembalian
  drop constraint if exists pengembalian_kondisi_alat_check,
  drop constraint if exists pengembalian_biaya_kerusakan_check;

alter table public.pengembalian
  add constraint pengembalian_kondisi_alat_check
    check (kondisi_alat in ('Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang')),
  add constraint pengembalian_biaya_kerusakan_check
    check (biaya_kerusakan >= 0);

alter table public.alat_musik
  drop constraint if exists alat_musik_status_check;

alter table public.alat_musik
  add constraint alat_musik_status_check
    check (status in ('Tersedia', 'Disewa', 'Maintenance', 'Nonaktif'));

create or replace function public.catat_kondisi_dan_kerusakan_pengembalian()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.alat_musik a
  set status = case new.kondisi_alat
    when 'Baik' then 'Tersedia'
    when 'Hilang' then 'Nonaktif'
    else 'Maintenance'
  end
  from public.detail_penyewaan d
  where d.id_sewa = new.id_sewa
    and d.id_alat = a.id_alat;

  if new.biaya_kerusakan > 0 then
    insert into public.jurnal_akuntansi
      (id_pengembalian, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan)
    values
      (new.id_pengembalian, new.tgl_kembali_aktual, '1140', 'Piutang Ganti Rugi Kerusakan',
       new.biaya_kerusakan, 0, 'Akrual biaya kerusakan sewa #' || new.id_sewa),
      (new.id_pengembalian, new.tgl_kembali_aktual, '4120', 'Pendapatan Ganti Rugi Kerusakan',
       0, new.biaya_kerusakan, 'Akrual biaya kerusakan sewa #' || new.id_sewa);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_z_pengembalian_kondisi_kerusakan on public.pengembalian;
create trigger trg_z_pengembalian_kondisi_kerusakan
after insert on public.pengembalian
for each row
execute function public.catat_kondisi_dan_kerusakan_pengembalian();
