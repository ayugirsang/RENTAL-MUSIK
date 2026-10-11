const state = { customers: [], equipment: [], rentals: [], unpaid: [], rentUnpaid: [], journals: [], detail: null, rentalFilter: 'all' };
const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric'
});
const viewLabels = {
  dashboard: 'Ringkasan',
  transactions: 'Rental & pembayaran',
  details: 'Pelanggan & inventaris',
  reports: 'Jurnal umum',
  ledger: 'Buku besar',
  income: 'Laporan pendapatan'
};
const supabaseClient = window.ritmeSupabaseClient;

function localDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDate(value) {
  if (!value) return '-';
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function daysUntil(dateValue, today = localDateValue()) {
  return Math.round((Date.parse(`${dateValue}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

function countRentalDates(rentals, today = localDateValue()) {
  return rentals.reduce((counts, rental) => {
    const days = daysUntil(rental.tgl_rencana_kembali, today);
    if (days < 0) counts.late += 1;
    else if (days <= 3) counts.dueSoon += 1;
    return counts;
  }, { dueSoon: 0, late: 0 });
}

async function api(url, options = {}) {
  if (supabaseClient) return supabaseApi(url, options);
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
  } catch (_error) {
    throw new Error('Server tidak dapat dihubungi. Pastikan aplikasi masih berjalan.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Permintaan gagal (${response.status}).`);
  return payload;
}

async function supabaseApi(url, options = {}) {
  const body = options.body ? JSON.parse(options.body) : {};
  let result;
  if (url === '/api/dashboard') {
    const [payments, rentals, equipment] = await Promise.all([
      getTotalFinePayments(),
      supabaseClient.from('penyewaan').select('id_sewa, tgl_rencana_kembali').eq('status_sewa', 'Berlangsung'),
      supabaseClient.from('alat_musik').select('id_alat, status')
    ]);
    const today = localDateValue();
    const rentalCounts = countRentalDates(rentals.data || [], today);
    result = { data: {
      totalDendaDibayar: payments.total,
      penyewaanBerlangsung: rentals.data?.length,
      penyewaanJatuhTempo: rentalCounts.dueSoon,
      penyewaanTerlambat: rentalCounts.late,
      alatTersedia: equipment.data?.filter(row => row.status === 'Tersedia').length,
      alatDisewa: equipment.data?.filter(row => row.status === 'Disewa').length
    }, error: payments.error || rentals.error || equipment.error };
  } else if (url === '/api/pelanggan' && options.method === 'POST') {
    result = await supabaseClient.from('pelanggan').insert(body).select('id_pelanggan, nama, no_hp, alamat').single();
  } else if (url === '/api/pelanggan') {
    result = await supabaseClient.from('pelanggan').select('id_pelanggan, nama, no_hp, alamat').order('nama');
  } else if (url === '/api/alat-musik' && options.method === 'POST') {
    result = await supabaseClient.from('alat_musik')
      .insert(body).select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').single();
  } else if (url === '/api/alat-musik') {
    result = await supabaseClient.from('alat_musik').select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').order('nama_alat');
  } else if (url === '/api/penyewaan/aktif') {
    result = await supabaseClient.from('penyewaan')
      .select('id_sewa, tgl_sewa, tgl_rencana_kembali, total_biaya, pelanggan(nama), detail_penyewaan(jumlah, alat_musik(denda_per_hari))')
      .eq('status_sewa', 'Berlangsung').order('tgl_rencana_kembali');
  } else if (url === '/api/penyewaan' && options.method === 'POST') {
    result = await supabaseClient.rpc('buat_penyewaan', {
      p_id_pelanggan: body.id_pelanggan,
      p_tgl_sewa: body.tgl_sewa,
      p_tgl_rencana_kembali: body.tgl_rencana_kembali,
      p_items: body.items
    });
    if (!result.error) result = { data: { id_sewa: result.data }, error: null };
  } else if (url === '/api/penyewaan/belum-lunas') {
    const rentals = await supabaseClient.from('penyewaan')
      .select('id_sewa, id_pelanggan, tgl_sewa, total_biaya, status_pembayaran_sewa, basis_pencatatan')
      .in('status_pembayaran_sewa', ['Belum Dicatat', 'Belum Lunas', 'Sebagian'])
      .order('id_sewa', { ascending: false });
    if (rentals.error) result = rentals;
    else if (!rentals.data.length) result = { data: [], error: null };
    else {
      const ids = rentals.data.map(row => row.id_sewa);
      const customerIds = [...new Set(rentals.data.map(row => row.id_pelanggan))];
      const [{ data: payments, error: paymentError }, { data: customers, error: customerError }] = await Promise.all([
        supabaseClient.from('pembayaran_sewa').select('id_sewa, jumlah_bayar').in('id_sewa', ids),
        supabaseClient.from('pelanggan').select('id_pelanggan, nama').in('id_pelanggan', customerIds)
      ]);
      const paidByRental = new Map();
      for (const payment of payments || []) paidByRental.set(payment.id_sewa, (paidByRental.get(payment.id_sewa) || 0) + Number(payment.jumlah_bayar));
      const customerById = new Map((customers || []).map(row => [row.id_pelanggan, row.nama]));
      result = {
        data: rentals.data.map(row => {
          const total_terbayar = paidByRental.get(row.id_sewa) || 0;
          return {
            ...row,
            nama_pelanggan: customerById.get(row.id_pelanggan) || 'Pelanggan',
            total_terbayar,
            sisa_tagihan: Math.max(0, Number(row.total_biaya) - total_terbayar)
          };
        }).filter(row => row.sisa_tagihan > 0),
        error: paymentError || customerError
      };
    }
  } else if (url === '/api/pengembalian' && options.method === 'POST') {
    result = await supabaseClient.from('pengembalian').insert(body)
      .select('id_pengembalian, id_sewa, hari_terlambat, total_denda, status_pembayaran_denda').single();
  } else if (url === '/api/pengembalian/belum-lunas') {
    const returns = await supabaseClient.from('pengembalian')
      .select('id_pengembalian, id_sewa, total_denda, status_pembayaran_denda')
      .in('status_pembayaran_denda', ['Belum Lunas', 'Sebagian']).order('id_pengembalian', { ascending: false });
    if (returns.error) result = returns;
    else if (!returns.data.length) result = { data: [], error: null };
    else {
      const [{ data: payments, error: paymentError }, { data: rentals, error: rentalError }] = await Promise.all([
        supabaseClient.from('pembayaran_denda').select('id_pengembalian, jumlah_bayar').in('id_pengembalian', returns.data.map(row => row.id_pengembalian)),
        supabaseClient.from('penyewaan').select('id_sewa, pelanggan(nama)').in('id_sewa', returns.data.map(row => row.id_sewa))
      ]);
      const paidByReturn = new Map();
      for (const payment of payments || []) paidByReturn.set(payment.id_pengembalian, (paidByReturn.get(payment.id_pengembalian) || 0) + Number(payment.jumlah_bayar));
      const customerByRental = new Map((rentals || []).map(row => [row.id_sewa, row.pelanggan?.nama || 'Pelanggan']));
      result = { data: returns.data.map(row => {
        const total_terbayar = paidByReturn.get(row.id_pengembalian) || 0;
        return {
          ...row,
          nama_pelanggan: customerByRental.get(row.id_sewa),
          total_terbayar,
          sisa_denda: Math.max(0, Number(row.total_denda) - total_terbayar)
        };
      }).filter(row => row.sisa_denda > 0), error: paymentError || rentalError };
    }
  } else if (url === '/api/pembayaran-denda' && options.method === 'POST') {
    result = await supabaseClient.from('pembayaran_denda').insert(body)
      .select('id_pembayaran, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar').single();
  } else if (url === '/api/pembayaran-sewa' && options.method === 'POST') {
    result = await supabaseClient.from('pembayaran_sewa').insert(body)
      .select('id_pembayaran_sewa, id_sewa, tgl_bayar, jumlah_bayar, metode_bayar').single();
  } else if (url === '/api/detail') {
    const [customers, equipment, rentals, rentalDetails, returns, payments, rentalPayments] = await Promise.all([
      getAllSupabaseRows('pelanggan', 'id_pelanggan, nama, no_hp, alamat', 'id_pelanggan'),
      getAllSupabaseRows('alat_musik', 'id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status', 'id_alat'),
      getAllSupabaseRows('penyewaan', 'id_sewa, id_pelanggan, tgl_sewa, tgl_rencana_kembali, total_biaya, status_sewa, status_pembayaran_sewa, basis_pencatatan', 'id_sewa'),
      getAllSupabaseRows('detail_penyewaan', 'id_detail, id_sewa, id_alat, jumlah, subtotal', 'id_detail'),
      getAllSupabaseRows('pengembalian', 'id_pengembalian, id_sewa, tgl_kembali_aktual, hari_terlambat, total_denda, status_pembayaran_denda', 'id_pengembalian'),
      getAllSupabaseRows('pembayaran_denda', 'id_pembayaran, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran'),
      getAllSupabaseRows('pembayaran_sewa', 'id_pembayaran_sewa, id_sewa, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran_sewa')
    ]);
    result = {
      data: { customers: customers.data, equipment: equipment.data, rentals: rentals.data, rentalDetails: rentalDetails.data, returns: returns.data, payments: payments.data, rentalPayments: rentalPayments.data },
      error: customers.error || equipment.error || rentals.error || rentalDetails.error || returns.error || payments.error || rentalPayments.error
    };
  } else if (url === '/api/jurnal') {
    result = await getAllSupabaseRows(
      'jurnal_akuntansi',
      'id_jurnal, id_pengembalian, id_sewa, id_pembayaran_sewa, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan',
      'id_jurnal'
    );
    if (!result.error) result = { data: result.data, error: null };
  } else {
    throw new Error(`Endpoint tidak dikenali: ${url}`);
  }
  if (result.error) throw new Error(result.error.message || 'Permintaan Supabase gagal.');
  return result.data;
}

async function getTotalFinePayments() {
  let total = 0;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseClient.from('pembayaran_denda')
      .select('id_pembayaran, jumlah_bayar')
      .order('id_pembayaran')
      .range(offset, offset + pageSize - 1);
    if (error) return { total, error };
    total += data.reduce((sum, payment) => sum + Number(payment.jumlah_bayar), 0);
    if (data.length < pageSize) return { total, error: null };
  }
}

async function getAllSupabaseRows(table, columns, orderColumn) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseClient.from(table)
      .select(columns)
      .order(orderColumn)
      .range(offset, offset + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...data);
    if (data.length < pageSize) return { data: rows, error: null };
  }
}

function notify(message, isError = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

function setBusy(form, busy) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
}

async function loadDashboard() {
  const [summary, rentals] = await Promise.all([api('/api/dashboard'), api('/api/penyewaan/aktif')]);
  state.rentals = rentals;
  document.querySelector('#metric-active').textContent = summary.penyewaanBerlangsung;
  document.querySelector('#metric-due-soon').textContent = summary.penyewaanJatuhTempo;
  document.querySelector('#metric-late').textContent = summary.penyewaanTerlambat;
  renderDueTable();
  renderSellerFollowup();
  renderRentalOptions();
  syncDateLimits();
  updateFineEstimate();
  renderDashboardAccounting();
}

function renderDueTable() {
  const today = localDateValue();
  const datedRentals = state.rentals.map(rental => ({ rental, days: daysUntil(rental.tgl_rencana_kembali, today) }));
  document.querySelector('#count-rentals').textContent = datedRentals.length;
  document.querySelector('#count-due-soon').textContent = datedRentals.filter(({ days }) => days >= 0 && days <= 3).length;
  document.querySelector('#count-late').textContent = datedRentals.filter(({ days }) => days < 0).length;
  const filtered = datedRentals.filter(({ days }) => {
    if (state.rentalFilter === 'soon') return days >= 0 && days <= 3;
    if (state.rentalFilter === 'late') return days < 0;
    return true;
  });
  const rows = filtered.slice(0, 8).map(({ rental, days }) => {
    const status = days < 0
      ? { className: 'status-late', label: `Terlambat ${Math.abs(days)} hari` }
      : days === 0
        ? { className: 'status-due', label: 'Jatuh tempo hari ini' }
        : days <= 3
          ? { className: 'status-due', label: `Dalam ${days} hari` }
          : { className: 'status-active', label: 'Berlangsung' };
    return `<tr><td><strong>${escapeHtml(rental.pelanggan?.nama || 'Pelanggan')}</strong><small>Sewa #${rental.id_sewa}</small></td><td>${formatDate(rental.tgl_rencana_kembali)}</td><td>${currency.format(Number(rental.total_biaya))}</td><td><span class="status-pill ${status.className}"><i></i>${status.label}</span></td></tr>`;
  }).join('');
  const emptyMessage = state.rentalFilter === 'all' ? 'Belum ada penyewaan aktif.' : 'Tidak ada pengembalian pada filter ini.';
  document.querySelector('#due-table').innerHTML = rows || `<tr><td colspan="4" class="empty-cell">${emptyMessage}</td></tr>`;
  document.querySelector('#due-caption').textContent = filtered.length > 8
    ? `Menampilkan 8 dari ${filtered.length} penyewaan. Kelola daftar lengkap melalui menu Transaksi.`
    : 'Pengingat jatuh tempo mencakup hari ini hingga 3 hari ke depan.';
}

function renderSellerFollowup() {
  const counts = countRentalDates(state.rentals);
  const fineOutstanding = state.unpaid.reduce((sum, item) => sum + Number(item.sisa_denda), 0);
  const confirmedRent = state.rentUnpaid.filter(item => item.status_pembayaran_sewa !== 'Belum Dicatat');
  const unverifiedRent = state.rentUnpaid.filter(item => item.status_pembayaran_sewa === 'Belum Dicatat');
  const rentOutstanding = confirmedRent.reduce((sum, item) => sum + Number(item.sisa_tagihan), 0);
  const reminders = [
    `<div class="followup-item"><span class="followup-indicator ${counts.late ? 'is-urgent' : ''}"></span><span><strong>${counts.late} rental terlambat</strong><small>${counts.late ? 'Hubungi pelanggan dan catat pengembalian.' : 'Tidak ada keterlambatan saat ini.'}</small></span></div>`,
    `<div class="followup-item"><span class="followup-indicator ${counts.dueSoon ? 'is-soon' : ''}"></span><span><strong>${counts.dueSoon} jatuh tempo dalam 3 hari</strong><small>${counts.dueSoon ? 'Ingatkan pelanggan sebelum jadwal kembali.' : 'Belum ada jadwal dekat.'}</small></span></div>`,
    `<div class="followup-item"><span class="followup-indicator ${rentOutstanding || unverifiedRent.length ? 'is-soon' : ''}"></span><span><strong>${confirmedRent.length} tagihan sewa belum lunas</strong><small>Sisa tercatat ${currency.format(rentOutstanding)}${unverifiedRent.length ? ` · ${unverifiedRent.length} rental lama perlu rekonsiliasi.` : rentOutstanding ? ' menunggu pembayaran.' : ' — semua tagihan terverifikasi lunas.'}</small></span></div>`,
    `<div class="followup-item"><span class="followup-indicator ${fineOutstanding ? 'is-soon' : ''}"></span><span><strong>${state.unpaid.length} tagihan denda terbuka</strong><small>Sisa ${currency.format(fineOutstanding)}${fineOutstanding ? ' menunggu pembayaran.' : ' — semua tagihan lunas.'}</small></span></div>`
  ];
  document.querySelector('#seller-followup').innerHTML = reminders.join('');
}

function accountBalance(rows, code) {
  return rows.filter(row => row.kode_akun === code).reduce((balance, row) => {
    const debit = Number(row.debit);
    const credit = Number(row.kredit);
    return balance + (code.startsWith('1') ? debit - credit : credit - debit);
  }, 0);
}

function renderDashboardAccounting() {
  const today = localDateValue();
  const month = today.slice(0, 7);
  const monthJournals = state.journals.filter(row => row.tgl_jurnal.startsWith(month));
  const rentRevenue = accountBalance(monthJournals.filter(row => row.kode_akun === '4100'), '4100');
  const fineRevenue = accountBalance(monthJournals.filter(row => row.kode_akun === '4110'), '4110');
  const rentalPayments = state.detail?.rentalPayments || [];
  const finePayments = state.detail?.payments || [];
  const rentCash = rentalPayments
    .filter(row => row.tgl_bayar.startsWith(month))
    .reduce((sum, row) => sum + Number(row.jumlah_bayar), 0);
  const fineCash = finePayments
    .filter(row => row.tgl_bayar.startsWith(month))
    .reduce((sum, row) => sum + Number(row.jumlah_bayar), 0);
  const receivables = accountBalance(state.journals, '1120') + accountBalance(state.journals, '1130');
  const recognized = rentRevenue + fineRevenue;
  const cash = rentCash + fineCash;

  document.querySelector('#metric-month-revenue').textContent = currency.format(recognized);
  document.querySelector('#metric-month-cash').textContent = currency.format(cash);
  document.querySelector('#metric-receivables').textContent = currency.format(receivables);
  document.querySelector('#metric-available').textContent = state.equipment.filter(row => row.status === 'Tersedia').length;

  const monthLabel = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC', month: 'long', year: 'numeric'
  }).format(new Date(`${month}-01T00:00:00Z`));
  document.querySelector('#dashboard-period').textContent = monthLabel;
  document.querySelector('#monthly-income-summary').innerHTML = `
    <div class="monthly-income-row"><span>Pendapatan sewa</span><strong>${currency.format(rentRevenue)}</strong></div>
    <div class="monthly-income-row"><span>Pendapatan denda</span><strong>${currency.format(fineRevenue)}</strong></div>
    <div class="monthly-income-row total"><span>Total pendapatan diakui</span><strong>${currency.format(recognized)}</strong></div>
    <div class="monthly-income-row"><span>Kas sewa diterima</span><strong>${currency.format(rentCash)}</strong></div>
    <div class="monthly-income-row"><span>Kas denda diterima</span><strong>${currency.format(fineCash)}</strong></div>`;

  const [year, monthNumber] = month.split('-').map(Number);
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const daily = new Map();
  for (const row of monthJournals) {
    if (!['4100', '4110'].includes(row.kode_akun)) continue;
    const values = daily.get(row.tgl_jurnal) || { rent: 0, fine: 0 };
    values[row.kode_akun === '4100' ? 'rent' : 'fine'] += Number(row.kredit) - Number(row.debit);
    daily.set(row.tgl_jurnal, values);
  }
  const maxRevenue = Math.max(0, ...[...daily.values()].map(value => value.rent + value.fine));
  const bars = Array.from({ length: dayCount }, (_value, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const values = daily.get(date) || { rent: 0, fine: 0 };
    const rentHeight = maxRevenue ? values.rent / maxRevenue * 100 : 0;
    const fineHeight = maxRevenue ? values.fine / maxRevenue * 100 : 0;
    const label = day === 1 || day % 5 === 0 || day === dayCount ? day : '';
    return `<div class="chart-day" title="${day} ${monthLabel}: sewa ${currency.format(values.rent)}, denda ${currency.format(values.fine)}">
      <div class="chart-column"><span class="chart-segment chart-segment-rent" style="--rent-height:${rentHeight}%"></span><span class="chart-segment chart-segment-fine" style="--fine-height:${fineHeight}%"></span></div>
      <span class="chart-day-label">${label}</span></div>`;
  }).join('');
  document.querySelector('#revenue-chart').innerHTML = bars;
}

async function loadCustomers() {
  state.customers = await api('/api/pelanggan');
  const select = document.querySelector('#rental-customer');
  const selected = select.value;
  select.innerHTML = '<option value="">Pilih pelanggan</option>' + state.customers.map(customer =>
    `<option value="${customer.id_pelanggan}">${escapeHtml(customer.nama)} · ${escapeHtml(customer.no_hp)}</option>`
  ).join('');
  if (selected) select.value = selected;
}

async function loadEquipment() {
  state.equipment = await api('/api/alat-musik');
  renderEquipment();
  renderDashboardAccounting();
}

async function loadUnpaid() {
  state.unpaid = await api('/api/pengembalian/belum-lunas');
  const select = document.querySelector('#payment-return');
  const previous = select.value;
  select.innerHTML = '<option value="">Pilih tagihan denda</option>' + state.unpaid.map(item =>
    `<option value="${item.id_pengembalian}" data-total="${item.total_denda}" data-paid="${item.total_terbayar}" data-balance="${item.sisa_denda}">Sewa #${item.id_sewa} · ${escapeHtml(item.nama_pelanggan)} · sisa ${currency.format(item.sisa_denda)}</option>`
  ).join('');
  if (previous) select.value = previous;
  updatePaymentBalance();
  renderSellerFollowup();
}

async function loadUnpaidRentals() {
  state.rentUnpaid = await api('/api/penyewaan/belum-lunas');
  const select = document.querySelector('#payment-rental');
  const previous = select.value;
  select.innerHTML = '<option value="">Pilih tagihan sewa</option>' + state.rentUnpaid.map(item =>
    `<option value="${item.id_sewa}" data-total="${item.total_biaya}" data-paid="${item.total_terbayar}" data-balance="${item.sisa_tagihan}" data-status="${escapeHtml(item.status_pembayaran_sewa)}" data-basis="${escapeHtml(item.basis_pencatatan)}">Sewa #${item.id_sewa} · ${escapeHtml(item.nama_pelanggan)} · ${item.status_pembayaran_sewa === 'Belum Dicatat' ? 'belum direkonsiliasi' : escapeHtml(item.status_pembayaran_sewa)} · sisa ${currency.format(item.sisa_tagihan)}</option>`
  ).join('');
  if (previous) select.value = previous;
  updateRentPaymentBalance();
  renderSellerFollowup();
}

async function loadJournals() {
  state.journals = await api('/api/jurnal');
  renderJournals();
  renderDashboardAccounting();
  renderLedger();
  renderIncomeReport();
}

async function loadDetailData() {
  state.detail = await api('/api/detail');
  renderDetailData();
  renderDashboardAccounting();
  renderIncomeReport();
}

function rentalDays() {
  const start = document.querySelector('#rental-date').value;
  const end = document.querySelector('#planned-date').value;
  if (!start || !end) return 1;
  const days = Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000);
  return Math.max(days, 1);
}

function syncDateLimits() {
  const rentalDate = document.querySelector('#rental-date');
  const plannedDate = document.querySelector('#planned-date');
  const returnRental = document.querySelector('#return-rental');
  const actualDate = document.querySelector('#actual-date');
  const today = localDateValue();
  rentalDate.min = today;
  plannedDate.min = rentalDate.value || today;
  if (plannedDate.value && plannedDate.value < plannedDate.min) plannedDate.value = plannedDate.min;
  const rental = state.rentals.find(item => String(item.id_sewa) === returnRental.value);
  actualDate.min = rental?.tgl_sewa || today;
  if (actualDate.value && actualDate.value < actualDate.min) actualDate.value = actualDate.min;
}

function renderEquipment() {
  const list = document.querySelector('#equipment-list');
  const available = state.equipment.filter(item => item.status === 'Tersedia');
  if (!available.length) {
    list.innerHTML = '<div class="quiet-message">Semua alat sedang disewa. Tambahkan unit baru atau tunggu pengembalian.</div>';
    updateRentalEstimate();
    return;
  }
  list.innerHTML = available.map(item => `<label class="equipment-option">
    <input type="checkbox" name="equipment" value="${item.id_alat}" data-rate="${item.harga_sewa_per_hari}">
    <span class="check-box" aria-hidden="true">✓</span>
    ${instrumentArtwork(item.nama_alat)}
    <span class="equipment-name">${escapeHtml(item.nama_alat)}<small>Denda ${currency.format(Number(item.denda_per_hari))} / hari</small></span>
    <strong>${currency.format(Number(item.harga_sewa_per_hari))}<small>/ hari</small></strong>
  </label>`).join('');
  list.querySelectorAll('input').forEach(input => input.addEventListener('change', updateRentalEstimate));
  updateRentalEstimate();
}

function instrumentArtwork(name) {
  const normalized = String(name).toLowerCase();
  if (/keyboard|piano|organ/.test(normalized)) {
    return '<span class="instrument-art art-keys" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="8" y="18" width="48" height="29" rx="5"/><path d="M14 22v20m8-20v20m8-20v20m8-20v20m8-20v20m8-20v20M14 31h36"/><path class="art-detail" d="M18 22v10m8-10v10m8-10v10m8-10v10m8-10v10"/></svg></span>';
  }
  if (/drum|cajon|perkusi|conga|bongo/.test(normalized)) {
    return '<span class="instrument-art art-drum" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M13 24c0-7 8-12 19-12s19 5 19 12v20c0 6-8 10-19 10s-19-4-19-10z"/><path d="M13 24c0 6 8 10 19 10s19-4 19-10M19 36v10m26-10v10M24 15l-7-7m23 7 7-7"/></svg></span>';
  }
  if (/mikrofon|microphone/.test(normalized)) {
    return '<span class="instrument-art art-mic" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="24" y="10" width="16" height="30" rx="8"/><path d="M17 29v4a15 15 0 0 0 30 0v-4M32 48v8m-9 0h18M26 18h12m-12 7h12"/></svg></span>';
  }
  if (/sax|saksofon|terompet|trompet|trumpet|flute|seruling|suling|klarinet|clarinet/.test(normalized)) {
    return '<span class="instrument-art art-wind" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M20 12c5 5 6 10 3 15L15 39a9 9 0 0 0 13 12l13-13c5-5 9-6 15-5"/><path d="M43 16v21m7-18v17m-31 5 8 8m2-15 7 7m-2-15 7 6"/><circle cx="52" cy="33" r="5"/></svg></span>';
  }
  if (/biola|violin|cello|selo/.test(normalized)) {
    return '<span class="instrument-art art-strings" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M29 10h6v13c8 0 11 7 7 13 5 7 1 15-7 15v4h-6v-4c-8 0-12-8-7-15-4-6-1-13 7-13z"/><path d="M32 10v45M23 29h18M20 8l25 48"/></svg></span>';
  }
  if (/ampli|speaker|pengeras suara/.test(normalized)) {
    return '<span class="instrument-art art-default" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="15" y="9" width="34" height="46" rx="5"/><circle cx="32" cy="31" r="11"/><circle cx="32" cy="31" r="4"/><circle cx="23" cy="47" r="1"/><circle cx="29" cy="47" r="1"/></svg></span>';
  }
  if (/gitar|guitar|bass|ukulele|uke/.test(normalized)) {
    return '<span class="instrument-art art-strings" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M37 12 49 7l2 3-9 9 4 5c5 5 4 12-1 16-3 3-7 4-11 2l-5 8c-5 6-13 4-17-1s-3-12 3-16l8-5c-2-4-1-9 2-12 4-4 10-5 15-1z"/><path d="M37 12 17 51M24 26l15 14"/><circle cx="36" cy="32" r="4"/><path class="art-detail" d="M42 9 28 28m4 4 15 13"/></svg></span>';
  }
  return '<span class="instrument-art art-default" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M14 40c0-4 3-7 7-7h5l5-19h5l5 19h3c4 0 7 3 7 7s-3 7-7 7H21c-4 0-7-3-7-7z"/><path d="M32 14h6m-9 13h12m-8-6h4"/></svg></span>';
}

async function addEquipment() {
  const nameInput = document.querySelector('#equipment-name');
  const rateInput = document.querySelector('#equipment-rate');
  const fineInput = document.querySelector('#equipment-fine');
  const nama_alat = nameInput.value.trim();
  const harga_sewa_per_hari = Number(rateInput.value);
  const denda_per_hari = Number(fineInput.value);
  if (!nama_alat || nama_alat.length > 100) return notify('Nama alat wajib diisi (maksimal 100 karakter).', true);
  if (!rateInput.value.trim() || !fineInput.value.trim() ||
      !Number.isFinite(harga_sewa_per_hari) || harga_sewa_per_hari < 0 ||
      !Number.isFinite(denda_per_hari) || denda_per_hari < 0) {
    return notify('Isi harga sewa dan denda dengan angka nol atau lebih.', true);
  }
  const button = document.querySelector('#save-equipment');
  button.disabled = true;
  try {
    const equipment = await api('/api/alat-musik', {
      method: 'POST',
      body: JSON.stringify({ nama_alat, harga_sewa_per_hari, denda_per_hari })
    });
    nameInput.value = '';
    rateInput.value = '';
    fineInput.value = '';
    document.querySelector('#equipment-create').hidden = true;
    document.querySelector('#toggle-equipment-form').setAttribute('aria-expanded', 'false');
    try {
      await Promise.all([loadEquipment(), loadDashboard(), loadDetailData()]);
    } catch (error) {
      return notify(`${equipment.nama_alat} tersimpan, tetapi data tampilan gagal diperbarui: ${error.message}`, true);
    }
    notify(`${equipment.nama_alat} berhasil ditambahkan ke inventaris.`);
  } catch (error) {
    notify(`Gagal menambahkan alat: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function updateRentalEstimate() {
  const selected = [...document.querySelectorAll('input[name="equipment"]:checked')];
  const total = selected.reduce((sum, input) => sum + Number(input.dataset.rate), 0) * rentalDays();
  document.querySelector('#rental-estimate').textContent = currency.format(total);
}

function renderRentalOptions() {
  const select = document.querySelector('#return-rental');
  const previous = select.value;
  select.innerHTML = '<option value="">Pilih penyewaan aktif</option>' + state.rentals.map(rental =>
    `<option value="${rental.id_sewa}">Sewa #${rental.id_sewa} · ${escapeHtml(rental.pelanggan?.nama || 'Pelanggan')} · kembali ${formatDate(rental.tgl_rencana_kembali)}</option>`
  ).join('');
  if (previous) select.value = previous;
}

function updateFineEstimate() {
  const rental = state.rentals.find(item => String(item.id_sewa) === document.querySelector('#return-rental').value);
  const actual = document.querySelector('#actual-date').value;
  if (!rental || !actual) {
    document.querySelector('#fine-estimate').textContent = currency.format(0);
    return;
  }
  const lateDays = Math.max(0, Math.round((new Date(`${actual}T00:00:00`) - new Date(`${rental.tgl_rencana_kembali}T00:00:00`)) / 86400000));
  const perDay = (rental.detail_penyewaan || []).reduce((sum, detail) => sum + Number(detail.jumlah) * Number(detail.alat_musik?.denda_per_hari || 0), 0);
  document.querySelector('#fine-estimate').textContent = currency.format(lateDays * perDay);
}

function updatePaymentBalance() {
  const select = document.querySelector('#payment-return');
  const option = select.selectedOptions[0];
  const amount = document.querySelector('#payment-amount');
  const balanceLabel = document.querySelector('#payment-balance');
  const summary = document.querySelector('#payment-summary');
  const quickActions = document.querySelectorAll('[data-payment-amount]');
  const balance = Number(option?.dataset.balance || 0);
  const total = Number(option?.dataset.total || 0);
  const paid = Number(option?.dataset.paid || 0);
  amount.max = balance || '';
  amount.placeholder = balance ? `Maks. ${currency.format(balance)}` : '0';
  summary.hidden = !select.value;
  summary.textContent = select.value
    ? `Total denda ${currency.format(total)} · Terbayar ${currency.format(paid)} · Sisa ${currency.format(balance)}`
    : '';
  balanceLabel.textContent = balance
    ? 'Masukkan nominal cicilan atau gunakan tombol cepat. Pembayaran bisa dilakukan beberapa kali sampai lunas.'
    : 'Pilih tagihan untuk melihat sisa denda.';
  quickActions.forEach(button => {
    button.disabled = !balance || (button.dataset.paymentAmount === 'half' && balance < 2);
  });
  if (!select.value) amount.value = '';
  else if (select.dataset.previousValue !== select.value) amount.value = balance || '';
  else if (Number(amount.value) > balance) amount.value = balance;
  select.dataset.previousValue = select.value;
}

function updateRentPaymentBalance() {
  const select = document.querySelector('#payment-rental');
  const option = select.selectedOptions[0];
  const amount = document.querySelector('#rent-payment-amount');
  const balanceLabel = document.querySelector('#rent-payment-balance');
  const summary = document.querySelector('#rent-payment-summary');
  const quickActions = document.querySelectorAll('[data-rent-payment-amount]');
  const balance = Number(option?.dataset.balance || 0);
  const total = Number(option?.dataset.total || 0);
  const paid = Number(option?.dataset.paid || 0);
  amount.max = balance || '';
  amount.placeholder = balance ? `Maks. ${currency.format(balance)}` : '0';
  summary.hidden = !select.value;
  summary.textContent = select.value
    ? `Total sewa ${currency.format(total)} · Terbayar ${currency.format(paid)} · Sisa ${currency.format(balance)}`
    : '';
  const legacyBasis = option?.dataset.basis === 'Kas';
  balanceLabel.textContent = !balance
    ? 'Pilih tagihan untuk melihat sisa pembayaran.'
    : legacyBasis
      ? 'Tagihan lama belum direkonsiliasi; pembayaran yang dicatat masuk sebagai pendapatan kas.'
      : 'Masukkan nominal cicilan atau gunakan tombol cepat. Pembayaran bisa dilakukan beberapa kali sampai lunas.';
  quickActions.forEach(button => {
    button.disabled = !balance || (button.dataset.rentPaymentAmount === 'half' && balance < 2);
  });
  if (!select.value) amount.value = '';
  else if (select.dataset.previousValue !== select.value) amount.value = balance || '';
  else if (Number(amount.value) > balance) amount.value = balance;
  select.dataset.previousValue = select.value;
}

function fillPaymentAmount(type) {
  const select = document.querySelector('#payment-return');
  const balance = Number(select.selectedOptions[0]?.dataset.balance || 0);
  if (!balance) return;
  document.querySelector('#payment-amount').value = type === 'half'
    ? Math.floor(balance / 2)
    : balance;
}

function fillRentPaymentAmount(type) {
  const select = document.querySelector('#payment-rental');
  const balance = Number(select.selectedOptions[0]?.dataset.balance || 0);
  if (!balance) return;
  document.querySelector('#rent-payment-amount').value = type === 'half'
    ? Math.floor(balance / 2)
    : balance;
}

function detailLookups() {
  const data = state.detail;
  const customers = new Map(data.customers.map(row => [row.id_pelanggan, row]));
  const equipment = new Map(data.equipment.map(row => [row.id_alat, row]));
  const rentals = new Map(data.rentals.map(row => [row.id_sewa, row]));
  const returns = new Map(data.returns.map(row => [row.id_sewa, row]));
  const paymentsByReturn = new Map();
  for (const payment of data.payments) {
    const payments = paymentsByReturn.get(payment.id_pengembalian) || [];
    payments.push(payment);
    paymentsByReturn.set(payment.id_pengembalian, payments);
  }
  const rentalDetails = new Map();
  for (const detail of data.rentalDetails) {
    const details = rentalDetails.get(detail.id_sewa) || [];
    details.push(detail);
    rentalDetails.set(detail.id_sewa, details);
  }
  const paidByReturn = new Map();
  for (const [id, payments] of paymentsByReturn) {
    paidByReturn.set(id, payments.reduce((sum, payment) => sum + Number(payment.jumlah_bayar), 0));
  }
  const rentalPaymentsByRental = new Map();
  for (const payment of data.rentalPayments) {
    const payments = rentalPaymentsByRental.get(payment.id_sewa) || [];
    payments.push(payment);
    rentalPaymentsByRental.set(payment.id_sewa, payments);
  }
  const paidByRental = new Map();
  for (const [id, payments] of rentalPaymentsByRental) {
    paidByRental.set(id, payments.reduce((sum, payment) => sum + Number(payment.jumlah_bayar), 0));
  }
  return { customers, equipment, rentals, returns, paymentsByReturn, rentalDetails, paidByReturn, rentalPaymentsByRental, paidByRental };
}

function renderDetailData() {
  const data = state.detail;
  const selectReturn = document.querySelector('#history-return');
  const previousReturn = selectReturn.value;
  const selectRental = document.querySelector('#history-rental');
  const previousRental = selectRental.value;
  const selectCustomer = document.querySelector('#history-customer');
  const previousCustomer = selectCustomer.value;
  const { customers, rentals, returns } = detailLookups();
  const customerRows = [...data.customers].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  document.querySelector('#customer-list').innerHTML = `<table><thead><tr><th>NAMA PELANGGAN</th><th>NOMOR HP</th><th>ALAMAT</th><th class="amount-cell">JUMLAH RENTAL</th></tr></thead><tbody>${customerRows.map(customer => {
    const rentalCount = data.rentals.filter(rental => rental.id_pelanggan === customer.id_pelanggan).length;
    return `<tr><td><strong>${escapeHtml(customer.nama)}</strong></td><td>${escapeHtml(customer.no_hp)}</td><td>${escapeHtml(customer.alamat || '—')}</td><td class="amount-cell">${rentalCount}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="empty-cell">Belum ada pelanggan.</td></tr>'}</tbody></table>`;
  const returnRows = [...data.returns].sort((a, b) => b.id_pengembalian - a.id_pengembalian);
  selectReturn.innerHTML = '<option value="">Pilih tagihan denda</option>' + returnRows.map(row => {
    const rental = rentals.get(row.id_sewa);
    const customer = customers.get(rental?.id_pelanggan);
    return `<option value="${row.id_pengembalian}">Sewa #${row.id_sewa} · ${escapeHtml(customer?.nama || 'Pelanggan')} · ${formatDate(row.tgl_kembali_aktual)} · ${currency.format(Number(row.total_denda))}</option>`;
  }).join('');
  if (returnRows.some(row => String(row.id_pengembalian) === previousReturn)) selectReturn.value = previousReturn;
  selectRental.innerHTML = '<option value="">Pilih tagihan sewa</option>' + [...data.rentals]
    .sort((a, b) => b.id_sewa - a.id_sewa)
    .map(row => {
      const customer = customers.get(row.id_pelanggan);
      return `<option value="${row.id_sewa}">Sewa #${row.id_sewa} · ${escapeHtml(customer?.nama || 'Pelanggan')} · ${currency.format(Number(row.total_biaya))}</option>`;
    }).join('');
  if (data.rentals.some(row => String(row.id_sewa) === previousRental)) selectRental.value = previousRental;
  selectCustomer.innerHTML = '<option value="">Pilih pelanggan</option>' + data.customers.map(row =>
    `<option value="${row.id_pelanggan}">${escapeHtml(row.nama)} · ${escapeHtml(row.no_hp)}</option>`
  ).join('');
  if (data.customers.some(row => String(row.id_pelanggan) === previousCustomer)) selectCustomer.value = previousCustomer;
  renderPaymentHistory();
  renderRentalPaymentHistory();
  renderCustomerHistory();
  renderEquipmentReport();
  renderFinancialReport();
  renderLedger();
}

function renderRentalPaymentHistory() {
  const id = Number(document.querySelector('#history-rental').value);
  const container = document.querySelector('#rental-payment-history');
  const rental = state.detail.rentals.find(row => row.id_sewa === id);
  if (!rental) {
    container.innerHTML = '<div class="quiet-message">Pilih penyewaan untuk melihat riwayat pembayarannya.</div>';
    return;
  }
  const { rentalPaymentsByRental, paidByRental } = detailLookups();
  const payments = [...(rentalPaymentsByRental.get(id) || [])].sort((a, b) =>
    b.tgl_bayar.localeCompare(a.tgl_bayar) || b.id_pembayaran_sewa - a.id_pembayaran_sewa);
  const paid = paidByRental.get(id) || 0;
  const balance = Math.max(0, Number(rental.total_biaya) - paid);
  const rows = payments.map(payment => `<tr>
    <td>#${payment.id_pembayaran_sewa}</td><td>${formatDate(payment.tgl_bayar)}</td>
    <td>${escapeHtml(payment.metode_bayar)}</td><td class="amount-cell">${currency.format(Number(payment.jumlah_bayar))}</td>
  </tr>`).join('');
  const legacyNote = rental.basis_pencatatan === 'Kas'
    ? '<small class="field-hint">Tagihan ini berasal dari data sebelum fitur pembayaran sewa. Pembayaran yang dicatat mulai sekarang menggunakan basis kas.</small>'
    : '';
  container.innerHTML = `<div class="detail-balance">Total ${currency.format(Number(rental.total_biaya))} · Dibayar ${currency.format(paid)} · Sisa ${currency.format(balance)} · ${escapeHtml(rental.status_pembayaran_sewa)}</div>
    ${legacyNote}<table><thead><tr><th>PEMBAYARAN</th><th>TANGGAL</th><th>METODE</th><th class="amount-cell">NOMINAL</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty-cell">Belum ada pembayaran untuk penyewaan ini.</td></tr>'}</tbody></table>`;
}

function renderPaymentHistory() {
  const id = Number(document.querySelector('#history-return').value);
  const container = document.querySelector('#payment-history');
  const bill = state.detail.returns.find(row => row.id_pengembalian === id);
  if (!bill) {
    container.innerHTML = '<div class="quiet-message">Pilih tagihan untuk melihat riwayat pembayarannya.</div>';
    return;
  }
  const { paymentsByReturn, paidByReturn } = detailLookups();
  const payments = [...(paymentsByReturn.get(id) || [])].sort((a, b) =>
    b.tgl_bayar.localeCompare(a.tgl_bayar) || b.id_pembayaran - a.id_pembayaran);
  const paid = paidByReturn.get(id) || 0;
  const balance = Math.max(0, Number(bill.total_denda) - paid);
  const rows = payments.map(payment => `<tr>
    <td>#${payment.id_pembayaran}</td><td>${formatDate(payment.tgl_bayar)}</td>
    <td>${escapeHtml(payment.metode_bayar)}</td><td class="amount-cell">${currency.format(Number(payment.jumlah_bayar))}</td>
  </tr>`).join('');
  container.innerHTML = `<div class="detail-balance">Total ${currency.format(Number(bill.total_denda))} · Dibayar ${currency.format(paid)} · Sisa ${currency.format(balance)} · ${escapeHtml(bill.status_pembayaran_denda)}</div>
    <table><thead><tr><th>PEMBAYARAN</th><th>TANGGAL</th><th>METODE</th><th class="amount-cell">NOMINAL</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty-cell">Belum ada pembayaran untuk tagihan ini.</td></tr>'}</tbody></table>`;
}

function renderCustomerHistory() {
  const id = Number(document.querySelector('#history-customer').value);
  const container = document.querySelector('#customer-history');
  if (!id) {
    container.innerHTML = '<div class="quiet-message">Pilih pelanggan untuk melihat riwayatnya.</div>';
    return;
  }
  const { rentals, returns, rentalDetails, equipment, paidByReturn, paidByRental } = detailLookups();
  const rows = state.detail.rentals.filter(row => row.id_pelanggan === id)
    .sort((a, b) => b.tgl_sewa.localeCompare(a.tgl_sewa) || b.id_sewa - a.id_sewa)
    .map(rental => {
      const rentalReturn = returns.get(rental.id_sewa);
      const details = rentalDetails.get(rental.id_sewa) || [];
      const names = details.map(detail => equipment.get(detail.id_alat)?.nama_alat || 'Alat').join(', ');
      const paid = rentalReturn ? paidByReturn.get(rentalReturn.id_pengembalian) || 0 : 0;
      const fine = Number(rentalReturn?.total_denda || 0);
      const balance = Math.max(0, fine - paid);
      const rentPaid = paidByRental.get(rental.id_sewa) || 0;
      const rentBalance = Math.max(0, Number(rental.total_biaya) - rentPaid);
      const rentStatus = rental.status_pembayaran_sewa === 'Belum Dicatat'
        ? 'Belum direkonsiliasi'
        : rental.status_pembayaran_sewa;
      const fineStatus = rentalReturn
        ? fine === 0 ? 'Tidak ada denda' : balance === 0 ? 'Lunas' : paid > 0 ? 'Sebagian' : 'Belum lunas'
        : 'Belum dikembalikan';
      return `<tr><td><strong>Sewa #${rental.id_sewa}</strong><small>${formatDate(rental.tgl_sewa)} – ${formatDate(rental.tgl_rencana_kembali)}</small></td>
        <td>${escapeHtml(names || '—')}</td><td>${escapeHtml(rental.status_sewa)}</td>
        <td class="amount-cell">${currency.format(Number(rental.total_biaya))}</td>
        <td>${escapeHtml(rentStatus)}<small>Sisa ${currency.format(rentBalance)}</small></td>
        <td>${escapeHtml(fineStatus)}<small>${fine ? `${currency.format(paid)} / ${currency.format(fine)}` : ''}</small></td></tr>`;
    }).join('');
  container.innerHTML = `<table><thead><tr><th>PENYEWAAN</th><th>ALAT</th><th>STATUS RENTAL</th><th class="amount-cell">BIAYA SEWA</th><th>STATUS PEMBAYARAN SEWA</th><th>STATUS DENDA</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty-cell">Pelanggan ini belum memiliki riwayat penyewaan.</td></tr>'}</tbody></table>`;
}

function renderEquipmentReport() {
  const { rentals, returns, rentalDetails, paymentsByReturn, equipment } = detailLookups();
  const dataRows = state.detail.equipment.map(item => {
    let rentalCount = 0;
    let rentalIncome = 0;
    let fines = 0;
    let paid = 0;
    for (const rental of state.detail.rentals) {
      const details = rentalDetails.get(rental.id_sewa) || [];
      const itemDetail = details.find(detail => detail.id_alat === item.id_alat);
      if (!itemDetail) continue;
      rentalCount += 1;
      rentalIncome += Number(itemDetail.subtotal);
      const rentalReturn = returns.get(rental.id_sewa);
      if (rentalReturn) {
        const weights = details.map(detail => {
          const instrument = equipment.get(detail.id_alat);
          return Number(instrument?.denda_per_hari || 0) * Number(detail.jumlah);
        });
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        const index = details.indexOf(itemDetail);
        const share = totalWeight ? weights[index] / totalWeight : 0;
        fines += Number(rentalReturn.total_denda) * share;
        paid += (paymentsByReturn.get(rentalReturn.id_pengembalian) || [])
          .reduce((sum, payment) => sum + Number(payment.jumlah_bayar), 0) * share;
      }
    }
    return `<tr><td><strong>${escapeHtml(item.nama_alat)}</strong><small>${currency.format(Number(item.harga_sewa_per_hari))} / hari</small></td>
      <td><span class="status-pill ${item.status === 'Disewa' ? 'status-late' : 'status-active'}">${escapeHtml(item.status)}</span></td>
      <td>${rentalCount}</td><td class="amount-cell">${currency.format(rentalIncome)}</td>
      <td class="amount-cell">${currency.format(fines)}</td><td class="amount-cell">${currency.format(paid)}</td></tr>`;
  }).join('');
  document.querySelector('#equipment-report').innerHTML = `<table><thead><tr><th>ALAT</th><th>STATUS</th><th>JUMLAH SEWA</th><th class="amount-cell">PENDAPATAN SEWA</th><th class="amount-cell">DENDA TERCATAT</th><th class="amount-cell">DENDA DITERIMA</th></tr></thead>
    <tbody>${dataRows || '<tr><td colspan="6" class="empty-cell">Belum ada data inventaris.</td></tr>'}</tbody></table>`;
}

function getFilteredReturns() {
  const start = document.querySelector('#report-start').value;
  const end = document.querySelector('#report-end').value;
  if (start && end && start > end) throw new Error('Tanggal awal laporan tidak boleh melewati tanggal akhir.');
  return state.detail.returns.filter(row =>
    (!start || row.tgl_kembali_aktual >= start) && (!end || row.tgl_kembali_aktual <= end)
  );
}

function renderFinancialReport() {
  if (!state.detail) return;
  let reportReturns;
  try {
    reportReturns = getFilteredReturns();
  } catch (error) {
    document.querySelector('#report-fines').textContent = currency.format(0);
    document.querySelector('#report-paid').textContent = currency.format(0);
    document.querySelector('#report-outstanding').textContent = currency.format(0);
    document.querySelector('#financial-report').innerHTML = `<div class="inline-notice">${escapeHtml(error.message)}</div>`;
    return;
  }
  const { customers, rentals, returns, paymentsByReturn, paidByReturn } = detailLookups();
  const start = document.querySelector('#report-start').value;
  const end = document.querySelector('#report-end').value;
  const periodPayments = state.detail.payments.filter(payment =>
    (!start || payment.tgl_bayar >= start) && (!end || payment.tgl_bayar <= end)
  );
  const outstanding = state.detail.returns.reduce((sum, row) =>
    sum + Math.max(0, Number(row.total_denda) - (paidByReturn.get(row.id_pengembalian) || 0)), 0);
  document.querySelector('#report-fines').textContent = currency.format(
    reportReturns.reduce((sum, row) => sum + Number(row.total_denda), 0)
  );
  document.querySelector('#report-paid').textContent = currency.format(
    periodPayments.reduce((sum, row) => sum + Number(row.jumlah_bayar), 0)
  );
  document.querySelector('#report-outstanding').textContent = currency.format(outstanding);
  const rows = reportReturns.sort((a, b) => b.tgl_kembali_aktual.localeCompare(a.tgl_kembali_aktual))
    .map(row => {
      const rental = [...rentals.values()].find(item => item.id_sewa === row.id_sewa);
      const customer = customers.get(rental?.id_pelanggan);
      const paid = paidByReturn.get(row.id_pengembalian) || 0;
      const balance = Math.max(0, Number(row.total_denda) - paid);
      const status = Number(row.total_denda) === 0 ? 'Tidak ada denda' : balance === 0 ? 'Lunas' : paid > 0 ? 'Sebagian' : 'Belum lunas';
      return `<tr><td>${formatDate(row.tgl_kembali_aktual)}</td><td><strong>${escapeHtml(customer?.nama || 'Pelanggan')}</strong><small>Sewa #${row.id_sewa}</small></td>
        <td class="amount-cell">${currency.format(Number(row.total_denda))}</td><td class="amount-cell">${currency.format(paid)}</td>
        <td class="amount-cell">${currency.format(balance)}</td><td><span class="status-pill detail-status">${escapeHtml(status)}</span></td></tr>`;
    }).join('');
  document.querySelector('#financial-report').innerHTML = `<table><thead><tr><th>TGL. KEMBALI</th><th>PELANGGAN / SEWA</th><th class="amount-cell">DENDA</th><th class="amount-cell">DIBAYAR</th><th class="amount-cell">SISA</th><th>STATUS</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty-cell">Tidak ada denda tercatat pada periode ini.</td></tr>'}</tbody></table>
    <small class="field-hint">Denda tercatat difilter berdasarkan tanggal kembali; pembayaran diterima berdasarkan tanggal bayar. Sisa menunjukkan seluruh tagihan denda yang belum lunas saat ini.</small>`;
}

function exportDetailReport() {
  if (!state.detail) return notify('Data laporan belum dimuat.', true);
  let rows;
  try {
    rows = getFilteredReturns();
  } catch (error) {
    return notify(error.message, true);
  }
  if (!rows.length) return notify('Tidak ada data laporan pada periode ini.', true);
  const { customers, rentals, paidByReturn } = detailLookups();
  const header = ['Tanggal kembali', 'ID sewa', 'Pelanggan', 'Total denda', 'Total dibayar', 'Sisa denda', 'Status'];
  const csvRows = rows.map(row => {
    const rental = rentals.get(row.id_sewa);
    const customer = customers.get(rental?.id_pelanggan);
    const paid = paidByReturn.get(row.id_pengembalian) || 0;
    const balance = Math.max(0, Number(row.total_denda) - paid);
    return [row.tgl_kembali_aktual, row.id_sewa, customer?.nama || 'Pelanggan', row.total_denda, paid, balance, balance ? paid ? 'Sebagian' : 'Belum lunas' : 'Lunas'];
  });
  downloadCsv(`laporan-denda-${document.querySelector('#report-start').value || 'awal'}-${document.querySelector('#report-end').value || 'akhir'}.csv`, [header, ...csvRows]);
}

function getIncomeRows() {
  const start = document.querySelector('#income-start').value;
  const end = document.querySelector('#income-end').value;
  if (start && end && start > end) throw new Error('Tanggal awal laporan tidak boleh melewati tanggal akhir.');

  const months = new Map();
  const getMonth = date => {
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, { month: key, rentRevenue: 0, fineRevenue: 0, rentCash: 0, fineCash: 0 });
    return months.get(key);
  };
  const included = date => (!start || date >= start) && (!end || date <= end);

  for (const row of state.journals) {
    if (!included(row.tgl_jurnal) || !['4100', '4110'].includes(row.kode_akun)) continue;
    const summary = getMonth(row.tgl_jurnal);
    const amount = Number(row.kredit) - Number(row.debit);
    if (row.kode_akun === '4100') summary.rentRevenue += amount;
    else summary.fineRevenue += amount;
  }
  for (const payment of state.detail.rentalPayments) {
    if (included(payment.tgl_bayar)) getMonth(payment.tgl_bayar).rentCash += Number(payment.jumlah_bayar);
  }
  for (const payment of state.detail.payments) {
    if (included(payment.tgl_bayar)) getMonth(payment.tgl_bayar).fineCash += Number(payment.jumlah_bayar);
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

function renderIncomeReport() {
  if (!state.detail) return;
  const metrics = document.querySelector('#income-metrics');
  const container = document.querySelector('#income-report');
  let months;
  try {
    months = getIncomeRows();
  } catch (error) {
    metrics.innerHTML = '';
    container.innerHTML = `<div class="inline-notice">${escapeHtml(error.message)}</div>`;
    return;
  }
  const totals = months.reduce((result, row) => ({
    rentRevenue: result.rentRevenue + row.rentRevenue,
    fineRevenue: result.fineRevenue + row.fineRevenue,
    rentCash: result.rentCash + row.rentCash,
    fineCash: result.fineCash + row.fineCash
  }), { rentRevenue: 0, fineRevenue: 0, rentCash: 0, fineCash: 0 });
  const recognized = totals.rentRevenue + totals.fineRevenue;
  const cash = totals.rentCash + totals.fineCash;
  metrics.innerHTML = `
    <article class="report-metric"><span>Pendapatan sewa diakui</span><strong>${currency.format(totals.rentRevenue)}</strong></article>
    <article class="report-metric"><span>Pendapatan denda diakui</span><strong>${currency.format(totals.fineRevenue)}</strong></article>
    <article class="report-metric"><span>Total pendapatan diakui</span><strong>${currency.format(recognized)}</strong></article>
    <article class="report-metric"><span>Total kas diterima</span><strong>${currency.format(cash)}</strong></article>`;
  const monthRows = months.map(row => {
    const monthLabel = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'UTC', month: 'long', year: 'numeric'
    }).format(new Date(`${row.month}-01T00:00:00Z`));
    return `<tr><td>${monthLabel}</td>
      <td class="amount-cell">${currency.format(row.rentRevenue)}</td>
      <td class="amount-cell">${currency.format(row.fineRevenue)}</td>
      <td class="amount-cell"><strong>${currency.format(row.rentRevenue + row.fineRevenue)}</strong></td>
      <td class="amount-cell">${currency.format(row.rentCash)}</td>
      <td class="amount-cell">${currency.format(row.fineCash)}</td>
      <td class="amount-cell"><strong>${currency.format(row.rentCash + row.fineCash)}</strong></td></tr>`;
  }).join('');
  container.innerHTML = `<table class="income-table"><thead><tr><th>PERIODE</th><th class="amount-cell">PENDAPATAN SEWA</th><th class="amount-cell">PENDAPATAN DENDA</th><th class="amount-cell">TOTAL PENDAPATAN</th><th class="amount-cell">KAS SEWA</th><th class="amount-cell">KAS DENDA</th><th class="amount-cell">TOTAL KAS</th></tr></thead>
    <tbody>${monthRows || '<tr><td colspan="7" class="empty-cell">Belum ada transaksi pendapatan pada periode ini.</td></tr>'}</tbody></table>
    <small class="field-hint">Pendapatan sewa tercatat saat rental baru dibuat (akrual). Pembayaran sewa untuk data lama yang belum direkonsiliasi dicatat sebagai pendapatan saat kas diterima. Kas sewa/denda hanya menunjukkan penerimaan yang tercatat.</small>`;
}

function exportIncomeReport() {
  if (!state.detail) return notify('Data laporan belum dimuat.', true);
  let months;
  try {
    months = getIncomeRows();
  } catch (error) {
    return notify(error.message, true);
  }
  if (!months.length) return notify('Tidak ada transaksi pendapatan pada periode ini.', true);
  const header = ['Periode', 'Pendapatan sewa diakui', 'Pendapatan denda diakui', 'Total pendapatan diakui', 'Kas sewa diterima', 'Kas denda diterima', 'Total kas diterima'];
  const rows = months.map(row => [
    row.month, row.rentRevenue, row.fineRevenue, row.rentRevenue + row.fineRevenue,
    row.rentCash, row.fineCash, row.rentCash + row.fineCash
  ]);
  downloadCsv(`laporan-pendapatan-${document.querySelector('#income-start').value || 'awal'}-${document.querySelector('#income-end').value || 'akhir'}.csv`, [header, ...rows]);
}

function formatAccountBalance(balance, code) {
  const normalSide = code.startsWith('1') ? 'Debit' : 'Kredit';
  const side = balance < 0 ? (normalSide === 'Debit' ? 'Kredit' : 'Debit') : normalSide;
  return `${currency.format(Math.abs(balance))} ${side}`;
}

function getLedgerData() {
  const code = document.querySelector('#ledger-account').value;
  const start = document.querySelector('#ledger-start').value;
  const end = document.querySelector('#ledger-end').value;
  if (start && end && start > end) throw new Error('Tanggal awal buku besar tidak boleh melewati tanggal akhir.');
  if (!code) return null;
  const rows = state.journals.filter(row => row.kode_akun === code);
  const openingRows = start ? rows.filter(row => row.tgl_jurnal < start) : [];
  let balance = openingRows.reduce((total, row) => total + (code.startsWith('1')
    ? Number(row.debit) - Number(row.kredit)
    : Number(row.kredit) - Number(row.debit)), 0);
  const periodRows = rows
    .filter(row => (!start || row.tgl_jurnal >= start) && (!end || row.tgl_jurnal <= end))
    .sort((a, b) => a.tgl_jurnal.localeCompare(b.tgl_jurnal) || a.id_jurnal - b.id_jurnal)
    .map(row => {
      balance += code.startsWith('1')
        ? Number(row.debit) - Number(row.kredit)
        : Number(row.kredit) - Number(row.debit);
      return { ...row, balance };
    });
  return {
    code,
    accountName: rows[0]?.nama_akun || '',
    opening: openingRows.reduce((total, row) => total + (code.startsWith('1')
      ? Number(row.debit) - Number(row.kredit)
      : Number(row.kredit) - Number(row.debit)), 0),
    debit: periodRows.reduce((total, row) => total + Number(row.debit), 0),
    credit: periodRows.reduce((total, row) => total + Number(row.kredit), 0),
    balance,
    rows: periodRows
  };
}

function renderLedger() {
  if (!state.journals.length && !state.detail) return;
  const summary = document.querySelector('#ledger-summary');
  const container = document.querySelector('#ledger-table');
  let data;
  try {
    data = getLedgerData();
  } catch (error) {
    summary.innerHTML = '';
    container.innerHTML = `<tr><td colspan="6" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  if (!data) {
    summary.innerHTML = '';
    container.innerHTML = '<tr><td colspan="6" class="empty-cell">Pilih akun untuk melihat mutasi buku besar.</td></tr>';
    return;
  }
  const closingBalance = data.rows.at(-1)?.balance ?? data.opening;
  summary.innerHTML = `
    <div><span>Saldo awal periode</span><strong>${formatAccountBalance(data.opening, data.code)}</strong></div>
    <div><span>Total debit</span><strong>${currency.format(data.debit)}</strong></div>
    <div><span>Total kredit</span><strong>${currency.format(data.credit)}</strong></div>
    <div><span>Saldo akhir · ${escapeHtml(data.accountName)}</span><strong>${formatAccountBalance(closingBalance, data.code)}</strong></div>`;
  const openingRow = document.querySelector('#ledger-start').value
    ? `<tr><td>${formatDate(document.querySelector('#ledger-start').value)}</td><td><strong>${escapeHtml(data.accountName)}</strong></td><td>Saldo awal periode</td><td class="amount-cell">—</td><td class="amount-cell">—</td><td class="amount-cell"><strong>${formatAccountBalance(data.opening, data.code)}</strong></td></tr>`
    : '';
  const rows = data.rows.map(row => `<tr><td>${formatDate(row.tgl_jurnal)}</td>
    <td><span class="account-code">${escapeHtml(row.kode_akun)}</span><strong>${escapeHtml(row.nama_akun)}</strong></td>
    <td>${escapeHtml(row.keterangan)}</td><td class="amount-cell">${Number(row.debit) ? currency.format(Number(row.debit)) : '—'}</td>
    <td class="amount-cell">${Number(row.kredit) ? currency.format(Number(row.kredit)) : '—'}</td>
    <td class="amount-cell"><strong>${formatAccountBalance(row.balance, data.code)}</strong></td></tr>`).join('');
  container.innerHTML = `${openingRow}${rows || (openingRow ? '' : '<tr><td colspan="6" class="empty-cell">Tidak ada mutasi akun pada periode ini.</td></tr>')}`;
}

function exportLedger() {
  let data;
  try {
    data = getLedgerData();
  } catch (error) {
    return notify(error.message, true);
  }
  if (!data) return notify('Pilih akun sebelum mengunduh buku besar.', true);
  if (!data.rows.length) return notify('Tidak ada mutasi akun pada periode ini.', true);
  const header = ['Tanggal', 'Kode akun', 'Nama akun', 'Keterangan', 'Debit', 'Kredit', 'Saldo berjalan'];
  const rows = data.rows.map(row => [
    row.tgl_jurnal, row.kode_akun, row.nama_akun, row.keterangan, row.debit, row.kredit,
    `${Math.abs(row.balance)} ${row.balance < 0 ? 'saldo normal berlawanan' : 'saldo normal'}`
  ]);
  downloadCsv(`buku-besar-${data.code}-${document.querySelector('#ledger-start').value || 'awal'}-${document.querySelector('#ledger-end').value || 'akhir'}.csv`, [header, ...rows]);
}

function renderJournals() {
  const accountSelect = document.querySelector('#ledger-account');
  const previousAccount = accountSelect.value;
  const accounts = new Map(state.journals.map(row => [row.kode_akun, row.nama_akun]));
  accountSelect.innerHTML = '<option value="">Pilih akun</option>' + [...accounts.entries()]
    .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
    .map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(code)} · ${escapeHtml(name)}</option>`)
    .join('');
  if (accounts.has(previousAccount)) accountSelect.value = previousAccount;
  const debit = state.journals.reduce((sum, row) => sum + Number(row.debit), 0);
  const credit = state.journals.reduce((sum, row) => sum + Number(row.kredit), 0);
  document.querySelector('#journal-debit').textContent = currency.format(debit);
  document.querySelector('#journal-credit').textContent = currency.format(credit);
  document.querySelector('#journal-count').textContent = state.journals.length;
  const rows = [...state.journals].sort((a, b) =>
    b.tgl_jurnal.localeCompare(a.tgl_jurnal) || b.id_jurnal - a.id_jurnal).map(row => `<tr>
    <td class="journal-date">${formatDate(row.tgl_jurnal)}</td>
    <td><span class="account-code">${escapeHtml(row.kode_akun)}</span><strong class="account-name">${escapeHtml(row.nama_akun)}</strong></td>
    <td class="journal-description">${escapeHtml(row.keterangan)}</td>
    <td class="amount-cell">${Number(row.debit) ? currency.format(Number(row.debit)) : '<span class="muted-dash">—</span>'}</td>
    <td class="amount-cell">${Number(row.kredit) ? currency.format(Number(row.kredit)) : '<span class="muted-dash">—</span>'}</td>
  </tr>`).join('');
  document.querySelector('#journal-table').innerHTML = rows || '<tr><td colspan="5" class="empty-cell">Belum ada jurnal yang tercatat.</td></tr>';
  renderLedger();
}

async function refreshAll() {
  await Promise.all([loadCustomers(), loadEquipment(), loadDashboard(), loadUnpaid(), loadUnpaidRentals(), loadJournals(), loadDetailData()]);
}

async function refreshFromButton() {
  const button = document.querySelector('#refresh-data');
  button.disabled = true;
  button.classList.add('is-spinning');
  try {
    await refreshAll();
    notify('Data berhasil diperbarui.');
  } catch (error) {
    notify(`Gagal memperbarui data: ${error.message}`, true);
  } finally {
    button.disabled = false;
    button.classList.remove('is-spinning');
  }
}

function showView(name) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-visible', view.id === `view-${name}`));
  document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('is-active', link.dataset.view === name));
  document.querySelector('#page-label').textContent = viewLabels[name] || 'Ringkasan';
}

function exportJournals() {
  if (!state.journals.length) return notify('Belum ada jurnal untuk diunduh.', true);
  const header = ['Tanggal', 'Kode akun', 'Nama akun', 'Keterangan', 'Debit', 'Kredit'];
  const rows = [...state.journals].sort((a, b) =>
    a.tgl_jurnal.localeCompare(b.tgl_jurnal) || a.id_jurnal - b.id_jurnal)
    .map(row => [row.tgl_jurnal, row.kode_akun, row.nama_akun, row.keterangan, row.debit, row.kredit]);
  downloadCsv(`jurnal-umum-${localDateValue()}.csv`, [header, ...rows]);
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => {
    const text = String(value ?? '');
    const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function initialize() {
  const today = localDateValue();
  document.querySelector('#today-label').textContent = formatDate(today);
  document.querySelector('#current-month').textContent = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', month: 'long', year: 'numeric'
  }).format(new Date());
  document.querySelector('#rental-date').value = today;
  document.querySelector('#planned-date').value = today;
  document.querySelector('#actual-date').value = today;
  document.querySelector('#payment-date').value = today;
  document.querySelector('#rent-payment-date').value = today;
  document.querySelector('#report-start').value = `${today.slice(0, 7)}-01`;
  document.querySelector('#report-end').value = today;
  document.querySelector('#income-start').value = `${today.slice(0, 7)}-01`;
  document.querySelector('#income-end').value = today;
  document.querySelector('#ledger-start').value = `${today.slice(0, 7)}-01`;
  document.querySelector('#ledger-end').value = today;
  syncDateLimits();

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showView(button.dataset.go)));
  document.querySelectorAll('[data-rental-filter]').forEach(button => button.addEventListener('click', () => {
    state.rentalFilter = button.dataset.rentalFilter;
    document.querySelectorAll('[data-rental-filter]').forEach(filter => {
      const isActive = filter === button;
      filter.classList.toggle('is-active', isActive);
      filter.setAttribute('aria-pressed', String(isActive));
    });
    renderDueTable();
  }));
  document.querySelector('#refresh-data').addEventListener('click', refreshFromButton);
  document.querySelector('#rental-date').addEventListener('change', () => {
    syncDateLimits();
    updateRentalEstimate();
  });
  document.querySelector('#planned-date').addEventListener('change', updateRentalEstimate);
  document.querySelector('#return-rental').addEventListener('change', () => {
    syncDateLimits();
    updateFineEstimate();
  });
  document.querySelector('#actual-date').addEventListener('change', updateFineEstimate);
  document.querySelector('#payment-return').addEventListener('change', updatePaymentBalance);
  document.querySelector('#payment-rental').addEventListener('change', updateRentPaymentBalance);
  document.querySelector('#history-return').addEventListener('change', renderPaymentHistory);
  document.querySelector('#history-rental').addEventListener('change', renderRentalPaymentHistory);
  document.querySelector('#history-customer').addEventListener('change', renderCustomerHistory);
  document.querySelector('#apply-report-filter').addEventListener('click', renderFinancialReport);
  document.querySelector('#apply-income-filter').addEventListener('click', renderIncomeReport);
  document.querySelector('#apply-ledger-filter').addEventListener('click', renderLedger);
  document.querySelector('#ledger-account').addEventListener('change', renderLedger);
  document.querySelector('#download-detail-csv').addEventListener('click', exportDetailReport);
  document.querySelector('#download-income-csv').addEventListener('click', exportIncomeReport);
  document.querySelector('#download-ledger-csv').addEventListener('click', exportLedger);
  document.querySelectorAll('[data-payment-amount]').forEach(button => button.addEventListener('click', () => {
    fillPaymentAmount(button.dataset.paymentAmount);
  }));
  document.querySelectorAll('[data-rent-payment-amount]').forEach(button => button.addEventListener('click', () => {
    fillRentPaymentAmount(button.dataset.rentPaymentAmount);
  }));
  document.querySelector('#download-csv').addEventListener('click', exportJournals);

  document.querySelector('#toggle-customer-form').addEventListener('click', () => {
    const form = document.querySelector('#customer-create');
    form.hidden = !form.hidden;
    if (!form.hidden) document.querySelector('#customer-name').focus();
  });

  document.querySelector('#toggle-equipment-form').addEventListener('click', event => {
    const form = document.querySelector('#equipment-create');
    form.hidden = !form.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) document.querySelector('#equipment-name').focus();
  });
  document.querySelector('#save-equipment').addEventListener('click', addEquipment);

  document.querySelector('#save-customer').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const customer = await api('/api/pelanggan', {
        method: 'POST',
        body: JSON.stringify({
          nama: document.querySelector('#customer-name').value,
          no_hp: document.querySelector('#customer-phone').value,
          alamat: document.querySelector('#customer-address').value
        })
      });
      await Promise.all([loadCustomers(), loadDetailData()]);
      document.querySelector('#rental-customer').value = customer.id_pelanggan;
      document.querySelector('#customer-create').hidden = true;
      document.querySelector('#customer-create').querySelectorAll('input').forEach(input => { input.value = ''; });
      notify('Pelanggan berhasil disimpan.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#rental-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const items = [...form.querySelectorAll('input[name="equipment"]:checked')].map(input => ({ id_alat: Number(input.value) }));
    if (!items.length) return notify('Pilih minimal satu unit alat musik.', true);
    setBusy(form, true);
    try {
      const result = await api('/api/penyewaan', { method: 'POST', body: JSON.stringify({
        id_pelanggan: Number(document.querySelector('#rental-customer').value),
        tgl_sewa: document.querySelector('#rental-date').value,
        tgl_rencana_kembali: document.querySelector('#planned-date').value,
        items
      }) });
      notify(`Penyewaan #${result.id_sewa} berhasil dibuat.`);
      form.reset();
      document.querySelector('#rental-date').value = today;
      document.querySelector('#planned-date').value = today;
      syncDateLimits();
      await Promise.all([loadEquipment(), loadDashboard(), loadUnpaidRentals(), loadJournals(), loadDetailData()]);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy(form, false);
    }
  });

  document.querySelector('#return-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(form, true);
    try {
      const result = await api('/api/pengembalian', { method: 'POST', body: JSON.stringify({
        id_sewa: Number(document.querySelector('#return-rental').value),
        tgl_kembali_aktual: document.querySelector('#actual-date').value
      }) });
      notify(result.hari_terlambat > 0
        ? `Pengembalian dicatat. Denda ${currency.format(Number(result.total_denda))} untuk ${result.hari_terlambat} hari terlambat.`
        : 'Pengembalian dicatat tanpa denda.');
      form.reset();
      document.querySelector('#actual-date').value = today;
      await Promise.all([loadEquipment(), loadDashboard(), loadUnpaid(), loadJournals(), loadDetailData()]);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy(form, false);
    }
  });

  document.querySelector('#payment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const amount = Number(document.querySelector('#payment-amount').value);
    const selected = state.unpaid.find(item => String(item.id_pengembalian) === document.querySelector('#payment-return').value);
    if (!selected || !Number.isFinite(amount) || amount <= 0) return notify('Pilih tagihan dan masukkan nominal cicilan yang valid.', true);
    if (amount > selected.sisa_denda) return notify('Jumlah pembayaran melebihi sisa denda.', true);
    const remaining = selected.sisa_denda - amount;
    setBusy(form, true);
    try {
      await api('/api/pembayaran-denda', { method: 'POST', body: JSON.stringify({
        id_pengembalian: Number(document.querySelector('#payment-return').value),
        tgl_bayar: document.querySelector('#payment-date').value,
        jumlah_bayar: amount,
        metode_bayar: document.querySelector('#payment-method').value
      }) });
      notify(remaining > 0
        ? `Cicilan ${currency.format(amount)} tersimpan. Sisa denda ${currency.format(remaining)}.`
        : 'Denda lunas. Pembayaran dan jurnal kas berhasil diperbarui.');
      form.reset();
      document.querySelector('#payment-date').value = today;
      document.querySelector('#payment-method').value = 'Tunai';
      await Promise.all([loadUnpaid(), loadJournals(), loadDashboard(), loadDetailData()]);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setBusy(form, false);
    }
  });

  document.querySelector('#rent-payment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const idSewa = document.querySelector('#payment-rental').value;
    const amount = Number(document.querySelector('#rent-payment-amount').value);
    const selected = state.rentUnpaid.find(item => String(item.id_sewa) === idSewa);
    if (!selected || !Number.isFinite(amount) || amount <= 0) {
      return notify('Pilih tagihan sewa dan masukkan nominal pembayaran yang valid.', true);
    }
    if (amount > selected.sisa_tagihan) return notify('Jumlah pembayaran melebihi sisa tagihan sewa.', true);
    const remaining = selected.sisa_tagihan - amount;
    setBusy(form, true);
    try {
      await api('/api/pembayaran-sewa', { method: 'POST', body: JSON.stringify({
        id_sewa: Number(idSewa),
        tgl_bayar: document.querySelector('#rent-payment-date').value,
        jumlah_bayar: amount,
        metode_bayar: document.querySelector('#rent-payment-method').value
      }) });
      notify(remaining > 0
        ? `Cicilan ${currency.format(amount)} tersimpan. Sisa sewa ${currency.format(remaining)}.`
        : 'Tagihan sewa lunas. Pembayaran dan jurnal berhasil diperbarui.');
      form.reset();
      document.querySelector('#rent-payment-date').value = today;
      document.querySelector('#rent-payment-method').value = 'Tunai';
      await Promise.all([loadUnpaidRentals(), loadJournals(), loadDashboard(), loadDetailData()]);
    } catch (error) {
      notify(`Gagal menyimpan pembayaran sewa: ${error.message}`, true);
    } finally {
      setBusy(form, false);
    }
  });

  refreshAll().catch(error => notify(`Gagal memuat data: ${error.message}`, true));
}

document.addEventListener('DOMContentLoaded', initialize);
