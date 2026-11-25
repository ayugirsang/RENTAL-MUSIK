-- Apply after deploying the Express API with SUPABASE_SERVICE_ROLE_KEY.
-- This closes direct browser access through the anon publishable key.

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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pelanggan', 'alat_musik', 'penyewaan', 'detail_penyewaan',
    'pengembalian', 'pembayaran_denda', 'pembayaran_sewa', 'jurnal_akuntansi'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'demo_anon_access_' || table_name, table_name);
  end loop;
end;
$$;
