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
let appInitialized = false;

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
  if (supabaseClient && window.RITME_CONFIG?.apiMode !== 'server') return supabaseApi(url, options);
  const apiBaseUrl = String(window.RITME_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  const requestUrl = apiBaseUrl ? `${apiBaseUrl}${url}` : url;
  const headers = {};
  if (supabaseClient) {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw new Error('Sesi login tidak dapat diverifikasi. Silakan masuk kembali.');
    if (!data.session?.access_token) throw new Error('Sesi login berakhir. Silakan masuk kembali.');
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let response;
  try {
    response = await fetch(requestUrl, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.method && options.method !== 'GET' && window.crypto?.randomUUID
          ? { 'Idempotency-Key': crypto.randomUUID() }
          : {}),
        ...headers,
        ...options.headers
      }
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
    const [rentals, equipment] = await Promise.all([
      supabaseClient.from('penyewaan').select('id_sewa, tgl_rencana_kembali').eq('status_sewa', 'Berlangsung'),
      supabaseClient.from('alat_musik').select('id_alat, status')
    ]);
    const today = localDateValue();
    const rentalCounts = countRentalDates(rentals.data || [], today);
    result = { data: {
      penyewaanBerlangsung: rentals.data?.length,
      penyewaanJatuhTempo: rentalCounts.dueSoon,
      penyewaanTerlambat: rentalCounts.late,
      alatTersedia: equipment.data?.filter(row => row.status === 'Tersedia').length,
      alatDisewa: equipment.data?.filter(row => row.status === 'Disewa').length
    }, error: rentals.error || equipment.error };
  } else if (url.startsWith('/api/pelanggan/') && options.method === 'PATCH') {
    const id = Number(url.split('/').pop());
    result = await supabaseClient.from('pelanggan').update(body)
      .eq('id_pelanggan', id).select('id_pelanggan, nama, no_hp, alamat').single();
  } else if (url === '/api/pelanggan' && options.method === 'POST') {
    result = await supabaseClient.from('pelanggan').insert(body).select('id_pelanggan, nama, no_hp, alamat').single();
  } else if (url === '/api/pelanggan') {
    result = await supabaseClient.from('pelanggan').select('id_pelanggan, nama, no_hp, alamat').order('nama');
  } else if (url.startsWith('/api/alat-musik/') && options.method === 'PATCH') {
    const id = Number(url.split('/').pop());
    const current = await supabaseClient.from('alat_musik')
      .select('status, harga_sewa_per_hari, denda_per_hari').eq('id_alat', id).single();
    if (current.error) result = current;
    else if (current.data.status === 'Disewa'
      && (Number(body.harga_sewa_per_hari) !== Number(current.data.harga_sewa_per_hari)
        || Number(body.denda_per_hari) !== Number(current.data.denda_per_hari))) {
      throw new Error('Tarif alat tidak dapat diubah selama alat sedang disewa.');
    } else {
      result = await supabaseClient.from('alat_musik').update(body)
        .eq('id_alat', id).eq('status', current.data.status)
        .select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').single();
      if (result.error?.code === 'PGRST116') {
        throw new Error('Status alat berubah. Muat ulang data sebelum mengubah inventaris.');
      }
    }
  } else if (url === '/api/alat-musik' && options.method === 'POST') {
    result = await supabaseClient.from('alat_musik')
      .insert(body).select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').single();
  } else if (url === '/api/alat-musik') {
    result = await supabaseClient.from('alat_musik').select('id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status').order('nama_alat');
  } else if (url === '/api/penyewaan/aktif') {
    result = await supabaseClient.from('penyewaan')
      .select('id_sewa, id_pelanggan, tgl_sewa, tgl_rencana_kembali, total_biaya, pelanggan(nama, no_hp), detail_penyewaan(jumlah, subtotal, alat_musik(nama_alat, harga_sewa_per_hari, denda_per_hari))')
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
  const datedRentals = state.rentals
    .map(rental => ({ rental, days: daysUntil(rental.tgl_rencana_kembali, today) }))
    .sort((a, b) => a.days - b.days || a.rental.id_sewa - b.rental.id_sewa);
  document.querySelector('#count-rentals').textContent = datedRentals.length;
  document.querySelector('#count-due-soon').textContent = datedRentals.filter(({ days }) => days >= 0 && days <= 3).length;
  document.querySelector('#count-late').textContent = datedRentals.filter(({ days }) => days < 0).length;
  const actionCount = datedRentals.filter(({ days }) => days <= 0).length;
  const alert = document.querySelector('#due-alert');
  alert.hidden = actionCount === 0;
  document.querySelector('#due-alert-title').textContent =
    `Perhatian: ${actionCount} transaksi perlu tindakan hari ini`;
  const dueTodayCount = datedRentals.filter(({ days }) => days === 0).length;
  const lateCount = datedRentals.filter(({ days }) => days < 0).length;
  document.querySelector('#due-alert-detail').textContent =
    `${dueTodayCount} jatuh tempo hari ini · ${lateCount} terlambat.`;
  const filtered = datedRentals.filter(({ days }) => {
    if (state.rentalFilter === 'soon') return days >= 0 && days <= 3;
    if (state.rentalFilter === 'late') return days < 0;
    return true;
  });
  const rows = filtered.slice(0, 8).map(({ rental, days }) => {
    const status = days < 0
      ? { className: 'status-late', rowClass: 'is-overdue', label: `Terlambat ${Math.abs(days)} hari` }
      : days === 0
        ? { className: 'status-today', rowClass: 'is-due-today', label: 'Jatuh tempo hari ini' }
        : days <= 3
            ? { className: 'status-due', rowClass: 'is-due-soon', label: days === 1 ? 'H-1' : `Dalam ${days} hari` }
          : { className: 'status-active', rowClass: '', label: 'Berlangsung' };
    const needsReminder = days <= 3;
    const reminder = needsReminder
        ? rental.pelanggan?.no_hp
          ? `<a class="button button-outline button-small whatsapp-reminder" href="${createWhatsAppReminder(rental)}" target="_blank" rel="noopener noreferrer" aria-label="Kirim pengingat WhatsApp untuk Sewa #${rental.id_sewa}">WhatsApp</a>`
          : '<span class="muted-dash">No. HP tidak tersedia</span>'
        : '<span class="muted-dash">—</span>';
    const lateNotice = days < 0
      ? `<button class="record-edit-button" type="button" data-print-late-notice="${rental.id_sewa}">Cetak tagihan PDF</button>`
      : '';
    return `<tr class="${status.rowClass}"><td><strong>${escapeHtml(rental.pelanggan?.nama || 'Pelanggan')}</strong><small>Sewa #${rental.id_sewa}</small></td><td>${formatDate(rental.tgl_rencana_kembali)}</td><td>${currency.format(Number(rental.total_biaya))}</td><td><span class="status-pill ${status.className}"><i></i>${status.label}</span></td><td class="receipt-actions">${reminder}${lateNotice}</td></tr>`;
  }).join('');
  const emptyMessage = state.rentalFilter === 'all' ? 'Belum ada penyewaan aktif.' : 'Tidak ada pengembalian pada filter ini.';
  document.querySelector('#due-table').innerHTML = rows || `<tr><td colspan="5" class="empty-cell">${emptyMessage}</td></tr>`;
  document.querySelector('#due-caption').textContent = filtered.length > 8
    ? `Menampilkan 8 dari ${filtered.length} rental, diurutkan berdasarkan tanggal terdekat. Kelola daftar lengkap melalui menu Transaksi.`
    : state.rentalFilter === 'all'
      ? 'Jadwal terdekat ditampilkan lebih dahulu. Pengingat mencakup hari ini hingga 3 hari ke depan.'
      : 'Jadwal terdekat ditampilkan lebih dahulu.';
}

function createWhatsAppReminder(rental) {
  const phone = String(rental.pelanggan?.no_hp || '').replace(/\D/g, '');
  const internationalPhone = phone.startsWith('0') ? `62${phone.slice(1)}` : phone.startsWith('8') ? `62${phone}` : phone;
  const items = (rental.detail_penyewaan || [])
    .map(detail => `${detail.jumlah || 1} ${detail.alat_musik?.nama_alat || 'alat musik'}`)
    .join(', ') || 'alat musik';
  const finePerDay = (rental.detail_penyewaan || []).reduce((total, detail) =>
    total + Number(detail.jumlah || 1) * Number(detail.alat_musik?.denda_per_hari || 0), 0);
  const days = daysUntil(rental.tgl_rencana_kembali);
  const dueText = days < 0
    ? `sudah terlambat ${Math.abs(days)} hari sejak ${formatDate(rental.tgl_rencana_kembali)}`
    : days === 0
      ? `jatuh tempo hari ini (${formatDate(rental.tgl_rencana_kembali)})`
      : `jatuh tempo pada ${formatDate(rental.tgl_rencana_kembali)}`;
  const message = `Halo ${rental.pelanggan?.nama || 'Pelanggan'}, pengingat penyewaan ${items} dari Ritme ${dueText}. Denda keterlambatan ${currency.format(finePerDay)} per hari. Mohon hubungi Ritme jika perlu bantuan. Terima kasih.`;
  return `https://wa.me/${encodeURIComponent(internationalPhone)}?text=${encodeURIComponent(message)}`;
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
  const photo = instrumentPhoto(normalized);
  if (photo) {
    return `<span class="instrument-art instrument-photo" aria-hidden="true"><img src="img/instruments/${photo}" alt="" loading="lazy"></span>`;
  }
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

function instrumentPhoto(name) {
  if (/keyboard|piano|organ/.test(name)) return 'keyboard.jpg';
  if (/cajon/.test(name)) return 'cajon.png';
  if (/conga|bongo|perkusi/.test(name)) return 'percussion.jpg';
  if (/drum/.test(name)) return 'drums.jpg';
  if (/mikrofon|microphone/.test(name)) return 'microphone.jpg';
  if (/sax|saksofon|klarinet|clarinet/.test(name)) return 'saxophone.jpg';
  if (/terompet|trompet|trumpet/.test(name)) return 'trumpet.jpg';
  if (/flute|seruling|suling/.test(name)) return 'flute.jpg';
  if (/biola|violin|cello|selo/.test(name)) return 'violin.jpg';
  if (/ampli|speaker|pengeras suara/.test(name)) return 'amplifier.jpg';
  if (/ukulele|uke/.test(name)) return 'ukulele.jpg';
  if (/gitar akustik|guitar acoustic|acoustic guitar/.test(name)) return 'acoustic-guitar.jpg';
  if (/gitar elektrik|gitar listrik|guitar electric|electric guitar|bass/.test(name)) return 'electric-guitar.jpg';
  if (/gitar|guitar/.test(name)) return 'acoustic-guitar.jpg';
  return null;
}

async function addEquipment() {
  const nameInput = document.querySelector('#equipment-name');
  const rateInput = document.querySelector('#equipment-rate');
  const fineInput = document.querySelector('#equipment-fine');
  const button = document.querySelector('#save-equipment');
  if (button.disabled) return;
  const nama_alat = nameInput.value.trim();
  const harga_sewa_per_hari = Number(rateInput.value);
  const denda_per_hari = Number(fineInput.value);
  if (!nama_alat || nama_alat.length > 100) return notify('Nama alat wajib diisi (maksimal 100 karakter).', true);
  if (!rateInput.value.trim() || !fineInput.value.trim() ||
      !Number.isFinite(harga_sewa_per_hari) || harga_sewa_per_hari < 0 ||
      !Number.isFinite(denda_per_hari) || denda_per_hari < 0) {
    return notify('Isi harga sewa dan denda dengan angka nol atau lebih.', true);
  }
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
  updateCashChange('payment-form');
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
  updateCashChange('rent-payment-form');
}

function updateCashChange(formId) {
  const form = document.querySelector(`#${formId}`);
  const isFine = formId === 'payment-form';
  const amount = form.querySelector(isFine ? '#payment-amount' : '#rent-payment-amount');
  const method = form.querySelector(isFine ? '#payment-method' : '#rent-payment-method');
  const received = form.querySelector(isFine ? '#payment-cash-received' : '#rent-payment-cash-received');
  const feedback = form.querySelector(isFine ? '#payment-cash-feedback' : '#rent-payment-cash-feedback');
  const button = form.querySelector('[type="submit"]');
  const payment = Number(amount.value) || 0;
  const cashReceived = Number(received.value) || 0;
  const cashMode = method.value === 'Tunai';

  received.disabled = !cashMode;
  if (!cashMode) {
    received.value = amount.value || '';
    feedback.textContent = `Metode ${method.value}: uang diterima sama dengan nominal pembayaran, kembalian Rp0.`;
    feedback.classList.remove('is-error', 'is-success');
  } else if (payment > cashReceived) {
    feedback.textContent = `Nominal uang tunai masih kurang ${currency.format(payment - cashReceived)}.`;
    feedback.classList.add('is-error');
    feedback.classList.remove('is-success');
  } else if (payment > 0) {
    feedback.textContent = `Uang kembalian: ${currency.format(cashReceived - payment)}.`;
    feedback.classList.add('is-success');
    feedback.classList.remove('is-error');
  } else {
    feedback.textContent = 'Pilih tagihan dan masukkan jumlah uang diterima.';
    feedback.classList.remove('is-error', 'is-success');
  }
  if (form.dataset.submitting !== 'true') {
    button.disabled = cashMode && (payment <= 0 || cashReceived < payment);
  }
}

function setQuickCash(button) {
  const form = document.querySelector(`#${button.closest('[data-cash-quick-for]').dataset.cashQuickFor}`);
  const isFine = form.id === 'payment-form';
  const amount = form.querySelector(isFine ? '#payment-amount' : '#rent-payment-amount');
  const received = form.querySelector(isFine ? '#payment-cash-received' : '#rent-payment-cash-received');
  if (button.dataset.cashAmount === 'exact') received.value = amount.value || '';
  else received.value = button.dataset.cashAmount;
  received.dispatchEvent(new Event('input', { bubbles: true }));
}

function requestConfirmation({ title, content, confirmLabel }) {
  const dialog = document.querySelector('#action-confirmation');
  const confirmButton = document.querySelector('#action-confirmation-confirm');
  document.querySelector('#action-confirmation-title').textContent = title;
  document.querySelector('#action-confirmation-content').innerHTML = content;
  confirmButton.textContent = confirmLabel;
  confirmButton.disabled = false;
  dialog.showModal();
  return new Promise(resolve => {
    let settled = false;
    const cancelButton = document.querySelector('#action-confirmation-cancel');
    const closeButton = document.querySelector('#action-confirmation-close');
    const cleanup = () => {
      confirmButton.removeEventListener('click', onConfirm);
      cancelButton.removeEventListener('click', onCancel);
      closeButton.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onCancel);
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onConfirm = () => {
      confirmButton.disabled = true;
      confirmButton.textContent = 'Memproses...';
      finish(true);
    };
    const onCancel = () => finish(false);
    confirmButton.addEventListener('click', onConfirm);
    cancelButton.addEventListener('click', onCancel);
    closeButton.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onCancel);
  });
}

function returnConfirmationContent(rental, actualDate) {
  const plannedDays = Math.max(1, -daysUntil(rental.tgl_sewa, rental.tgl_rencana_kembali));
  const actualDays = Math.max(1, -daysUntil(rental.tgl_sewa, actualDate));
  const lateDays = Math.max(0, -daysUntil(rental.tgl_rencana_kembali, actualDate));
  const perDay = (rental.detail_penyewaan || []).reduce((sum, detail) =>
    sum + Number(detail.jumlah || 1) * Number(detail.alat_musik?.denda_per_hari || 0), 0);
  const items = (rental.detail_penyewaan || []).map(detail =>
    `${detail.jumlah || 1} × ${detail.alat_musik?.nama_alat || 'Alat musik'}`).join(', ') || 'Rincian alat tidak tersedia';
  return `<dl class="confirmation-summary">
    <div><dt>Pelanggan</dt><dd>${escapeHtml(rental.pelanggan?.nama || 'Pelanggan')}</dd></div>
    <div><dt>Alat dikembalikan</dt><dd>${escapeHtml(items)}</dd></div>
    <div><dt>Durasi rencana / aktual</dt><dd>${plannedDays} / ${actualDays} hari</dd></div>
    <div><dt>Jatuh tempo / kembali</dt><dd>${formatDate(rental.tgl_rencana_kembali)} / ${formatDate(actualDate)}</dd></div>
    <div><dt>Keterlambatan</dt><dd>${lateDays} hari</dd></div>
    <div><dt>Perkiraan denda</dt><dd>${currency.format(lateDays * perDay)} (${currency.format(perDay)} / hari)</dd></div>
  </dl><p class="confirmation-warning">Tindakan ini akan mengembalikan ketersediaan stok alat dan mencatat piutang denda ke pembukuan.</p>`;
}

function paymentConfirmationContent({ total, paid, amount, remaining, method, kind }) {
  return `<dl class="confirmation-summary">
    <div><dt>Total tagihan ${kind}</dt><dd>${currency.format(total)}</dd></div>
    <div><dt>Sudah dibayar</dt><dd>${currency.format(paid)}</dd></div>
    <div><dt>Dibayar sekarang</dt><dd>${currency.format(amount)}</dd></div>
    <div><dt>Metode</dt><dd>${escapeHtml(method)}</dd></div>
    <div><dt>Sisa setelah pembayaran</dt><dd>${currency.format(remaining)}</dd></div>
  </dl><p class="confirmation-warning">Pastikan nominal dan metode pembayaran benar sebelum dicatat.</p>`;
}

function fillPaymentAmount(type) {
  const select = document.querySelector('#payment-return');
  const balance = Number(select.selectedOptions[0]?.dataset.balance || 0);
  if (!balance) return;
  document.querySelector('#payment-amount').value = type === 'half'
    ? Math.floor(balance / 2)
    : balance;
  document.querySelector('#payment-amount').dispatchEvent(new Event('input', { bubbles: true }));
}

function fillRentPaymentAmount(type) {
  const select = document.querySelector('#payment-rental');
  const balance = Number(select.selectedOptions[0]?.dataset.balance || 0);
  if (!balance) return;
  document.querySelector('#rent-payment-amount').value = type === 'half'
    ? Math.floor(balance / 2)
    : balance;
  document.querySelector('#rent-payment-amount').dispatchEvent(new Event('input', { bubbles: true }));
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
  document.querySelector('#customer-list').innerHTML = `<table><thead><tr><th>NAMA PELANGGAN</th><th>NOMOR HP</th><th>ALAMAT</th><th class="amount-cell">JUMLAH RENTAL</th><th>AKSI</th></tr></thead><tbody>${customerRows.map(customer => {
    const rentalCount = data.rentals.filter(rental => rental.id_pelanggan === customer.id_pelanggan).length;
    return `<tr><td><strong>${escapeHtml(customer.nama)}</strong></td><td>${escapeHtml(customer.no_hp)}</td><td>${escapeHtml(customer.alamat || '—')}</td><td class="amount-cell">${rentalCount}</td>
      <td><button class="record-edit-button" type="button" data-edit-record="customer" data-record-id="${customer.id_pelanggan}">Ubah</button></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-cell">Belum ada pelanggan.</td></tr>'}</tbody></table>`;
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
    <td class="receipt-actions"><button class="record-edit-button" type="button" data-print-receipt="rental-payment" data-receipt-id="${payment.id_pembayaran_sewa}">Cetak struk</button><button class="record-edit-button" type="button" data-print-pdf="rental-payment" data-receipt-id="${payment.id_pembayaran_sewa}">Unduh PDF</button></td>
  </tr>`).join('');
  const legacyNote = rental.basis_pencatatan === 'Kas'
    ? '<small class="field-hint">Tagihan ini berasal dari data sebelum fitur pembayaran sewa. Pembayaran yang dicatat mulai sekarang menggunakan basis kas.</small>'
    : '';
  container.innerHTML = `<div class="detail-balance">Total ${currency.format(Number(rental.total_biaya))} · Dibayar ${currency.format(paid)} · Sisa ${currency.format(balance)} · ${escapeHtml(rental.status_pembayaran_sewa)}
    <button class="record-edit-button" type="button" data-print-receipt="rental" data-receipt-id="${rental.id_sewa}">Cetak struk rental</button>
    <button class="record-edit-button" type="button" data-print-pdf="rental" data-receipt-id="${rental.id_sewa}">Unduh bukti sewa PDF</button></div>
    ${legacyNote}<table><thead><tr><th>PEMBAYARAN</th><th>TANGGAL</th><th>METODE</th><th class="amount-cell">NOMINAL</th><th>BUKTI</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty-cell">Belum ada pembayaran untuk penyewaan ini.</td></tr>'}</tbody></table>`;
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
    <td class="receipt-actions"><button class="record-edit-button" type="button" data-print-receipt="fine-payment" data-receipt-id="${payment.id_pembayaran}">Cetak struk</button><button class="record-edit-button" type="button" data-print-pdf="fine-payment" data-receipt-id="${payment.id_pembayaran}">Unduh PDF</button></td>
  </tr>`).join('');
  container.innerHTML = `<div class="detail-balance">Total ${currency.format(Number(bill.total_denda))} · Dibayar ${currency.format(paid)} · Sisa ${currency.format(balance)} · ${escapeHtml(bill.status_pembayaran_denda)}
    <button class="record-edit-button" type="button" data-print-receipt="return" data-receipt-id="${bill.id_pengembalian}">Cetak struk denda</button>
    <button class="record-edit-button" type="button" data-print-pdf="return" data-receipt-id="${bill.id_pengembalian}">Unduh berita acara PDF</button></div>
    <table><thead><tr><th>PEMBAYARAN</th><th>TANGGAL</th><th>METODE</th><th class="amount-cell">NOMINAL</th><th>BUKTI</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty-cell">Belum ada pembayaran untuk tagihan ini.</td></tr>'}</tbody></table>`;
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
        <td>${escapeHtml(fineStatus)}<small>${fine ? `${currency.format(paid)} / ${currency.format(fine)}` : ''}</small></td>
        <td class="receipt-actions"><button class="record-edit-button" type="button" data-print-receipt="rental" data-receipt-id="${rental.id_sewa}">Cetak rental</button>
        <button class="record-edit-button" type="button" data-print-pdf="rental" data-receipt-id="${rental.id_sewa}">Bukti sewa PDF</button>
        ${rentalReturn ? `<button class="record-edit-button" type="button" data-print-receipt="return" data-receipt-id="${rentalReturn.id_pengembalian}">Cetak kembali</button><button class="record-edit-button" type="button" data-print-pdf="return" data-receipt-id="${rentalReturn.id_pengembalian}">Berita acara PDF</button>` : ''}</td></tr>`;
    }).join('');
  container.innerHTML = `<table><thead><tr><th>PENYEWAAN</th><th>ALAT</th><th>STATUS RENTAL</th><th class="amount-cell">BIAYA SEWA</th><th>STATUS PEMBAYARAN SEWA</th><th>STATUS DENDA</th><th>BUKTI</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="empty-cell">Pelanggan ini belum memiliki riwayat penyewaan.</td></tr>'}</tbody></table>`;
}

function printTransactionReceipt(type, id) {
  if (!state.detail) return notify('Data transaksi belum dimuat.', true);
  const { customers, rentals, returns, rentalDetails, equipment, paymentsByReturn, paidByReturn, rentalPaymentsByRental, paidByRental } = detailLookups();
  let rental;
  let returnRecord;
  let currentPayment;
  let paymentRows = [];
  let paymentKind = '';

  if (type === 'rental' || type === 'rental-payment') {
    if (type === 'rental') rental = rentals.get(id);
    else {
      currentPayment = state.detail.rentalPayments.find(row => row.id_pembayaran_sewa === id);
      rental = rentals.get(currentPayment?.id_sewa);
      paymentKind = 'rental';
      paymentRows = [...(rentalPaymentsByRental.get(currentPayment?.id_sewa) || [])]
        .sort((a, b) => a.tgl_bayar.localeCompare(b.tgl_bayar) || a.id_pembayaran_sewa - b.id_pembayaran_sewa);
    }
    returnRecord = returns.get(rental?.id_sewa);
  } else {
    if (type === 'return') returnRecord = state.detail.returns.find(row => row.id_pengembalian === id);
    else {
      currentPayment = state.detail.payments.find(row => row.id_pembayaran === id);
      returnRecord = state.detail.returns.find(row => row.id_pengembalian === currentPayment?.id_pengembalian);
      paymentKind = 'fine';
      paymentRows = [...(paymentsByReturn.get(currentPayment?.id_pengembalian) || [])]
        .sort((a, b) => a.tgl_bayar.localeCompare(b.tgl_bayar) || a.id_pembayaran - b.id_pembayaran);
    }
    rental = rentals.get(returnRecord?.id_sewa);
  }
  if (!rental) return notify('Data penyewaan untuk struk ini tidak ditemukan.', true);

  const customer = customers.get(rental.id_pelanggan);
  const details = rentalDetails.get(rental.id_sewa) || [];
  const itemRows = details.map(detail => {
    const item = equipment.get(detail.id_alat);
    const quantity = Number(detail.jumlah || 1);
    const rate = Number(item?.harga_sewa_per_hari || 0);
    const fineRate = Number(item?.denda_per_hari || 0);
    return `<tr><td>${escapeHtml(item?.nama_alat || 'Alat musik')} × ${quantity}<small>Sewa ${currency.format(rate)} / hari · Denda ${currency.format(fineRate)} / hari</small></td><td class="receipt-number">${currency.format(Number(detail.subtotal || 0))}</td></tr>`;
  }).join('');
  const isFine = paymentKind === 'fine' || type === 'return';
  const total = isFine ? Number(returnRecord?.total_denda || 0) : Number(rental.total_biaya || 0);
  let paid = isFine
    ? paidByReturn.get(returnRecord?.id_pengembalian) || 0
    : paidByRental.get(rental.id_sewa) || 0;
  if (currentPayment) {
    const paymentId = isFine ? currentPayment.id_pembayaran : currentPayment.id_pembayaran_sewa;
    const idField = isFine ? 'id_pembayaran' : 'id_pembayaran_sewa';
    const currentIndex = paymentRows.findIndex(row => row[idField] === paymentId);
    paid = paymentRows.slice(0, currentIndex + 1).reduce((sum, row) => sum + Number(row.jumlah_bayar), 0);
  }
  const amountNow = Number(currentPayment?.jumlah_bayar || 0);
  const balance = Math.max(0, total - paid);
  const paymentStatus = total === 0 && isFine
    ? 'Tidak ada denda'
    : balance === 0 ? 'Lunas' : paid > 0 ? 'Sebagian' : 'Belum lunas';
  const actualDays = Math.max(1, daysUntil(rental.tgl_sewa, rental.tgl_rencana_kembali) * -1);
  const date = currentPayment?.tgl_bayar || returnRecord?.tgl_kembali_aktual || rental.tgl_sewa;
  const receiptDate = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date());
  const receiptType = type === 'return' ? 'BUKTI PENGEMBALIAN'
    : isFine ? 'KUITANSI PEMBAYARAN DENDA' : type === 'rental' ? 'BUKTI PENYEWAAN' : 'KUITANSI PEMBAYARAN SEWA';
  const business = window.RITME_BUSINESS_INFO || {};
  const footerNote = 'Mohon simpan bukti transaksi ini. Pengembalian mengikuti tanggal dan ketentuan pada transaksi sewa.';
  const paymentLines = [
    `<div><span>Total ${isFine ? 'denda' : 'sewa'}</span><strong>${currency.format(total)}</strong></div>`,
    `<div><span>Dibayar saat ini</span><strong>${currency.format(amountNow)}</strong></div>`,
    `<div><span>Akumulasi dibayar</span><strong>${currency.format(paid)}</strong></div>`,
    `<div><span>Metode</span><strong>${escapeHtml(currentPayment?.metode_bayar || '—')}</strong></div>`,
    `<div><span>Status</span><strong>${escapeHtml(paymentStatus)}${balance ? ` · Sisa ${currency.format(balance)}` : ''}</strong></div>`
  ].join('');
  const fineLine = returnRecord
    ? `<tr><td>Denda keterlambatan · ${Number(returnRecord.hari_terlambat)} hari</td><td class="receipt-number">${currency.format(Number(returnRecord.total_denda))}</td></tr>`
    : '';
  const container = document.querySelector('#receipt-print-container');
  container.innerHTML = `<article class="receipt">
    <header class="receipt-header"><strong>Ritme</strong><span>RENTAL MUSIK</span><h1>${receiptType}</h1></header>
    <div class="receipt-meta"><span>No. transaksi</span><strong>${isFine ? `D-${returnRecord?.id_pengembalian}` : `S-${rental.id_sewa}`}</strong><span>Tanggal</span><strong>${formatDate(date)}</strong></div>
    <section class="receipt-customer"><strong>${escapeHtml(customer?.nama || 'Pelanggan')}</strong><span>${escapeHtml(customer?.no_hp || 'Nomor HP tidak tersedia')}</span></section>
    <table class="receipt-items"><thead><tr><th>RINCIAN</th><th class="receipt-number">JUMLAH</th></tr></thead>
      <tbody>${itemRows || '<tr><td>Alat musik</td><td class="receipt-number">—</td></tr>'}${fineLine}</tbody></table>
    <p class="receipt-duration">Durasi sewa rencana: ${actualDays} hari · Rencana kembali: ${formatDate(rental.tgl_rencana_kembali)}${returnRecord ? ` · Aktual: ${formatDate(returnRecord.tgl_kembali_aktual)}` : ''}</p>
    <section class="receipt-payment">${paymentLines}</section>
    <footer><p>${escapeHtml(business.address || 'Alamat usaha belum diatur')}</p><p>Kontak: ${escapeHtml(business.phone || 'Belum diatur')}</p><p>Dicetak ${escapeHtml(receiptDate)}</p><p>${footerNote}</p><strong>Terima kasih telah memilih Ritme.</strong></footer>
  </article>`;
  document.body.classList.add('printing-receipt');
  container.hidden = false;
  const cleanup = () => {
    document.body.classList.remove('printing-receipt');
    container.hidden = true;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

function printOfficialDocument(markup, landscape = false) {
  const container = document.querySelector('#receipt-print-container');
  container.innerHTML = markup;
  document.body.classList.add('printing-document');
  document.body.classList.toggle('print-landscape', landscape);
  container.hidden = false;
  const cleanup = () => {
    document.body.classList.remove('printing-document', 'print-landscape');
    container.hidden = true;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 1000);
}

function formatOfficialDate(date) {
  return date
    ? new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(`${date}T00:00:00Z`))
    : '—';
}

function officialDocumentHeader(title, reference, date) {
  const business = window.RITME_BUSINESS_INFO || {};
  return `<header class="official-header">
    <div><h1>RITME — Rental &amp; Studio Musik</h1>
      <p>${escapeHtml(business.address || 'Alamat usaha belum diatur')}</p>
      <p>WhatsApp: ${escapeHtml(business.phone || 'Belum diatur')} · Email: ${escapeHtml(business.email || 'Belum diatur')}</p></div>
    <div class="official-double-rule"></div><h2>${escapeHtml(title)}</h2>
    <div class="official-meta"><span>Nomor dokumen</span><strong>${escapeHtml(reference)}</strong><span>Tanggal</span><strong>${formatOfficialDate(date)}</strong></div>
  </header>`;
}

function officialDocumentFooter(signatures = false) {
  const printedAt = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short'
  }).format(new Date());
  return `${signatures ? `<section class="official-signatures"><div><span>Penyewa / Pelanggan</span><i></i><strong>Nama &amp; tanda tangan</strong></div><div><span>Petugas / Kasir Ritme</span><i></i><strong>Nama &amp; tanda tangan</strong></div></section>` : ''}
    <footer class="official-footer"><span>Dicetak ${escapeHtml(printedAt)}</span><span>Ritme — Rental &amp; Studio Musik</span></footer>`;
}

function spellRupiah(amount) {
  const words = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  const spell = value => {
    if (value < 12) return words[value];
    if (value < 20) return `${spell(value - 10)} belas`;
    if (value < 100) return `${spell(Math.floor(value / 10))} puluh${value % 10 ? ` ${spell(value % 10)}` : ''}`;
    if (value < 200) return `seratus${value - 100 ? ` ${spell(value - 100)}` : ''}`;
    if (value < 1000) return `${spell(Math.floor(value / 100))} ratus${value % 100 ? ` ${spell(value % 100)}` : ''}`;
    if (value < 2000) return `seribu${value - 1000 ? ` ${spell(value - 1000)}` : ''}`;
    if (value < 1000000) return `${spell(Math.floor(value / 1000))} ribu${value % 1000 ? ` ${spell(value % 1000)}` : ''}`;
    if (value < 1000000000) return `${spell(Math.floor(value / 1000000))} juta${value % 1000000 ? ` ${spell(value % 1000000)}` : ''}`;
    return `${spell(Math.floor(value / 1000000000))} miliar${value % 1000000000 ? ` ${spell(value % 1000000000)}` : ''}`;
  };
  const integer = Math.floor(Math.abs(Number(amount) || 0));
  return `${integer ? spell(integer) : 'nol'} rupiah`;
}

function printTransactionDocument(type, id) {
  if (!state.detail) return notify('Data transaksi belum dimuat.', true);
  const { customers, equipment, rentals, returns, rentalDetails, paymentsByReturn, paidByReturn, rentalPaymentsByRental, paidByRental } = detailLookups();
  let rental;
  let returnRecord;
  let currentPayment;
  let paymentRows = [];
  const isRentPayment = type === 'rental-payment';
  const isFinePayment = type === 'fine-payment';
  if (type === 'rental' || isRentPayment) {
    currentPayment = isRentPayment
      ? state.detail.rentalPayments.find(row => row.id_pembayaran_sewa === id)
      : null;
    rental = rentals.get(isRentPayment ? currentPayment?.id_sewa : id);
    returnRecord = returns.get(rental?.id_sewa);
    if (isRentPayment) paymentRows = [...(rentalPaymentsByRental.get(rental?.id_sewa) || [])]
      .sort((a, b) => a.tgl_bayar.localeCompare(b.tgl_bayar) || a.id_pembayaran_sewa - b.id_pembayaran_sewa);
  } else {
    currentPayment = isFinePayment
      ? state.detail.payments.find(row => row.id_pembayaran === id)
      : null;
    returnRecord = isFinePayment
      ? state.detail.returns.find(row => row.id_pengembalian === currentPayment?.id_pengembalian)
      : state.detail.returns.find(row => row.id_pengembalian === id);
    rental = rentals.get(returnRecord?.id_sewa);
    if (isFinePayment) paymentRows = [...(paymentsByReturn.get(returnRecord?.id_pengembalian) || [])]
      .sort((a, b) => a.tgl_bayar.localeCompare(b.tgl_bayar) || a.id_pembayaran - b.id_pembayaran);
  }
  if (!rental) return notify('Data penyewaan untuk dokumen ini tidak ditemukan.', true);

  const isFine = type === 'return' || isFinePayment;
  const customer = customers.get(rental.id_pelanggan);
  const details = rentalDetails.get(rental.id_sewa) || [];
  const total = isFine ? Number(returnRecord?.total_denda || 0) : Number(rental.total_biaya || 0);
  const accumulatedPaid = isFine
    ? paidByReturn.get(returnRecord?.id_pengembalian) || 0
    : paidByRental.get(rental.id_sewa) || 0;
  const paidThroughReceipt = currentPayment
    ? paymentRows.slice(0, paymentRows.findIndex(row => row.id_pembayaran === currentPayment.id_pembayaran
      || row.id_pembayaran_sewa === currentPayment.id_pembayaran_sewa) + 1)
      .reduce((sum, row) => sum + Number(row.jumlah_bayar), 0)
    : accumulatedPaid;
  const balance = Math.max(0, total - paidThroughReceipt);
  const status = balance === 0 ? 'LUNAS' : paidThroughReceipt > 0 ? 'SEBAGIAN' : 'BELUM LUNAS';
  const documentDate = currentPayment?.tgl_bayar || returnRecord?.tgl_kembali_aktual || rental.tgl_sewa;
  const reference = type === 'rental' ? `S-${rental.id_sewa}`
    : type === 'return' ? `BA-${returnRecord?.id_pengembalian}`
      : isFinePayment ? `KD-${currentPayment?.id_pembayaran}` : `KS-${currentPayment?.id_pembayaran_sewa}`;
  const title = type === 'rental' ? 'SURAT BUKTI SEWA'
    : type === 'return' ? 'BERITA ACARA PENGEMBALIAN'
      : isFinePayment ? 'KUITANSI PEMBAYARAN DENDA' : 'KUITANSI PEMBAYARAN SEWA';
  const itemRows = details.map(detail => {
    const item = equipment.get(detail.id_alat);
    const quantity = Number(detail.jumlah || 1);
    const rate = Number(item?.harga_sewa_per_hari || 0);
    return `<tr><td>${escapeHtml(item?.nama_alat || 'Alat musik')} × ${quantity}</td><td>${currency.format(rate)}</td><td>${currency.format(Number(detail.subtotal || 0))}</td></tr>`;
  }).join('');
  const returnSummary = returnRecord
    ? `<section class="official-section"><h3>Rincian pengembalian &amp; denda</h3><dl class="official-details">
        <dt>Tanggal kembali aktual</dt><dd>${formatOfficialDate(returnRecord.tgl_kembali_aktual)}</dd>
        <dt>Keterlambatan</dt><dd>${Number(returnRecord.hari_terlambat || 0)} hari</dd>
        <dt>Total denda</dt><dd>${currency.format(Number(returnRecord.total_denda || 0))}</dd>
        <dt>Kondisi alat</dt><dd>Periksa dan catat secara manual pada salinan ini: ____________________</dd>
      </dl></section>`
    : '';
  const paymentSummary = `<section class="official-section"><h3>Ringkasan pembayaran</h3><dl class="official-details">
      <dt>Total ${isFine ? 'denda' : 'sewa'}</dt><dd>${currency.format(total)}</dd>
      <dt>${currentPayment ? 'Dibayar pada transaksi ini' : 'Pembayaran masuk tercatat'}</dt><dd>${currency.format(Number(currentPayment?.jumlah_bayar ?? accumulatedPaid))}</dd>
      ${currentPayment ? `<dt>Terbilang</dt><dd>${escapeHtml(spellRupiah(currentPayment.jumlah_bayar))}</dd>` : ''}
      <dt>Akumulasi dibayar</dt><dd>${currency.format(paidThroughReceipt)}</dd>
      <dt>Metode pembayaran</dt><dd>${escapeHtml(currentPayment?.metode_bayar || (accumulatedPaid ? 'Lihat riwayat pembayaran' : 'Belum ada pembayaran'))}</dd>
      <dt>Status</dt><dd><strong>${status}${balance ? ` · Sisa ${currency.format(balance)}` : ''}</strong></dd>
    </dl></section>`;
  const rentalTerms = type === 'rental'
    ? '<section class="official-section"><h3>Syarat &amp; ketentuan</h3><p>Pelanggan bertanggung jawab menjaga alat selama masa sewa dan mengembalikannya sesuai tanggal yang disepakati. Keterlambatan dapat dikenakan denda sesuai tarif yang berlaku pada transaksi.</p></section>'
    : '';
  const customerBlock = `<section class="official-section"><h3>Identitas pelanggan</h3><dl class="official-details">
      <dt>Nama</dt><dd>${escapeHtml(customer?.nama || 'Pelanggan')}</dd>
      <dt>Nomor telepon</dt><dd>${escapeHtml(customer?.no_hp || 'Tidak tersedia')}</dd>
      <dt>Nomor penyewaan</dt><dd>S-${rental.id_sewa}</dd>
    </dl></section>`;
  const rentalTermsLine = `<p class="official-note">Rencana kembali: <strong>${formatOfficialDate(rental.tgl_rencana_kembali)}</strong> · Tanggal sewa: ${formatOfficialDate(rental.tgl_sewa)}</p>`;
  const content = `<article class="official-document">
    ${officialDocumentHeader(title, reference, documentDate)}
    ${customerBlock}
    <section class="official-section"><h3>Rincian alat musik · Tarif per hari</h3><table class="official-table"><thead><tr><th>Nama alat</th><th>Tarif / hari</th><th>Subtotal sewa</th></tr></thead>
      <tbody>${itemRows || '<tr><td colspan="3">Tidak ada rincian alat.</td></tr>'}</tbody></table>${rentalTermsLine}</section>
    ${returnSummary}${paymentSummary}${rentalTerms}
    ${officialDocumentFooter(type === 'rental')}</article>`;
  printOfficialDocument(content);
}

function printLateNotice(rentalId) {
  const rental = state.rentals.find(row => row.id_sewa === rentalId);
  if (!rental) return notify('Data penyewaan terlambat tidak ditemukan.', true);
  const daysLate = Math.max(0, -daysUntil(rental.tgl_rencana_kembali));
  if (!daysLate) return notify('Penyewaan ini belum terlambat.', true);
  const customer = rental.pelanggan || {};
  const details = rental.detail_penyewaan || [];
  const finePerDay = details.reduce((sum, detail) =>
    sum + Number(detail.jumlah || 1) * Number(detail.alat_musik?.denda_per_hari || 0), 0);
  const accruedFine = finePerDay * daysLate;
  const items = details.map(detail => `<tr><td>${escapeHtml(detail.alat_musik?.nama_alat || 'Alat musik')}</td><td>${Number(detail.jumlah || 1)}</td><td>${currency.format(Number(detail.alat_musik?.denda_per_hari || 0))}</td></tr>`).join('');
  const business = window.RITME_BUSINESS_INFO || {};
  const reference = `TAG-S-${rental.id_sewa}-${localDateValue().replace(/-/g, '')}`;
  const content = `<article class="official-document">
    ${officialDocumentHeader('SURAT TAGIHAN KETERLAMBATAN', reference, localDateValue())}
    <section class="official-section"><h3>Ditujukan kepada</h3><dl class="official-details">
      <dt>Nama penyewa</dt><dd>${escapeHtml(customer.nama || 'Pelanggan')}</dd>
      <dt>Nomor kontak</dt><dd>${escapeHtml(customer.no_hp || 'Tidak tersedia')}</dd>
      <dt>Nomor transaksi sewa</dt><dd>S-${rental.id_sewa}</dd>
    </dl></section>
    <section class="official-section"><h3>Alat yang belum dikembalikan</h3><table class="official-table"><thead><tr><th>Alat musik</th><th>Jumlah</th><th>Denda / hari / unit</th></tr></thead><tbody>${items || '<tr><td colspan="3">Rincian alat tidak tersedia.</td></tr>'}</tbody></table>
      <p class="official-note">Tanggal kembali rencana: <strong>${formatOfficialDate(rental.tgl_rencana_kembali)}</strong> · Terlambat: <strong>${daysLate} hari</strong>.</p>
    </section>
    <section class="official-section"><h3>Tagihan berjalan</h3><dl class="official-details">
      <dt>Akumulasi denda hingga ${formatOfficialDate(localDateValue())}</dt><dd><strong>${currency.format(accruedFine)}</strong></dd>
      <dt>Tarif denda per hari (total)</dt><dd>${currency.format(finePerDay)}</dd>
    </dl><p>Jumlah denda berjalan dapat bertambah setiap hari sampai alat dikembalikan dan diproses.</p></section>
    <section class="official-section"><h3>Informasi pembayaran</h3><p>Rekening: <strong>${escapeHtml(business.bankAccount || 'Belum dikonfigurasi')}</strong></p><p>QRIS: <strong>${escapeHtml(business.qris || 'Belum dikonfigurasi')}</strong></p></section>
    ${officialDocumentFooter()}</article>`;
  printOfficialDocument(content);
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
      <td class="amount-cell">${currency.format(fines)}</td><td class="amount-cell">${currency.format(paid)}</td>
      <td><button class="record-edit-button" type="button" data-edit-record="equipment" data-record-id="${item.id_alat}">Ubah</button></td></tr>`;
  }).join('');
  document.querySelector('#equipment-report').innerHTML = `<table><thead><tr><th>ALAT</th><th>STATUS</th><th>JUMLAH SEWA</th><th class="amount-cell">PENDAPATAN SEWA</th><th class="amount-cell">DENDA TERCATAT</th><th class="amount-cell">DENDA DITERIMA</th><th>AKSI</th></tr></thead>
    <tbody>${dataRows || '<tr><td colspan="7" class="empty-cell">Belum ada data inventaris.</td></tr>'}</tbody></table>`;
}

function openRecordEditor(type, id) {
  const customer = type === 'customer' && state.detail?.customers.find(item => item.id_pelanggan === id);
  const equipment = type === 'equipment' && state.detail?.equipment.find(item => item.id_alat === id);
  const record = customer || equipment;
  if (!record) return notify('Data yang akan diubah tidak ditemukan. Muat ulang data dan coba lagi.', true);

  const isCustomer = type === 'customer';
  const lockedRates = !isCustomer && equipment.status === 'Disewa';
  const dialog = document.querySelector('#record-editor');
  const form = document.querySelector('#record-editor-form');
  const fields = document.querySelector('#record-editor-fields');
  dialog.dataset.recordType = type;
  dialog.dataset.recordId = String(id);
  document.querySelector('#record-editor-title').textContent = isCustomer ? 'Ubah data pelanggan' : 'Ubah data inventaris';
  fields.innerHTML = isCustomer
    ? `<label class="field-label" for="edit-customer-name">Nama pelanggan <span class="required">*</span></label>
       <input id="edit-customer-name" name="nama" type="text" required value="${escapeHtml(customer.nama)}">
       <label class="field-label" for="edit-customer-phone">Nomor HP <span class="required">*</span></label>
       <input id="edit-customer-phone" name="no_hp" type="tel" required value="${escapeHtml(customer.no_hp)}">
       <label class="field-label" for="edit-customer-address">Alamat</label>
       <input id="edit-customer-address" name="alamat" type="text" value="${escapeHtml(customer.alamat || '')}">`
    : `<label class="field-label" for="edit-equipment-name">Nama alat musik <span class="required">*</span></label>
       <input id="edit-equipment-name" name="nama_alat" type="text" maxlength="100" required value="${escapeHtml(equipment.nama_alat)}">
       <div class="field-pair">
         <div><label class="field-label" for="edit-equipment-rate">Tarif sewa / hari (Rp) <span class="required">*</span></label>
           <input id="edit-equipment-rate" name="harga_sewa_per_hari" type="number" min="0" step="1" required ${lockedRates ? 'readonly' : ''} value="${Number(equipment.harga_sewa_per_hari)}"></div>
         <div><label class="field-label" for="edit-equipment-fine">Denda / hari (Rp) <span class="required">*</span></label>
           <input id="edit-equipment-fine" name="denda_per_hari" type="number" min="0" step="1" required ${lockedRates ? 'readonly' : ''} value="${Number(equipment.denda_per_hari)}"></div>
       </div>
       ${lockedRates ? '<small class="field-hint">Tarif dikunci selama alat sedang disewa agar perhitungan transaksi berjalan tetap konsisten.</small>' : ''}`;
  dialog.showModal();
  fields.querySelector('input:not([readonly])')?.focus();
}

async function saveRecordEdit(event) {
  event.preventDefault();
  const dialog = document.querySelector('#record-editor');
  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const type = dialog.dataset.recordType;
  const id = Number(dialog.dataset.recordId);
  const payload = Object.fromEntries(new FormData(form));
  if (type === 'customer') {
    payload.nama = String(payload.nama).trim();
    payload.no_hp = String(payload.no_hp).trim();
    payload.alamat = String(payload.alamat).trim();
    if (!payload.nama || !payload.no_hp) return notify('Nama dan nomor HP wajib diisi.', true);
  } else {
    payload.nama_alat = String(payload.nama_alat).trim();
    payload.harga_sewa_per_hari = Number(payload.harga_sewa_per_hari);
    payload.denda_per_hari = Number(payload.denda_per_hari);
    if (!payload.nama_alat || !Number.isFinite(payload.harga_sewa_per_hari) || payload.harga_sewa_per_hari < 0
      || !Number.isFinite(payload.denda_per_hari) || payload.denda_per_hari < 0) {
      return notify('Nama alat wajib diisi dan tarif harus berupa angka nol atau lebih.', true);
    }
  }

  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api(`/api/${type === 'customer' ? 'pelanggan' : 'alat-musik'}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    await Promise.all([loadCustomers(), loadEquipment(), loadDetailData()]);
    dialog.close();
    notify(type === 'customer' ? 'Data pelanggan berhasil diperbarui.' : 'Data inventaris berhasil diperbarui.');
  } catch (error) {
    notify(`Perubahan gagal disimpan: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
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

function printJournalReport() {
  if (!state.journals.length) return notify('Belum ada jurnal untuk dicetak.', true);
  const rows = [...state.journals].sort((a, b) =>
    a.tgl_jurnal.localeCompare(b.tgl_jurnal) || a.id_jurnal - b.id_jurnal);
  const debit = rows.reduce((sum, row) => sum + Number(row.debit), 0);
  const credit = rows.reduce((sum, row) => sum + Number(row.kredit), 0);
  const tableRows = rows.map(row => {
    const ref = row.id_pembayaran_sewa ? `PS-${row.id_pembayaran_sewa}`
      : row.id_pembayaran ? `PD-${row.id_pembayaran}`
        : row.id_pengembalian ? `K-${row.id_pengembalian}`
          : row.id_sewa ? `S-${row.id_sewa}` : '—';
    return `<tr><td>${formatDate(row.tgl_jurnal)}</td><td>J-${row.id_jurnal}</td><td>${escapeHtml(row.keterangan)}</td><td>${ref}</td><td>${currency.format(Number(row.debit))}</td><td>${currency.format(Number(row.kredit))}</td><td>—</td></tr>`;
  }).join('');
  const content = `<article class="official-document">
    ${officialDocumentHeader('JURNAL UMUM', `JU-${localDateValue().replace(/-/g, '')}`, localDateValue())}
    <section class="official-section"><table class="official-table"><thead><tr><th>Tanggal</th><th>No. bukti</th><th>Keterangan</th><th>Ref</th><th>Debit</th><th>Kredit</th><th>Saldo</th></tr></thead>
      <tbody>${tableRows}<tr class="official-total"><th colspan="4">TOTAL</th><th>${currency.format(debit)}</th><th>${currency.format(credit)}</th><th>—</th></tr></tbody></table>
      <p class="official-note">Saldo berjalan ditampilkan pada laporan buku besar per akun; jurnal umum mencatat debit dan kredit per baris.</p></section>
    ${officialDocumentFooter()}</article>`;
  printOfficialDocument(content, true);
}

function printLedgerReport() {
  let data;
  try {
    data = getLedgerData();
  } catch (error) {
    return notify(error.message, true);
  }
  if (!data) return notify('Pilih akun sebelum mengekspor buku besar PDF.', true);
  if (!data.rows.length) return notify('Tidak ada mutasi akun pada periode ini.', true);
  const start = document.querySelector('#ledger-start').value;
  const end = document.querySelector('#ledger-end').value;
  const rows = data.rows.map(row => {
    const ref = row.id_pembayaran_sewa ? `PS-${row.id_pembayaran_sewa}`
      : row.id_pembayaran ? `PD-${row.id_pembayaran}`
        : row.id_pengembalian ? `K-${row.id_pengembalian}`
          : row.id_sewa ? `S-${row.id_sewa}` : '—';
    return `<tr><td>${formatDate(row.tgl_jurnal)}</td><td>J-${row.id_jurnal}</td><td>${escapeHtml(row.keterangan)}</td><td>${ref}</td><td>${currency.format(Number(row.debit))}</td><td>${currency.format(Number(row.kredit))}</td><td>${formatAccountBalance(row.balance, data.code)}</td></tr>`;
  }).join('');
  const content = `<article class="official-document">
    ${officialDocumentHeader(`BUKU BESAR · ${data.accountName}`, `BB-${data.code}-${localDateValue().replace(/-/g, '')}`, localDateValue())}
    <p class="official-note">Akun ${escapeHtml(data.code)} · Periode ${start ? formatOfficialDate(start) : 'awal'} s.d. ${end ? formatOfficialDate(end) : 'sekarang'} · Saldo awal: ${formatAccountBalance(data.opening, data.code)}</p>
    <section class="official-section"><table class="official-table"><thead><tr><th>Tanggal</th><th>No. bukti</th><th>Keterangan</th><th>Ref</th><th>Debit</th><th>Kredit</th><th>Saldo berjalan</th></tr></thead>
      <tbody>${rows}<tr class="official-total"><th colspan="4">TOTAL MUTASI</th><th>${currency.format(data.debit)}</th><th>${currency.format(data.credit)}</th><th>${formatAccountBalance(data.balance, data.code)}</th></tr></tbody></table></section>
    ${officialDocumentFooter()}</article>`;
  printOfficialDocument(content, true);
}

function printIncomeReport() {
  if (!state.detail) return notify('Data laporan belum dimuat.', true);
  let months;
  try {
    months = getIncomeRows();
  } catch (error) {
    return notify(error.message, true);
  }
  const totals = months.reduce((result, row) => ({
    rentRevenue: result.rentRevenue + row.rentRevenue,
    fineRevenue: result.fineRevenue + row.fineRevenue,
    rentCash: result.rentCash + row.rentCash,
    fineCash: result.fineCash + row.fineCash
  }), { rentRevenue: 0, fineRevenue: 0, rentCash: 0, fineCash: 0 });
  const { paidByReturn, paidByRental } = detailLookups();
  const receivables = state.detail.rentals.reduce((sum, rental) =>
    sum + (rental.basis_pencatatan === 'Kas' ? 0
      : Math.max(0, Number(rental.total_biaya) - (paidByRental.get(rental.id_sewa) || 0))), 0)
    + state.detail.returns.reduce((sum, row) =>
      sum + Math.max(0, Number(row.total_denda) - (paidByReturn.get(row.id_pengembalian) || 0)), 0);
  const rows = months.map(row => {
    const monthLabel = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'UTC', month: 'long', year: 'numeric'
    }).format(new Date(`${row.month}-01T00:00:00Z`));
    return `<tr><td>${monthLabel}</td><td>${currency.format(row.rentRevenue)}</td><td>${currency.format(row.fineRevenue)}</td><td>${currency.format(row.rentRevenue + row.fineRevenue)}</td><td>${currency.format(row.rentCash + row.fineCash)}</td></tr>`;
  }).join('');
  const start = document.querySelector('#income-start').value;
  const end = document.querySelector('#income-end').value;
  const content = `<article class="official-document">
    ${officialDocumentHeader('LAPORAN PENDAPATAN', `LP-${localDateValue().replace(/-/g, '')}`, localDateValue())}
    <p class="official-note">Periode ${start ? formatOfficialDate(start) : 'awal'} s.d. ${end ? formatOfficialDate(end) : 'sekarang'}</p>
    <section class="official-section"><h3>Ringkasan periode</h3><dl class="official-details">
      <dt>Pendapatan sewa (akrual)</dt><dd>${currency.format(totals.rentRevenue)}</dd>
      <dt>Pendapatan denda (akrual)</dt><dd>${currency.format(totals.fineRevenue)}</dd>
      <dt>Kas riil diterima</dt><dd>${currency.format(totals.rentCash + totals.fineCash)}</dd>
      <dt>Piutang belum tertagih saat cetak</dt><dd>${currency.format(receivables)}</dd>
    </dl></section>
    <section class="official-section"><h3>Rincian bulanan</h3><table class="official-table"><thead><tr><th>Periode</th><th>Pendapatan sewa</th><th>Pendapatan denda</th><th>Total pendapatan</th><th>Kas diterima</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Tidak ada transaksi pada periode ini.</td></tr>'}
      <tr class="official-total"><th>TOTAL</th><th>${currency.format(totals.rentRevenue)}</th><th>${currency.format(totals.fineRevenue)}</th><th>${currency.format(totals.rentRevenue + totals.fineRevenue)}</th><th>${currency.format(totals.rentCash + totals.fineCash)}</th></tr></tbody></table></section>
    ${officialDocumentFooter()}</article>`;
  printOfficialDocument(content, true);
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

function initializeApplication() {
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
  document.querySelector('#download-income-pdf').addEventListener('click', printIncomeReport);
  document.querySelector('#download-ledger-csv').addEventListener('click', exportLedger);
  document.querySelector('#download-ledger-pdf').addEventListener('click', printLedgerReport);
  document.querySelector('#download-journal-pdf').addEventListener('click', printJournalReport);
  document.querySelectorAll('[data-payment-amount]').forEach(button => button.addEventListener('click', () => {
    fillPaymentAmount(button.dataset.paymentAmount);
  }));
  document.querySelectorAll('[data-rent-payment-amount]').forEach(button => button.addEventListener('click', () => {
    fillRentPaymentAmount(button.dataset.rentPaymentAmount);
  }));
  document.querySelectorAll('[data-cash-quick-for] [data-cash-amount]').forEach(button =>
    button.addEventListener('click', () => setQuickCash(button)));
  [
    ['payment-form', '#payment-amount', '#payment-cash-received', '#payment-method'],
    ['rent-payment-form', '#rent-payment-amount', '#rent-payment-cash-received', '#rent-payment-method']
  ].forEach(([formId, amountSelector, receivedSelector, methodSelector]) => {
    const form = document.querySelector(`#${formId}`);
    [amountSelector, receivedSelector, methodSelector].forEach(selector =>
      form.querySelector(selector).addEventListener('input', () => updateCashChange(formId)));
    form.querySelector(methodSelector).addEventListener('change', () => updateCashChange(formId));
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-print-receipt]');
    if (button) printTransactionReceipt(button.dataset.printReceipt, Number(button.dataset.receiptId));
    const pdfButton = event.target.closest('[data-print-pdf]');
    if (pdfButton) printTransactionDocument(pdfButton.dataset.printPdf, Number(pdfButton.dataset.receiptId));
    const lateNoticeButton = event.target.closest('[data-print-late-notice]');
    if (lateNoticeButton) printLateNotice(Number(lateNoticeButton.dataset.printLateNotice));
  });
  document.querySelector('#download-csv').addEventListener('click', exportJournals);
  document.querySelector('#record-editor-form').addEventListener('submit', saveRecordEdit);
  document.querySelector('#record-editor-cancel').addEventListener('click', () => document.querySelector('#record-editor').close());
  document.querySelector('#record-editor-close').addEventListener('click', () => document.querySelector('#record-editor').close());
  document.querySelector('#action-confirmation').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.querySelectorAll('#customer-list, #equipment-report').forEach(container => {
    container.addEventListener('click', event => {
      const button = event.target.closest('[data-edit-record]');
      if (button) openRecordEditor(button.dataset.editRecord, Number(button.dataset.recordId));
    });
    container.addEventListener('dblclick', event => {
      const row = event.target.closest('tr');
      if (!row) return;
      const button = row.querySelector('[data-edit-record]');
      if (button) openRecordEditor(button.dataset.editRecord, Number(button.dataset.recordId));
    });
  });

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
    if (button.disabled) return;
    if (!document.querySelector('#customer-name').value.trim()
      || !document.querySelector('#customer-phone').value.trim()) {
      return notify('Nama dan nomor HP pelanggan wajib diisi.', true);
    }
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
    if (form.dataset.submitting === 'true') return;
    const items = [...form.querySelectorAll('input[name="equipment"]:checked')].map(input => ({ id_alat: Number(input.value) }));
    if (!items.length) return notify('Pilih minimal satu unit alat musik.', true);
    if (!window.confirm(`Buat penyewaan untuk ${items.length} alat? Pastikan pelanggan dan tanggal sudah benar.`)) return;
    form.dataset.submitting = 'true';
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
      form.dataset.submitting = 'false';
      setBusy(form, false);
    }
  });

  document.querySelector('#return-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === 'true' || form.dataset.confirming === 'true') return;
    const rental = state.rentals.find(item => String(item.id_sewa) === document.querySelector('#return-rental').value);
    if (!rental) return notify('Pilih penyewaan aktif yang valid.', true);
    const actualDate = document.querySelector('#actual-date').value;
    form.dataset.confirming = 'true';
    const confirmed = await requestConfirmation({
      title: 'Konfirmasi pengembalian',
      content: returnConfirmationContent(rental, actualDate),
      confirmLabel: 'Ya, proses pengembalian'
    });
    form.dataset.confirming = 'false';
    if (!confirmed) return;
    form.dataset.submitting = 'true';
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
      form.dataset.submitting = 'false';
      setBusy(form, false);
    }
  });

  document.querySelector('#payment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === 'true' || form.dataset.confirming === 'true') return;
    const amount = Number(document.querySelector('#payment-amount').value);
    const selected = state.unpaid.find(item => String(item.id_pengembalian) === document.querySelector('#payment-return').value);
    if (!selected || !Number.isFinite(amount) || amount <= 0) return notify('Pilih tagihan dan masukkan nominal cicilan yang valid.', true);
    if (amount > selected.sisa_denda) return notify('Jumlah pembayaran melebihi sisa denda.', true);
    if (document.querySelector('#payment-method').value === 'Tunai'
      && Number(document.querySelector('#payment-cash-received').value) < amount) {
      return notify('Uang tunai yang diterima masih kurang dari nominal pembayaran.', true);
    }
    const remaining = selected.sisa_denda - amount;
    form.dataset.confirming = 'true';
    const confirmed = await requestConfirmation({
      title: 'Konfirmasi pembayaran denda',
      content: paymentConfirmationContent({
        total: selected.total_denda,
        paid: selected.total_terbayar,
        amount,
        remaining,
        method: document.querySelector('#payment-method').value,
        kind: 'denda'
      }),
      confirmLabel: 'Ya, simpan pembayaran'
    });
    form.dataset.confirming = 'false';
    if (!confirmed) return;
    form.dataset.submitting = 'true';
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
      form.dataset.submitting = 'false';
      setBusy(form, false);
      updateCashChange('payment-form');
    }
  });

  document.querySelector('#rent-payment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === 'true' || form.dataset.confirming === 'true') return;
    const idSewa = document.querySelector('#payment-rental').value;
    const amount = Number(document.querySelector('#rent-payment-amount').value);
    const selected = state.rentUnpaid.find(item => String(item.id_sewa) === idSewa);
    if (!selected || !Number.isFinite(amount) || amount <= 0) {
      return notify('Pilih tagihan sewa dan masukkan nominal pembayaran yang valid.', true);
    }
    if (amount > selected.sisa_tagihan) return notify('Jumlah pembayaran melebihi sisa tagihan sewa.', true);
    if (document.querySelector('#rent-payment-method').value === 'Tunai'
      && Number(document.querySelector('#rent-payment-cash-received').value) < amount) {
      return notify('Uang tunai yang diterima masih kurang dari nominal pembayaran.', true);
    }
    const remaining = selected.sisa_tagihan - amount;
    form.dataset.confirming = 'true';
    const confirmed = await requestConfirmation({
      title: 'Konfirmasi pembayaran sewa',
      content: paymentConfirmationContent({
        total: selected.total_biaya,
        paid: selected.total_terbayar,
        amount,
        remaining,
        method: document.querySelector('#rent-payment-method').value,
        kind: 'sewa'
      }),
      confirmLabel: 'Ya, simpan pembayaran'
    });
    form.dataset.confirming = 'false';
    if (!confirmed) return;
    form.dataset.submitting = 'true';
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
      form.dataset.submitting = 'false';
      setBusy(form, false);
      updateCashChange('rent-payment-form');
    }
  });

  refreshAll().catch(error => notify(`Gagal memuat data: ${error.message}`, true));
}

function showAuthMessage(message, isSuccess = false) {
  const element = document.querySelector('#auth-message');
  element.textContent = message;
  element.classList.toggle('is-success', isSuccess);
}

async function enterApplication(session) {
  const gate = document.querySelector('#auth-gate');
  const appShell = document.querySelector('.app-shell');
  const avatar = document.querySelector('#account-avatar');
  const { data, error } = await supabaseClient.from('ritme_admins')
    .select('user_id')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    showAuthMessage('Akses belum dapat diverifikasi. Pastikan administrator sudah disiapkan di Supabase.');
    return false;
  }
  if (!data || data.user_id !== session.user.id) {
    await supabaseClient.auth.signOut();
    showAuthMessage('Akun ini belum diberi akses administrator.');
    return false;
  }

  gate.hidden = true;
  appShell.hidden = false;
  avatar.textContent = (session.user.email || 'AD').slice(0, 2).toUpperCase();
  avatar.setAttribute('aria-label', session.user.email || 'Administrator');
  showAuthMessage('', true);
  if (!appInitialized) {
    appInitialized = true;
    initializeApplication();
  } else {
    refreshAll().catch(error => notify(`Gagal memuat data: ${error.message}`, true));
  }
  return true;
}

async function initializeAuthentication() {
  const form = document.querySelector('#auth-form');
  const button = document.querySelector('#auth-submit');
  const appShell = document.querySelector('.app-shell');
  if (!supabaseClient) {
    showAuthMessage('Konfigurasi Supabase tidak tersedia. Aplikasi dikunci demi keamanan.');
    return;
  }

  supabaseClient.auth.onAuthStateChange(event => {
    if (event !== 'SIGNED_OUT') return;

    appShell.hidden = true;
    document.querySelector('#auth-gate').hidden = false;
    document.querySelector('#auth-password').value = '';
    showAuthMessage('Sesi login berakhir. Silakan masuk kembali.');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    showAuthMessage('Memeriksa akun...', true);
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: document.querySelector('#auth-email').value.trim(),
        password: document.querySelector('#auth-password').value
      });
      if (error) throw error;
      if (!data.session) throw new Error('Sesi login tidak berhasil dibuat.');
      if (await enterApplication(data.session)) form.reset();
    } catch (error) {
      showAuthMessage(error.message || 'Login gagal. Periksa email dan kata sandi.');
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#logout-button').addEventListener('click', async event => {
    const logoutButton = event.currentTarget;
    logoutButton.disabled = true;
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      appShell.hidden = true;
      document.querySelector('#auth-gate').hidden = false;
      document.querySelector('#auth-password').value = '';
      showAuthMessage('Anda sudah keluar.', true);
    } catch (error) {
      notify(`Gagal keluar: ${error.message}`, true);
    } finally {
      logoutButton.disabled = false;
    }
  });

  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (data.session) await enterApplication(data.session);
  } catch (error) {
    showAuthMessage(`Tidak dapat memeriksa sesi login: ${error.message}`);
  }
}

document.addEventListener('DOMContentLoaded', initializeAuthentication);
