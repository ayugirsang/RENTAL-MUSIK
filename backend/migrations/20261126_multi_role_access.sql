-- Run in the Supabase SQL Editor as the project owner after existing schema and trigger migrations.
-- Database access is server-only; browser clients authenticate but cannot query application tables.

create table if not exists public.ritme_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'operasional', 'akuntansi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ritme_user_roles enable row level security;
revoke all on table public.ritme_user_roles from public, anon, authenticated;
grant select, insert, update, delete on table public.ritme_user_roles to service_role;

revoke all on schema public from public, anon, authenticated;
grant usage on schema public to service_role;

revoke all on table
  public.pelanggan,
  public.alat_musik,
  public.penyewaan,
  public.detail_penyewaan,
  public.pengembalian,
  public.pembayaran_denda,
  public.pembayaran_sewa,
  public.jurnal_akuntansi
from public, anon, authenticated;
grant select, insert, update, delete on table
  public.pelanggan,
  public.alat_musik,
  public.penyewaan,
  public.detail_penyewaan,
  public.pengembalian,
  public.pembayaran_denda,
  public.pembayaran_sewa,
  public.jurnal_akuntansi
to service_role;

revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to service_role;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'pelanggan', 'alat_musik', 'penyewaan', 'detail_penyewaan',
    'pengembalian', 'pembayaran_denda', 'pembayaran_sewa', 'jurnal_akuntansi'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    end loop;
  end loop;
end;
$$;

revoke all on function public.buat_penyewaan(bigint, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.buat_penyewaan(bigint, date, date, jsonb) to service_role;
