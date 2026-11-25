-- Jalankan sebagai owner/database role yang dapat mengubah policy.
revoke all on table
  public.pelanggan,
  public.alat_musik,
  public.penyewaan,
  public.detail_penyewaan,
  public.pengembalian,
  public.pembayaran_denda,
  public.pembayaran_sewa,
  public.jurnal_akuntansi
from anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function public.buat_penyewaan(bigint, date, date, jsonb) from anon, authenticated;

do $$
declare
  nama_tabel text;
begin
  foreach nama_tabel in array array[
    'pelanggan', 'alat_musik', 'penyewaan', 'detail_penyewaan',
    'pengembalian', 'pembayaran_denda', 'pembayaran_sewa', 'jurnal_akuntansi'
  ] loop
    execute format('alter table public.%I enable row level security', nama_tabel);
    execute format('drop policy if exists %I on public.%I', 'demo_anon_access_' || nama_tabel, nama_tabel);
  end loop;
end;
$$;