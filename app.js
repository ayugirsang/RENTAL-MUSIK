const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error('SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY wajib diisi di file .env.');
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function sendDatabaseError(res, error, status = 400) {
  console.error(error);
  res.status(status).json({ error: error.message || 'Terjadi kesalahan pada database.' });
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isValidDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function getTotalFinePayments() {
  let total = 0;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('pembayaran_denda')
      .select('id_pembayaran, jumlah_bayar')
      .order('id_pembayaran')
      .range(offset, offset + pageSize - 1);
    if (error) return { total, error };
    total += data.reduce((sum, payment) => sum + Number(payment.jumlah_bayar), 0);
    if (data.length < pageSize) return { total, error: null };
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ritme-api', time: new Date().toISOString() });
});

app.get('/api/dashboard', async (_req, res) => {
  const [paymentsResult, rentalsResult, equipmentResult] = await Promise.all([
    getTotalFinePayments(),
    supabase.from('penyewaan').select('id_sewa, tgl_rencana_kembali').eq('status_sewa', 'Berlangsung'),
    supabase.from('alat_musik').select('id_alat').eq('status', 'Disewa')
  ]);
  const error = paymentsResult.error || rentalsResult.error || equipmentResult.error;
  if (error) return sendDatabaseError(res, error, 500);

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  res.json({
    totalDendaDibayar: paymentsResult.total,
    penyewaanTerlambat: rentalsResult.data.filter(row => row.tgl_rencana_kembali < today).length,
    alatDisewa: equipmentResult.data.length
  });
});

app.get('/api/pelanggan', async (_req, res) => {
  const { data, error } = await supabase.from('pelanggan').select('id_pelanggan, nama, no_hp, alamat').order('nama');
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.post('/api/pelanggan', async (req, res) => {
  const { nama, no_hp, alamat } = req.body;
  if (!nama?.trim() || !no_hp?.trim()) return res.status(400).json({ error: 'Nama dan nomor HP wajib diisi.' });
  const { data, error } = await supabase.from('pelanggan')
    .insert({ nama: nama.trim(), no_hp: no_hp.trim(), alamat: (alamat || '').trim() })
    .select('id_pelanggan, nama, no_hp, alamat').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.get('/api/alat-musik', async (_req, res) => {
  const { data, error } = await supabase.from('alat_musik')
    .select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').order('nama_alat');
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.get('/api/penyewaan/aktif', async (_req, res) => {
  const { data, error } = await supabase.from('penyewaan')
    .select('id_sewa, tgl_sewa, tgl_rencana_kembali, total_biaya, pelanggan(nama), detail_penyewaan(jumlah, alat_musik(denda_per_hari))')
    .eq('status_sewa', 'Berlangsung').order('tgl_rencana_kembali');
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.post('/api/penyewaan', async (req, res) => {
  const { id_pelanggan, tgl_sewa, tgl_rencana_kembali, items } = req.body;
  const itemIds = Array.isArray(items) ? items.map(item => Number(item?.id_alat)) : [];
  if (!isPositiveInteger(id_pelanggan) || !isValidDate(tgl_sewa) || !isValidDate(tgl_rencana_kembali)
    || tgl_rencana_kembali < tgl_sewa || !itemIds.length || itemIds.some(id => !isPositiveInteger(id))
    || new Set(itemIds).size !== itemIds.length) {
    return res.status(400).json({ error: 'Pelanggan, tanggal, dan minimal satu alat wajib dipilih.' });
  }
  const { data, error } = await supabase.rpc('buat_penyewaan', {
    p_id_pelanggan: id_pelanggan,
    p_tgl_sewa: tgl_sewa,
    p_tgl_rencana_kembali: tgl_rencana_kembali,
    p_items: itemIds.map(id_alat => ({ id_alat, jumlah: 1 }))
  });
  if (error) return sendDatabaseError(res, error);
  res.status(201).json({ id_sewa: data });
});

app.post('/api/pengembalian', async (req, res) => {
  const { id_sewa, tgl_kembali_aktual } = req.body;
  if (!isPositiveInteger(id_sewa) || !isValidDate(tgl_kembali_aktual)) {
    return res.status(400).json({ error: 'Penyewaan dan tanggal kembali yang valid wajib dipilih.' });
  }
  const { data, error } = await supabase.from('pengembalian')
    .insert({ id_sewa, tgl_kembali_aktual })
    .select('id_pengembalian, id_sewa, hari_terlambat, total_denda, status_pembayaran_denda').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.get('/api/pengembalian/belum-lunas', async (_req, res) => {
  const { data: returns, error } = await supabase.from('pengembalian')
    .select('id_pengembalian, id_sewa, total_denda, status_pembayaran_denda')
    .in('status_pembayaran_denda', ['Belum Lunas', 'Sebagian']).order('id_pengembalian', { ascending: false });
  if (error) return sendDatabaseError(res, error, 500);
  const ids = returns.map(row => row.id_pengembalian);
  if (ids.length === 0) return res.json([]);

  const [{ data: payments, error: paymentError }, { data: rentals, error: rentalError }] = await Promise.all([
    supabase.from('pembayaran_denda').select('id_pengembalian, jumlah_bayar').in('id_pengembalian', ids),
    supabase.from('penyewaan').select('id_sewa, pelanggan(nama)').in('id_sewa', returns.map(row => row.id_sewa))
  ]);
  if (paymentError || rentalError) return sendDatabaseError(res, paymentError || rentalError, 500);
  const paidByReturn = new Map();
  for (const payment of payments) {
    paidByReturn.set(payment.id_pengembalian, (paidByReturn.get(payment.id_pengembalian) || 0) + Number(payment.jumlah_bayar));
  }
  const customerByRental = new Map(rentals.map(row => [row.id_sewa, row.pelanggan?.nama || 'Pelanggan']));
  res.json(returns.map(row => ({
    ...row,
    nama_pelanggan: customerByRental.get(row.id_sewa),
    total_terbayar: paidByReturn.get(row.id_pengembalian) || 0,
    sisa_denda: Math.max(0, Number(row.total_denda) - (paidByReturn.get(row.id_pengembalian) || 0))
  })).filter(row => row.sisa_denda > 0));
});

app.post('/api/pembayaran-denda', async (req, res) => {
  const { id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar } = req.body;
  const amount = Number(jumlah_bayar);
  if (!isPositiveInteger(id_pengembalian) || !isValidDate(tgl_bayar)
    || !Number.isFinite(amount) || amount <= 0 || !['Tunai', 'Transfer', 'QRIS'].includes(metode_bayar)) {
    return res.status(400).json({ error: 'Lengkapi tanggal, jumlah positif, dan metode pembayaran yang valid.' });
  }
  const { data, error } = await supabase.from('pembayaran_denda')
    .insert({ id_pengembalian, tgl_bayar, jumlah_bayar: amount, metode_bayar })
    .select('id_pembayaran, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.get('/api/jurnal', async (_req, res) => {
  const { data, error } = await supabase.from('jurnal_akuntansi')
    .select('id_jurnal, id_pengembalian, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan')
    .order('tgl_jurnal', { ascending: false }).order('id_jurnal', { ascending: false }).limit(500);
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));

app.listen(port, () => {
  console.log(`Aplikasi rental musik berjalan di http://localhost:${port}`);
});
