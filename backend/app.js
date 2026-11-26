const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_ALLOWED_ORIGIN = process.env.API_ALLOWED_ORIGIN;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di file .env.');
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (API_ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', API_ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (API_ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== API_ALLOWED_ORIGIN) {
    return res.status(403).json({ error: 'Origin tidak diizinkan.' });
  }
  next();
});
app.get('/js/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.RITME_CONFIG = ${JSON.stringify({
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    apiMode: 'server',
    apiBaseUrl: ''
  })};\n`);
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));

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

async function getAllRows(table, columns, orderColumn) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table)
      .select(columns)
      .order(orderColumn)
      .range(offset, offset + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...data);
    if (data.length < pageSize) return { data: rows, error: null };
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ritme-api', time: new Date().toISOString() });
});

app.use('/api', async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Login diperlukan.' });

  const { data: userData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !userData.user) return res.status(401).json({ error: 'Sesi login tidak valid.' });
  const { data: admin, error: adminError } = await supabase.from('ritme_admins')
    .select('user_id').eq('user_id', userData.user.id).maybeSingle();
  if (adminError) return sendDatabaseError(res, adminError, 500);
  if (!admin) return res.status(403).json({ error: 'Akun ini tidak memiliki akses administrator.' });
  req.user = userData.user;
  next();
});

const idempotencyCache = new Map();
const IDEMPOTENCY_CACHE_MAX_SIZE = 1000;
const IDEMPOTENCY_CACHE_TTL = 10 * 60 * 1000;

app.use('/api', (req, res, next) => {
  if (!['POST', 'PATCH'].includes(req.method)) return next();
  const key = String(req.headers['idempotency-key'] || '').trim();
  if (!key || key.length > 128) {
    return res.status(400).json({ error: 'Idempotency-Key wajib disertakan untuk operasi perubahan data.' });
  }
  const now = Date.now();
  for (const [cacheKey, entry] of idempotencyCache) {
    if (entry.expiresAt <= now) idempotencyCache.delete(cacheKey);
  }
  const scopedKey = `${req.user.id}:${key}`;
  const cached = idempotencyCache.get(scopedKey);
  if (cached) {
    if (cached.pending) return res.status(409).json({ error: 'Permintaan yang sama sedang diproses.' });
    return res.status(cached.status).json(cached.body);
  }
  if (idempotencyCache.size >= IDEMPOTENCY_CACHE_MAX_SIZE) {
    return res.status(503).json({ error: 'Antrean permintaan penuh. Coba lagi sebentar.' });
  }
  idempotencyCache.set(scopedKey, { pending: true, expiresAt: now + IDEMPOTENCY_CACHE_TTL });
  const originalJson = res.json.bind(res);
  res.json = body => {
    const entry = idempotencyCache.get(scopedKey);
    if (entry) {
      if (res.statusCode >= 500) idempotencyCache.delete(scopedKey);
      else idempotencyCache.set(scopedKey, {
        status: res.statusCode,
        body,
        expiresAt: Date.now() + IDEMPOTENCY_CACHE_TTL
      });
    }
    return originalJson(body);
  };
  next();
});

app.get('/api/dashboard', async (_req, res) => {
  const [rentalsResult, equipmentResult] = await Promise.all([
    supabase.from('penyewaan').select('id_sewa, tgl_rencana_kembali').eq('status_sewa', 'Berlangsung'),
    supabase.from('alat_musik').select('id_alat, status')
  ]);
  const error = rentalsResult.error || equipmentResult.error;
  if (error) return sendDatabaseError(res, error, 500);

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const todayUtc = Date.parse(`${today}T00:00:00Z`);
  const daysUntil = date => Math.round((Date.parse(`${date}T00:00:00Z`) - todayUtc) / 86400000);
  const dueSoon = rentalsResult.data.filter(row => {
    const days = daysUntil(row.tgl_rencana_kembali);
    return days >= 0 && days <= 3;
  }).length;
  res.json({
    penyewaanBerlangsung: rentalsResult.data.length,
    penyewaanJatuhTempo: dueSoon,
    penyewaanTerlambat: rentalsResult.data.filter(row => row.tgl_rencana_kembali < today).length,
    alatTersedia: equipmentResult.data.filter(row => row.status === 'Tersedia').length,
    alatDisewa: equipmentResult.data.filter(row => row.status === 'Disewa').length
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

app.patch('/api/pelanggan/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const nama = typeof body.nama === 'string' ? body.nama.trim() : '';
  const no_hp = typeof body.no_hp === 'string' ? body.no_hp.trim() : '';
  const alamat = typeof body.alamat === 'string' ? body.alamat.trim() : '';
  if (!isPositiveInteger(id) || !nama || !no_hp) {
    return res.status(400).json({ error: 'ID, nama, dan nomor HP pelanggan wajib valid.' });
  }
  const { data, error } = await supabase.from('pelanggan')
    .update({ nama, no_hp, alamat })
    .eq('id_pelanggan', id).select('id_pelanggan, nama, no_hp, alamat').single();
  if (error?.code === 'PGRST116') return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
  if (error) return sendDatabaseError(res, error);
  res.json(data);
});

app.get('/api/alat-musik', async (_req, res) => {
  const { data, error } = await supabase.from('alat_musik')
    .select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').order('nama_alat');
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.post('/api/alat-musik', async (req, res) => {
  const body = req.body || {};
  const nama = typeof body.nama_alat === 'string' ? body.nama_alat.trim() : '';
  const rawHarga = body.harga_sewa_per_hari;
  const rawDenda = body.denda_per_hari;
  const harga = typeof rawHarga === 'number' || (typeof rawHarga === 'string' && rawHarga.trim()) ? Number(rawHarga) : NaN;
  const denda = typeof rawDenda === 'number' || (typeof rawDenda === 'string' && rawDenda.trim()) ? Number(rawDenda) : NaN;
  if (!nama || nama.length > 100) return res.status(400).json({ error: 'Nama alat wajib diisi (maksimal 100 karakter).' });
  if (!Number.isFinite(harga) || harga < 0 || !Number.isFinite(denda) || denda < 0) {
    return res.status(400).json({ error: 'Harga sewa dan denda harus berupa angka nol atau lebih.' });
  }
  const { data, error } = await supabase.from('alat_musik')
    .insert({ nama_alat: nama, harga_sewa_per_hari: harga, denda_per_hari: denda })
    .select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.patch('/api/alat-musik/:id', async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const nama = typeof body.nama_alat === 'string' ? body.nama_alat.trim() : '';
  const rawHarga = body.harga_sewa_per_hari;
  const rawDenda = body.denda_per_hari;
  const harga = typeof rawHarga === 'number' || (typeof rawHarga === 'string' && rawHarga.trim()) ? Number(rawHarga) : NaN;
  const denda = typeof rawDenda === 'number' || (typeof rawDenda === 'string' && rawDenda.trim()) ? Number(rawDenda) : NaN;
  if (!isPositiveInteger(id)) return res.status(400).json({ error: 'ID alat musik tidak valid.' });
  if (!nama || nama.length > 100) return res.status(400).json({ error: 'Nama alat wajib diisi (maksimal 100 karakter).' });
  if (!Number.isFinite(harga) || harga < 0 || !Number.isFinite(denda) || denda < 0) {
    return res.status(400).json({ error: 'Harga sewa dan denda harus berupa angka nol atau lebih.' });
  }

  const { data: current, error: lookupError } = await supabase.from('alat_musik')
    .select('status, harga_sewa_per_hari, denda_per_hari').eq('id_alat', id).single();
  if (lookupError?.code === 'PGRST116') return res.status(404).json({ error: 'Alat musik tidak ditemukan.' });
  if (lookupError) return sendDatabaseError(res, lookupError, 500);
  if (current.status === 'Disewa'
    && (harga !== Number(current.harga_sewa_per_hari) || denda !== Number(current.denda_per_hari))) {
    return res.status(409).json({ error: 'Tarif alat tidak dapat diubah selama alat sedang disewa.' });
  }

  const { data, error } = await supabase.from('alat_musik')
    .update({ nama_alat: nama, harga_sewa_per_hari: harga, denda_per_hari: denda })
    .eq('id_alat', id).eq('status', current.status)
    .select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').single();
  if (error?.code === 'PGRST116') {
    return res.status(409).json({ error: 'Status alat berubah. Muat ulang data sebelum mengubah inventaris.' });
  }
  if (error) return sendDatabaseError(res, error);
  res.json(data);
});

app.get('/api/penyewaan/aktif', async (_req, res) => {
  const { data, error } = await supabase.from('penyewaan')
    .select('id_sewa, id_pelanggan, tgl_sewa, tgl_rencana_kembali, total_biaya, pelanggan(nama, no_hp), detail_penyewaan(jumlah, subtotal, alat_musik(nama_alat, harga_sewa_per_hari, denda_per_hari))')
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
  const kondisi_alat = req.body.kondisi_alat || 'Baik';
  const biaya_kerusakan = req.body.biaya_kerusakan === undefined ? 0 : Number(req.body.biaya_kerusakan);
  const catatan_kerusakan = typeof req.body.catatan_kerusakan === 'string'
    ? req.body.catatan_kerusakan.trim() || '-'
    : '-';
  if (!isPositiveInteger(id_sewa) || !isValidDate(tgl_kembali_aktual)
    || !['Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang'].includes(kondisi_alat)
    || !Number.isFinite(biaya_kerusakan) || biaya_kerusakan < 0
    || (kondisi_alat === 'Baik' && biaya_kerusakan > 0)
    || catatan_kerusakan.length > 1000) {
    return res.status(400).json({ error: 'Pilih penyewaan dan tanggal kembali yang valid; kondisi dan biaya kerusakan harus sesuai.' });
  }
  const { data, error } = await supabase.from('pengembalian')
    .insert({ id_sewa, tgl_kembali_aktual, kondisi_alat, biaya_kerusakan, catatan_kerusakan })
    .select('id_pengembalian, id_sewa, hari_terlambat, total_denda, status_pembayaran_denda, kondisi_alat, biaya_kerusakan, catatan_kerusakan').single();
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

app.get('/api/penyewaan/belum-lunas', async (_req, res) => {
  const { data: rentals, error } = await supabase.from('penyewaan')
    .select('id_sewa, id_pelanggan, tgl_sewa, total_biaya, status_pembayaran_sewa, basis_pencatatan')
    .in('status_pembayaran_sewa', ['Belum Dicatat', 'Belum Lunas', 'Sebagian'])
    .order('id_sewa', { ascending: false });
  if (error) return sendDatabaseError(res, error, 500);
  if (!rentals.length) return res.json([]);

  const ids = rentals.map(row => row.id_sewa);
  const customerIds = [...new Set(rentals.map(row => row.id_pelanggan))];
  const [{ data: payments, error: paymentError }, { data: customers, error: customerError }] = await Promise.all([
    supabase.from('pembayaran_sewa').select('id_sewa, jumlah_bayar').in('id_sewa', ids),
    supabase.from('pelanggan').select('id_pelanggan, nama').in('id_pelanggan', customerIds)
  ]);
  if (paymentError || customerError) return sendDatabaseError(res, paymentError || customerError, 500);

  const paidByRental = new Map();
  for (const payment of payments) {
    paidByRental.set(payment.id_sewa, (paidByRental.get(payment.id_sewa) || 0) + Number(payment.jumlah_bayar));
  }
  const customerById = new Map(customers.map(row => [row.id_pelanggan, row.nama]));
  res.json(rentals.map(row => {
    const total_terbayar = paidByRental.get(row.id_sewa) || 0;
    return {
      ...row,
      nama_pelanggan: customerById.get(row.id_pelanggan) || 'Pelanggan',
      total_terbayar,
      sisa_tagihan: Math.max(0, Number(row.total_biaya) - total_terbayar)
    };
  }).filter(row => row.sisa_tagihan > 0));
});

app.get('/api/kerusakan/belum-lunas', async (_req, res) => {
  const { data: returns, error } = await supabase.from('pengembalian')
    .select('id_pengembalian, id_sewa, biaya_kerusakan')
    .gt('biaya_kerusakan', 0).order('id_pengembalian', { ascending: false });
  if (error) return sendDatabaseError(res, error, 500);
  if (!returns.length) return res.json([]);

  const ids = returns.map(row => row.id_pengembalian);
  const rentalIds = returns.map(row => row.id_sewa);
  const [{ data: payments, error: paymentError }, { data: rentals, error: rentalError }] = await Promise.all([
    supabase.from('pembayaran_kerusakan').select('id_pengembalian, jumlah_bayar').in('id_pengembalian', ids),
    supabase.from('penyewaan').select('id_sewa, pelanggan(nama)').in('id_sewa', rentalIds)
  ]);
  if (paymentError || rentalError) return sendDatabaseError(res, paymentError || rentalError, 500);

  const paidByReturn = new Map();
  for (const payment of payments) {
    paidByReturn.set(payment.id_pengembalian,
      (paidByReturn.get(payment.id_pengembalian) || 0) + Number(payment.jumlah_bayar));
  }
  const rentalById = new Map(rentals.map(row => [row.id_sewa, row]));
  res.json(returns.map(row => {
    const paid = paidByReturn.get(row.id_pengembalian) || 0;
    return {
      ...row,
      nama_pelanggan: rentalById.get(row.id_sewa)?.pelanggan?.nama || 'Pelanggan',
      total_terbayar: paid,
      sisa_kerusakan: Math.max(0, Number(row.biaya_kerusakan) - paid)
    };
  }).filter(row => row.sisa_kerusakan > 0));
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

app.post('/api/pembayaran-kerusakan', async (req, res) => {
  const { id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar } = req.body;
  const amount = Number(jumlah_bayar);
  if (!isPositiveInteger(id_pengembalian) || !isValidDate(tgl_bayar)
    || !Number.isFinite(amount) || amount <= 0
    || !['Tunai', 'Transfer', 'QRIS'].includes(metode_bayar)) {
    return res.status(400).json({ error: 'Lengkapi tagihan, tanggal, jumlah positif, dan metode pembayaran yang valid.' });
  }
  const { data, error } = await supabase.from('pembayaran_kerusakan')
    .insert({ id_pengembalian, tgl_bayar, jumlah_bayar: amount, metode_bayar })
    .select('id_pembayaran_kerusakan, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.post('/api/pembayaran-sewa', async (req, res) => {
  const { id_sewa, tgl_bayar, jumlah_bayar, metode_bayar } = req.body;
  const amount = Number(jumlah_bayar);
  if (!isPositiveInteger(id_sewa) || !isValidDate(tgl_bayar)
    || !Number.isFinite(amount) || amount <= 0 || !['Tunai', 'Transfer', 'QRIS'].includes(metode_bayar)) {
    return res.status(400).json({ error: 'Lengkapi tanggal, jumlah positif, dan metode pembayaran yang valid.' });
  }
  const { data, error } = await supabase.from('pembayaran_sewa')
    .insert({ id_sewa, tgl_bayar, jumlah_bayar: amount, metode_bayar })
    .select('id_pembayaran_sewa, id_sewa, tgl_bayar, jumlah_bayar, metode_bayar').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.get('/api/detail', async (_req, res) => {
  const [customers, equipment, rentals, rentalDetails, returns, payments, rentalPayments, damagePayments] = await Promise.all([
    getAllRows('pelanggan', 'id_pelanggan, nama, no_hp, alamat', 'id_pelanggan'),
    getAllRows('alat_musik', 'id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status', 'id_alat'),
    getAllRows('penyewaan', 'id_sewa, id_pelanggan, tgl_sewa, tgl_rencana_kembali, total_biaya, status_sewa, status_pembayaran_sewa, basis_pencatatan', 'id_sewa'),
    getAllRows('detail_penyewaan', 'id_detail, id_sewa, id_alat, jumlah, subtotal', 'id_detail'),
    getAllRows('pengembalian', 'id_pengembalian, id_sewa, tgl_kembali_aktual, hari_terlambat, total_denda, status_pembayaran_denda, kondisi_alat, biaya_kerusakan, catatan_kerusakan', 'id_pengembalian'),
    getAllRows('pembayaran_denda', 'id_pembayaran, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran'),
    getAllRows('pembayaran_sewa', 'id_pembayaran_sewa, id_sewa, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran_sewa'),
    getAllRows('pembayaran_kerusakan', 'id_pembayaran_kerusakan, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran_kerusakan')
  ]);
  const error = customers.error || equipment.error || rentals.error
    || rentalDetails.error || returns.error || payments.error || rentalPayments.error || damagePayments.error;
  if (error) return sendDatabaseError(res, error, 500);
  res.json({
    customers: customers.data,
    equipment: equipment.data,
    rentals: rentals.data,
    rentalDetails: rentalDetails.data,
    returns: returns.data,
    payments: payments.data,
    rentalPayments: rentalPayments.data,
    damagePayments: damagePayments.data
  });
});

app.get('/api/jurnal', async (_req, res) => {
  const { data, error } = await getAllRows(
    'jurnal_akuntansi',
    'id_jurnal, id_pengembalian, id_sewa, id_pembayaran_sewa, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan',
    'id_jurnal'
  );
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));

app.listen(port, () => {
  console.log(`Aplikasi rental musik berjalan di http://localhost:${port}`);
});
