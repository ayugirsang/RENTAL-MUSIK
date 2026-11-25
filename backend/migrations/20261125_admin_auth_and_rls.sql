-- Run in the Supabase SQL Editor as the project owner.
-- Adds authenticated, allow-listed access for the GitHub Pages application.

create table if not exists public.ritme_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ritme_admins enable row level security;
revoke all on public.ritme_admins from public, anon, authenticated;
grant select on public.ritme_admins to authenticated;
grant select on public.ritme_admins to service_role;
drop policy if exists ritme_admin_self_read on public.ritme_admins;
create policy ritme_admin_self_read
  on public.ritme_admins for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_ritme_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ritme_admins
    where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_ritme_admin() from public, anon, authenticated;
grant execute on function public.is_ritme_admin() to authenticated;

revoke all on schema public from public, anon;
grant usage on schema public to authenticated, service_role;
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
to authenticated;
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
revoke update, delete on table
  public.pembayaran_sewa,
  public.pembayaran_denda,
  public.jurnal_akuntansi
from authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role;
revoke all on function public.buat_penyewaan(bigint, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.buat_penyewaan(bigint, date, date, jsonb) to authenticated, service_role;

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
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_ritme_admin())) with check ((select public.is_ritme_admin()))',
      'ritme_admin_access_' || table_name,
      table_name
    );
  end loop;
end;
$$;
