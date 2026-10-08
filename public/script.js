const state = { customers: [], equipment: [], rentals: [], unpaid: [], journals: [], detail: null };
const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
const viewLabels = { dashboard: 'Ringkasan', transactions: 'Transaksi', details: 'Detail & laporan', reports: 'Jurnal akuntansi' };
const supabaseClient = window.RITME_CONFIG && window.supabase?.createClient
  ? window.supabase.createClient(window.RITME_CONFIG.supabaseUrl, window.RITME_CONFIG.supabasePublishableKey)
  : null;

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
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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
      supabaseClient.from('alat_musik').select('id_alat').eq('status', 'Disewa')
    ]);
    result = { data: {
      totalDendaDibayar: payments.total,
      penyewaanTerlambat: rentals.data?.filter(row => row.tgl_rencana_kembali < localDateValue()).length,
      alatDisewa: equipment.data?.length
    }, error: payments.error || rentals.error || equipment.error };
  } else if (url === '/api/pelanggan' && options.method === 'POST') {
    result = await supabaseClient.from('pelanggan').insert(body).select('id_pelanggan, nama, no_hp, alamat').single();
  } else if (url === '/api/pelanggan') {
    result = await supabaseClient.from('pelanggan').select('id_pelanggan, nama, no_hp, alamat').order('nama');
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
  } else if (url === '/api/detail') {
    const [customers, equipment, rentals, rentalDetails, returns, payments] = await Promise.all([
      getAllSupabaseRows('pelanggan', 'id_pelanggan, nama, no_hp, alamat', 'id_pelanggan'),
      getAllSupabaseRows('alat_musik', 'id_alat, nama_alat, harga_sewa_per_hari, denda_per_hari, status', 'id_alat'),
      getAllSupabaseRows('penyewaan', 'id_sewa, id_pelanggan, tgl_sewa, tgl_rencana_kembali, total_biaya, status_sewa', 'id_sewa'),
      getAllSupabaseRows('detail_penyewaan', 'id_detail, id_sewa, id_alat, jumlah, subtotal', 'id_detail'),
      getAllSupabaseRows('pengembalian', 'id_pengembalian, id_sewa, tgl_kembali_aktual, hari_terlambat, total_denda, status_pembayaran_denda', 'id_pengembalian'),
      getAllSupabaseRows('pembayaran_denda', 'id_pembayaran, id_pengembalian, tgl_bayar, jumlah_bayar, metode_bayar, created_at', 'id_pembayaran')
    ]);
    result = {
      data: { customers: customers.data, equipment: equipment.data, rentals: rentals.data, rentalDetails: rentalDetails.data, returns: returns.data, payments: payments.data },
      error: customers.error || equipment.error || rentals.error || rentalDetails.error || returns.error || payments.error
    };
  } else if (url === '/api/jurnal') {
    result = await supabaseClient.from('jurnal_akuntansi')
      .select('id_jurnal, id_pengembalian, tgl_jurnal, kode_akun, nama_akun, debit, kredit, keterangan')
      .order('tgl_jurnal', { ascending: false }).order('id_jurnal', { ascending: false }).limit(500);
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
  document.querySelector('#metric-income').textContent = currency.format(summary.totalDendaDibayar);
  document.querySelector('#metric-late').textContent = summary.penyewaanTerlambat;
  document.querySelector('#metric-rented').textContent = summary.alatDisewa;
  const today = localDateValue();
  const rows = rentals.slice(0, 7).map(rental => {
    const late = rental.tgl_rencana_kembali < today;
    return `<tr><td><strong>${escapeHtml(rental.pelanggan?.nama || 'Pelanggan')}</strong><small>Sewa #${rental.id_sewa}</small></td><td>${formatDate(rental.tgl_rencana_kembali)}</td><td>${currency.format(Number(rental.total_biaya))}</td><td><span class="status-pill ${late ? 'status-late' : 'status-active'}"><i></i>${late ? 'Terlambat' : 'Berlangsung'}</span></td></tr>`;
  }).join('');
  document.querySelector('#due-table').innerHTML = rows || '<tr><td colspan="4" class="empty-cell">Belum ada penyewaan aktif.</td></tr>';
  renderRentalOptions();
  syncDateLimits();
  updateFineEstimate();
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
}

async function loadJournals() {
  state.journals = await api('/api/jurnal');
  renderJournals();
}

async function loadDetailData() {
  state.detail = await api('/api/detail');
  renderDetailData();
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
    list.innerHTML = '<div class="quiet-message">Semua unit sedang disewa.</div>';
    updateRentalEstimate();
    return;
  }
  list.innerHTML = available.map(item => `<label class="equipment-option">
    <input type="checkbox" name="equipment" value="${item.id_alat}" data-rate="${item.harga_sewa_per_hari}">
    <span class="check-box" aria-hidden="true">✓</span>
    <span class="equipment-name">${escapeHtml(item.nama_alat)}<small>Denda ${currency.format(Number(item.denda_per_hari))} / hari</small></span>
    <strong>${currency.format(Number(item.harga_sewa_per_hari))}<small>/ hari</small></strong>
  </label>`).join('');
  list.querySelectorAll('input').forEach(input => input.addEventListener('change', updateRentalEstimate));
  updateRentalEstimate();
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

function fillPaymentAmount(type) {
  const select = document.querySelector('#payment-return');
  const balance = Number(select.selectedOptions[0]?.dataset.balance || 0);
  if (!balance) return;
  document.querySelector('#payment-amount').value = type === 'half'
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
  return { customers, equipment, rentals, returns, paymentsByReturn, rentalDetails, paidByReturn };
}

function renderDetailData() {
  const data = state.detail;
  const selectReturn = document.querySelector('#history-return');
  const previousReturn = selectReturn.value;
  const selectCustomer = document.querySelector('#history-customer');
  const previousCustomer = selectCustomer.value;
  const { customers, rentals, returns } = detailLookups();
  const returnRows = [...data.returns].sort((a, b) => b.id_pengembalian - a.id_pengembalian);
  selectReturn.innerHTML = '<option value="">Pilih tagihan denda</option>' + returnRows.map(row => {
    const rental = rentals.get(row.id_sewa);
    const customer = customers.get(rental?.id_pelanggan);
    return `<option value="${row.id_pengembalian}">Sewa #${row.id_sewa} · ${escapeHtml(customer?.nama || 'Pelanggan')} · ${formatDate(row.tgl_kembali_aktual)} · ${currency.format(Number(row.total_denda))}</option>`;
  }).join('');
  if (returnRows.some(row => String(row.id_pengembalian) === previousReturn)) selectReturn.value = previousReturn;
  selectCustomer.innerHTML = '<option value="">Pilih pelanggan</option>' + data.customers.map(row =>
    `<option value="${row.id_pelanggan}">${escapeHtml(row.nama)} · ${escapeHtml(row.no_hp)}</option>`
  ).join('');
  if (data.customers.some(row => String(row.id_pelanggan) === previousCustomer)) selectCustomer.value = previousCustomer;
  renderPaymentHistory();
  renderCustomerHistory();
  renderEquipmentReport();
  renderFinancialReport();
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
  const { rentals, returns, rentalDetails, equipment, paidByReturn } = detailLookups();
  const rows = state.detail.rentals.filter(row => row.id_pelanggan === id)
    .sort((a, b) => b.tgl_sewa.localeCompare(a.tgl_sewa) || b.id_sewa - a.id_sewa)
    .map(rental => {
      const rentalReturn = returns.get(rental.id_sewa);
      const details = rentalDetails.get(rental.id_sewa) || [];
      const names = details.map(detail => equipment.get(detail.id_alat)?.nama_alat || 'Alat').join(', ');
      const paid = rentalReturn ? paidByReturn.get(rentalReturn.id_pengembalian) || 0 : 0;
      const fine = Number(rentalReturn?.total_denda || 0);
      const balance = Math.max(0, fine - paid);
      const status = rentalReturn
        ? fine === 0 ? 'Tidak ada denda' : balance === 0 ? 'Denda lunas' : paid > 0 ? 'Cicilan' : 'Denda belum lunas'
        : rental.status_sewa;
      return `<tr><td><strong>Sewa #${rental.id_sewa}</strong><small>${formatDate(rental.tgl_sewa)} – ${formatDate(rental.tgl_rencana_kembali)}</small></td>
        <td>${escapeHtml(names || '—')}</td><td>${escapeHtml(status)}</td>
        <td class="amount-cell">${currency.format(Number(rental.total_biaya))}</td>
        <td class="amount-cell">${fine ? `${currency.format(paid)} / ${currency.format(fine)}` : '—'}</td></tr>`;
    }).join('');
  container.innerHTML = `<table><thead><tr><th>PENYEWAAN</th><th>ALAT</th><th>STATUS</th><th class="amount-cell">BIAYA SEWA</th><th class="amount-cell">DIBAYAR / DENDA</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="empty-cell">Pelanggan ini belum memiliki riwayat penyewaan.</td></tr>'}</tbody></table>`;
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
    <small class="field-hint">Denda tercatat difilter berdasarkan tanggal kembali; pembayaran diterima berdasarkan tanggal bayar. Sisa piutang menunjukkan seluruh tagihan yang belum lunas saat ini.</small>`;
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

function renderJournals() {
  const debit = state.journals.reduce((sum, row) => sum + Number(row.debit), 0);
  const credit = state.journals.reduce((sum, row) => sum + Number(row.kredit), 0);
  document.querySelector('#journal-debit').textContent = currency.format(debit);
  document.querySelector('#journal-credit').textContent = currency.format(credit);
  document.querySelector('#journal-count').textContent = state.journals.length;
  const rows = state.journals.map(row => `<tr>
    <td class="journal-date">${formatDate(row.tgl_jurnal)}</td>
    <td><span class="account-code">${escapeHtml(row.kode_akun)}</span><strong class="account-name">${escapeHtml(row.nama_akun)}</strong></td>
    <td class="journal-description">${escapeHtml(row.keterangan)}</td>
    <td class="amount-cell">${Number(row.debit) ? currency.format(Number(row.debit)) : '<span class="muted-dash">—</span>'}</td>
    <td class="amount-cell">${Number(row.kredit) ? currency.format(Number(row.kredit)) : '<span class="muted-dash">—</span>'}</td>
  </tr>`).join('');
  document.querySelector('#journal-table').innerHTML = rows || '<tr><td colspan="5" class="empty-cell">Belum ada jurnal yang tercatat.</td></tr>';
}

async function refreshAll() {
  await Promise.all([loadCustomers(), loadEquipment(), loadDashboard(), loadUnpaid(), loadJournals(), loadDetailData()]);
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
  const rows = state.journals.map(row => [row.tgl_jurnal, row.kode_akun, row.nama_akun, row.keterangan, row.debit, row.kredit]);
  downloadCsv(`jurnal-denda-${localDateValue()}.csv`, [header, ...rows]);
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
  document.querySelector('#report-start').value = `${today.slice(0, 7)}-01`;
  document.querySelector('#report-end').value = today;
  syncDateLimits();

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showView(button.dataset.go)));
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
  document.querySelector('#history-return').addEventListener('change', renderPaymentHistory);
  document.querySelector('#history-customer').addEventListener('change', renderCustomerHistory);
  document.querySelector('#apply-report-filter').addEventListener('click', renderFinancialReport);
  document.querySelector('#download-detail-csv').addEventListener('click', exportDetailReport);
  document.querySelectorAll('[data-payment-amount]').forEach(button => button.addEventListener('click', () => {
    fillPaymentAmount(button.dataset.paymentAmount);
  }));
  document.querySelector('#download-csv').addEventListener('click', exportJournals);

  document.querySelector('#toggle-customer-form').addEventListener('click', () => {
    const form = document.querySelector('#customer-create');
    form.hidden = !form.hidden;
    if (!form.hidden) document.querySelector('#customer-name').focus();
  });

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
      await Promise.all([loadEquipment(), loadDashboard(), loadDetailData()]);
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

  refreshAll().catch(error => notify(`Gagal memuat data: ${error.message}`, true));
}

document.addEventListener('DOMContentLoaded', initialize);
