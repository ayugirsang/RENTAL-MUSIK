-- Apply once to an existing Supabase database to protect the accounting audit trail.
revoke update, delete on table
  public.pembayaran_sewa,
  public.pembayaran_denda,
  public.jurnal_akuntansi
from anon, authenticated;
