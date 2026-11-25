const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const allowedOrigins = new Set((process.env.API_ALLOWED_ORIGINS || '')
  .split(',').map(origin => origin.trim()).filter(Boolean));

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di file .env.');
  process.exit(1);
}
if (allowedOrigins.size === 0) {
  console.error('API_ALLOWED_ORIGINS wajib diisi, pisahkan beberapa origin dengan koma.');
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
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const origin = req.get('Origin');
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'Origin tidak diizinkan.' });
  }
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/js/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.RITME_CONFIG = ${JSON.stringify({
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
    apiMode: 'server',
    apiUrl: ''
  })};\n`);
});
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function sendDatabaseError(res, error, status = 400) {
  console.error('Database operation failed:', error.code || '', error.message || error);
  const knownBusinessErrors = new Set([
    'Tanggal rencana kembali harus sama atau setelah tanggal sewa',
    'Pilih minimal satu alat musik',
    'Alat yang sama tidak boleh dipilih lebih dari sekali',
    'Setiap baris alat mewakili satu unit',
    'Satu atau lebih alat sudah tidak tersedia',
    'Data penyewaan tidak ditemukan',
    'Penyewaan ini sudah selesai',
    'Tanggal kembali tidak boleh sebelum tanggal sewa',
    'Pembayaran melebihi sisa tagihan sewa',
    'Pembayaran melebihi sisa tagihan denda'
  ]);
  const errorMessage = error.code === 'P0001' && knownBusinessErrors.has(error.message)
    ? error.message
    : 'Permintaan gagal diproses. Periksa data dan coba lagi.';
  res.status(status).json({ error: errorMessage });
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Akses tidak diizinkan untuk peran Anda.' });
    }
    next();
  };
}

async function authenticate(req, res, next) {
  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Silakan masuk untuk melanjutkan.' });

  let userData;
  let authError;
  try {
    ({ data: userData, error: authError } = await authClient.auth.getUser(match[1]));
  } catch (error) {
    console.error('Auth verification request failed:', error.message || error);
    return res.status(503).json({ error: 'Layanan autentikasi sedang tidak tersedia.' });
  }
  if (authError || !userData.user) {
    return res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' });
  }

  const { data: access, error } = await supabase.from('ritme_user_roles')
    .select('role').eq('user_id', userData.user.id).maybeSingle();
  if (error) {
    console.error('Role lookup failed:', error.code || '', error.message || error);
    return res.status(500).json({ error: 'Akses pengguna gagal diverifikasi.' });
  }
  if (!access || !['admin', 'operasional', 'akuntansi'].includes(access.role)) {
    return res.status(403).json({ error: 'Akun ini belum diberi akses ke aplikasi.' });
  }

  req.user = { id: userData.user.id, email: userData.user.email, role: access.role };
  next();
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

app.use('/api', authenticate);

app.get('/api/me', (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

app.get('/api/dashboard', requireRoles('admin', 'operasional', 'akuntansi'), async (_req, res) => {
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

app.get('/api/pelanggan', requireRoles('admin', 'operasional'), async (_req, res) => {
  const { data, error } = await supabase.from('pelanggan').select('id_pelanggan, nama, no_hp, alamat').order('nama');
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.post('/api/pelanggan', requireRoles('admin', 'operasional'), async (req, res) => {
  const { nama, no_hp, alamat } = req.body || {};
  if (typeof nama !== 'string' || typeof no_hp !== 'string'
    || !nama.trim() || !no_hp.trim() || nama.trim().length > 120
    || no_hp.trim().length > 40 || (alamat != null && typeof alamat !== 'string')
    || (typeof alamat === 'string' && alamat.trim().length > 500)) {
    return res.status(400).json({ error: 'Isi nama, nomor HP, dan alamat dengan format yang valid.' });
  }
  const { data, error } = await supabase.from('pelanggan')
    .insert({ nama: nama.trim(), no_hp: no_hp.trim(), alamat: (alamat || '').trim() })
    .select('id_pelanggan, nama, no_hp, alamat').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.patch('/api/pelanggan/:id', requireRoles('admin', 'operasional'), async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const nama = typeof body.nama === 'string' ? body.nama.trim() : '';
  const no_hp = typeof body.no_hp === 'string' ? body.no_hp.trim() : '';
  const alamat = typeof body.alamat === 'string' ? body.alamat.trim() : '';
  if (!isPositiveInteger(id) || !nama || !no_hp || nama.length > 120 || no_hp.length > 40 || alamat.length > 500) {
    return res.status(400).json({ error: 'ID, nama, dan nomor HP pelanggan wajib valid.' });
  }
  const { data, error } = await supabase.from('pelanggan')
    .update({ nama, no_hp, alamat })
    .eq('id_pelanggan', id).select('id_pelanggan, nama, no_hp, alamat').single();
  if (error?.code === 'PGRST116') return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
  if (error) return sendDatabaseError(res, error);
  res.json(data);
});

app.get('/api/alat-musik', requireRoles('admin', 'operasional'), async (_req, res) => {
  const { data, error } = await supabase.from('alat_musik')
    .select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').order('nama_alat');
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.post('/api/alat-musik', requireRoles('admin', 'operasional'), async (req, res) => {
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

app.patch('/api/alat-musik/:id', requireRoles('admin', 'operasional'), async (req, res) => {
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

app.get('/api/penyewaan/aktif', requireRoles('admin', 'operasional'), async (_req, res) => {
  const { data, error } = await supabase.from('penyewaan')
    .select('id_sewa, tgl_sewa, tgl_rencana_kembali, total_biaya, pelanggan(nama), detail_penyewaan(jumlah, alat_musik(denda_per_hari))')
    .eq('status_sewa', 'Berlangsung').order('tgl_rencana_kembali');
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

app.post('/api/penyewaan', requireRoles('admin', 'operasional'), async (req, res) => {
  const { id_pelanggan, tgl_sewa, tgl_rencana_kembali, items } = req.body || {};
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

app.post('/api/pengembalian', requireRoles('admin', 'operasional'), async (req, res) => {
  const { id_sewa, tgl_kembali_aktual } = req.body || {};
  if (!isPositiveInteger(id_sewa) || !isValidDate(tgl_kembali_aktual)) {
    return res.status(400).json({ error: 'Penyewaan dan tanggal kembali yang valid wajib dipilih.' });
  }
  const { data, error } = await supabase.from('pengembalian')
    .insert({ id_sewa, tgl_kembali_aktual })
    .select('id_pengembalian, id_sewa, hari_terlambat, total_denda, status_pembayaran_denda').single();
  if (error) return sendDatabaseError(res, error);
  res.status(201).json(data);
});

app.get('/api/pengembalian/belum-lunas', requireRoles('admin', 'operasional'), async (_req, res) => {
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

app.get('/api/penyewaan/belum-lunas', requireRoles('admin', 'operasional'), async (_req, res) => {
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

app.post('/api/pembayaran-denda', requireRoles('admin', 'operasional'), async (req, res) => {
  const { id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar } = req.body || {};
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

app.post('/api/pembayaran-sewa', requireRoles('admin', 'operasional'), async (req, res) => {
  const { id_sewa, tgl_bayar, jumlah_bayar, metode_bayar } = req.body || {};
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

app.get('/api/detail', requireRoles('admin', 'operasional', 'akuntansi'), async (req, res) => {
  const [customers, equipment, rentals, rentalDetails, returns, payments, rentalPayments] = await Promise.all([
    getAllRows('pelanggan', 'id_pelanggan, nama, no_hp, alamat', 'id_pelanggan'),
    getAllRows('alat_musik', 'id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status', 'id_alat'),
    getAllRows('penyewaan', 'id_sewa, id_pelanggan, tgl_sewa, tgl_rencana_kembali, total_biaya, status_sewa, status_pembayaran_sewa, basis_pencatatan', 'id_sewa'),
    getAllRows('detail_penyewaan', 'id_detail, id_sewa, id_alat, jumlah, subtotal', 'id_detail'),
    getAllRows('pengembalian', 'id_pengembalian, id_sewa, tgl_kembali_aktual, hari_terlambat, total_denda, status_pembayaran_denda', 'id_pengembalian'),
    getAllRows('pembayaran_denda', 'id_pembayaran, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran'),
    getAllRows('pembayaran_sewa', 'id_pembayaran_sewa, id_sewa, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran_sewa')
  ]);
  const error = customers.error || equipment.error || rentals.error
    || rentalDetails.error || returns.error || payments.error || rentalPayments.error;
  if (error) return sendDatabaseError(res, error, 500);
  res.json({
    customers: req.user.role === 'akuntansi'
      ? customers.data.map(({ id_pelanggan, nama }) => ({ id_pelanggan, nama }))
      : customers.data,
    equipment: equipment.data,
    rentals: rentals.data,
    rentalDetails: rentalDetails.data,
    returns: returns.data,
    payments: payments.data,
    rentalPayments: rentalPayments.data
  });
});

app.get('/api/jurnal', requireRoles('admin', 'operasional', 'akuntansi'), async (_req, res) => {
  const { data, error } = await getAllRows(
    'jurnal_akuntansi',
    'id_jurnal, id_pengembalian, id_sewa, id_pembayaran_sewa, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan',
    'id_jurnal'
  );
  if (error) return sendDatabaseError(res, error, 500);
  res.json(data);
});

async function getAuthUserByEmail(email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { user: null, error };
    const user = data.users.find(item => item.email?.toLowerCase() === email);
    if (user) return { user, error: null };
    if (data.users.length < 1000) break;
  }
  return { user: null, error: null };
}

async function isLastAdmin(userId) {
  const [{ data: target, error: targetError }, { count, error: countError }] = await Promise.all([
    supabase.from('ritme_user_roles').select('role').eq('user_id', userId).maybeSingle(),
    supabase.from('ritme_user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin')
  ]);
  if (targetError || countError) return { lastAdmin: false, error: targetError || countError };
  return { lastAdmin: target?.role === 'admin' && count <= 1, error: null };
}

app.get('/api/admin/users', requireRoles('admin'), async (_req, res) => {
  const { data: roles, error: rolesError } = await supabase.from('ritme_user_roles')
    .select('user_id, role, created_at').order('created_at');
  if (rolesError) return sendDatabaseError(res, rolesError, 500);

  const usersById = new Map();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return res.status(500).json({ error: 'Daftar pengguna tidak dapat dimuat.' });
    for (const authUser of data.users) usersById.set(authUser.id, authUser);
    if (data.users.length < 1000) break;
  }
  res.json(roles.map(role => ({
    id: role.user_id,
    email: usersById.get(role.user_id)?.email || 'Email tidak tersedia',
    role: role.role,
    created_at: role.created_at
  })));
});

app.post('/api/admin/users', requireRoles('admin'), async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const role = req.body?.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || !['admin', 'operasional', 'akuntansi'].includes(role)) {
    return res.status(400).json({ error: 'Masukkan email dan peran yang valid.' });
  }

  let { user, error } = await getAuthUserByEmail(email);
  if (error) {
    console.error('Auth user lookup failed:', error.message || error);
    return res.status(500).json({ error: 'Pengguna tidak dapat diverifikasi.' });
  }
  let invited = false;
  if (!user) {
    const invitation = await supabase.auth.admin.inviteUserByEmail(email);
    if (invitation.error || !invitation.data.user) {
      console.error('User invitation failed:', invitation.error?.message || 'No invited user returned.');
      return res.status(502).json({ error: 'Undangan gagal dikirim. Periksa konfigurasi email Supabase.' });
    }
    user = invitation.data.user;
    invited = true;
  }
  if (user.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Peran administrator Anda tidak dapat diturunkan dari akun ini.' });
  }

  const { error: saveError } = await supabase.from('ritme_user_roles').upsert({
    user_id: user.id,
    role,
    updated_at: new Date().toISOString()
  });
  if (saveError) {
    console.error('User role save failed:', saveError.code || '', saveError.message || saveError);
    if (invited) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) console.error('Failed to clean up invited user:', deleteError.message || deleteError);
    }
    return res.status(500).json({ error: 'Peran pengguna tidak dapat disimpan.' });
  }
  res.status(invited ? 201 : 200).json({ id: user.id, email: user.email, role, invited });
});

app.patch('/api/admin/users/:id', requireRoles('admin'), async (req, res) => {
  const userId = req.params.id;
  const role = req.body?.role;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
    || !['admin', 'operasional', 'akuntansi'].includes(role)) {
    return res.status(400).json({ error: 'ID pengguna atau peran tidak valid.' });
  }
  if (userId === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Peran administrator Anda tidak dapat diturunkan dari akun ini.' });
  }
  if (role !== 'admin') {
    const { lastAdmin, error } = await isLastAdmin(userId);
    if (error) return sendDatabaseError(res, error, 500);
    if (lastAdmin) return res.status(409).json({ error: 'Aplikasi harus memiliki minimal satu administrator.' });
  }
  const { data, error } = await supabase.from('ritme_user_roles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('user_id', userId).select('user_id, role').maybeSingle();
  if (error) return sendDatabaseError(res, error);
  if (!data) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  res.json({ id: data.user_id, role: data.role });
});

app.delete('/api/admin/users/:id', requireRoles('admin'), async (req, res) => {
  const userId = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return res.status(400).json({ error: 'ID pengguna tidak valid.' });
  }
  if (userId === req.user.id) return res.status(400).json({ error: 'Anda tidak dapat mencabut akses akun sendiri.' });
  const { lastAdmin, error: checkError } = await isLastAdmin(userId);
  if (checkError) return sendDatabaseError(res, checkError, 500);
  if (lastAdmin) return res.status(409).json({ error: 'Aplikasi harus memiliki minimal satu administrator.' });
  const { error } = await supabase.from('ritme_user_roles').delete().eq('user_id', userId);
  if (error) return sendDatabaseError(res, error);
  res.sendStatus(204);
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint API tidak ditemukan.' }));

app.listen(port, () => {
  console.log(`Aplikasi rental musik berjalan di http://localhost:${port}`);
});
