(function registerRitmeReportPrinter(global) {
  const currency = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function reportHeader(title, reference, period) {
    const business = global.RITME_BUSINESS_INFO || {};
    return `<header class="official-header">
      <h1>RITME — Studio &amp; Rental Alat Musik</h1>
      <p>${escapeHtml(business.address || 'Alamat usaha belum diatur')}</p>
      <p>WhatsApp: ${escapeHtml(business.phone || 'Belum diatur')}</p>
      <div class="official-double-rule"></div>
      <h2>${escapeHtml(title)}</h2>
      <div class="official-meta"><span>No. laporan</span><strong>${escapeHtml(reference)}</strong>
        <span>Periode</span><strong>${escapeHtml(period)}</strong></div>
    </header>`;
  }

  function signatures() {
    return `<section class="official-signatures report-signatures">
      <div><span>Dibuat oleh: Kasir/Staf</span><i></i><strong>Nama &amp; tanda tangan</strong></div>
      <div><span>Mengetahui: Pemilik/Manajer</span><i></i><strong>Nama &amp; tanda tangan</strong></div>
    </section>`;
  }

  function print(markup, landscape) {
    if (!global.RitmePrintReceipt?.printHtml) {
      throw new Error('Modul cetak dokumen belum siap. Muat ulang halaman dan coba lagi.');
    }
    global.RitmePrintReceipt.printHtml(markup, landscape);
  }

  function printIncomeReport(data) {
    const incomeRows = data.rows.map(row =>
      `<tr><td>${escapeHtml(row.period)}</td>
        <td class="amount-cell">${currency.format(row.rentRevenue)}</td>
        <td class="amount-cell">${currency.format(row.fineRevenue)}</td>
        <td class="amount-cell">${currency.format(row.otherRevenue)}</td>
        <td class="amount-cell"><strong>${currency.format(row.totalRevenue)}</strong></td>
        <td class="amount-cell">${currency.format(row.cash)}</td></tr>`).join('');
    const markup = `<article class="official-document report-document">
      ${reportHeader('LAPORAN PENDAPATAN &amp; BEBAN / LABA RUGI', data.reference, data.period)}
      <p class="official-note">Ringkasan ini disusun dari jurnal dan pembayaran yang tercatat di Ritme. Periksa kesesuaian dengan kebijakan akuntansi dan SAK yang berlaku sebelum digunakan sebagai laporan resmi.</p>
      <section class="official-section"><h3>Pendapatan akrual</h3>
        <table class="official-table"><thead><tr><th>Akun</th><th>Nama akun</th><th class="amount-cell">Jumlah</th></tr></thead>
          <tbody>
            <tr><td>4100</td><td>Pendapatan Sewa Alat Musik</td><td class="amount-cell">${currency.format(data.rentRevenue)}</td></tr>
            <tr><td>4110</td><td>Pendapatan Denda Keterlambatan</td><td class="amount-cell">${currency.format(data.fineRevenue)}</td></tr>
            <tr><td>4120</td><td>Pendapatan Ganti Rugi Kerusakan</td><td class="amount-cell">${currency.format(data.otherRevenue)}</td></tr>
            <tr class="official-total"><th colspan="2">TOTAL PENDAPATAN TERCATAT</th><th class="amount-cell">${currency.format(data.totalRevenue)}</th></tr>
          </tbody></table>
        <p class="official-note">Beban tidak dirinci karena aplikasi belum memiliki pencatatan akun beban.</p>
      </section>
      <section class="official-section"><h3>Kas masuk &amp; piutang usaha</h3>
        <table class="official-table"><thead><tr><th>Akun</th><th>Posisi</th><th class="amount-cell">Jumlah</th></tr></thead>
          <tbody>
            <tr><td>1110</td><td>Kas masuk aktual dalam periode</td><td class="amount-cell">${currency.format(data.cashReceived)}</td></tr>
            <tr><td>1120</td><td>Piutang sewa belum tertagih</td><td class="amount-cell">${currency.format(data.rentReceivable)}</td></tr>
            <tr><td>1130</td><td>Piutang denda belum tertagih</td><td class="amount-cell">${currency.format(data.fineReceivable)}</td></tr>
            <tr class="official-total"><th colspan="2">TOTAL PIUTANG USAHA</th><th class="amount-cell">${currency.format(data.rentReceivable + data.fineReceivable)}</th></tr>
          </tbody></table>
      </section>
      <section class="official-section"><h3>Ringkasan periode</h3>
        <table class="official-table"><thead><tr><th>Periode</th><th>Pendapatan sewa</th><th>Pendapatan denda</th><th>Pendapatan lainnya</th><th>Total pendapatan</th><th>Kas masuk</th></tr></thead>
          <tbody>${incomeRows || '<tr><td colspan="6">Tidak ada transaksi pendapatan dalam periode ini.</td></tr>'}
            <tr class="official-total"><th>TOTAL</th><th>${currency.format(data.rentRevenue)}</th><th>${currency.format(data.fineRevenue)}</th><th>${currency.format(data.otherRevenue)}</th><th>${currency.format(data.totalRevenue)}</th><th>${currency.format(data.cashReceived)}</th></tr>
          </tbody></table>
      </section>
      ${signatures()}
    </article>`;
    print(markup, true);
  }

  function getReference(row) {
    if (row.id_pembayaran_sewa) return `PS-${row.id_pembayaran_sewa}`;
    if (row.id_pembayaran_kerusakan) return `PK-${row.id_pembayaran_kerusakan}`;
    if (row.id_pembayaran) return `PD-${row.id_pembayaran}`;
    if (row.id_pengembalian) return `K-${row.id_pengembalian}`;
    if (row.id_sewa) return `S-${row.id_sewa}`;
    return '—';
  }

  function balanceLabel(balance, code) {
    const normalSide = String(code).startsWith('1') ? 'Debit' : 'Kredit';
    const side = balance < 0 ? (normalSide === 'Debit' ? 'Kredit' : 'Debit') : normalSide;
    return `${currency.format(Math.abs(balance))} ${side}`;
  }

  function printJournalReport(data) {
    const balances = new Map();
    const rows = [...data.rows]
      .sort((left, right) => left.tgl_jurnal.localeCompare(right.tgl_jurnal) || left.id_jurnal - right.id_jurnal)
      .map(row => {
        const code = String(row.kode_akun);
        const change = code.startsWith('1')
          ? Number(row.debit) - Number(row.kredit)
          : Number(row.kredit) - Number(row.debit);
        const balance = (balances.get(code) || 0) + change;
        balances.set(code, balance);
        return `<tr><td>${formatDate(row.tgl_jurnal)}</td><td>${getReference(row)}</td>
          <td>${escapeHtml(row.kode_akun)} · ${escapeHtml(row.nama_akun)}<br><small>${escapeHtml(row.keterangan)}</small></td>
          <td class="amount-cell">${Number(row.debit) ? currency.format(Number(row.debit)) : '—'}</td>
          <td class="amount-cell">${Number(row.kredit) ? currency.format(Number(row.kredit)) : '—'}</td>
          <td class="amount-cell">${balanceLabel(balance, code)}</td></tr>`;
      }).join('');
    const markup = `<article class="official-document report-document">
      ${reportHeader('JURNAL UMUM', data.reference, data.period)}
      <section class="official-section"><table class="official-table"><thead><tr>
        <th>Tanggal</th><th>No. Bukti/Ref</th><th>Keterangan Akun</th>
        <th class="amount-cell">Debit</th><th class="amount-cell">Kredit</th><th class="amount-cell">Saldo Berjalan</th>
      </tr></thead><tbody>${rows}
        <tr class="official-total"><th colspan="3">TOTAL BALANCE</th>
          <th class="amount-cell">${currency.format(data.debit)}</th><th class="amount-cell">${currency.format(data.credit)}</th>
          <th>${Math.abs(data.debit - data.credit) < 0.5 ? 'Seimbang' : `Selisih ${currency.format(Math.abs(data.debit - data.credit))}`}</th></tr>
      </tbody></table></section>
      ${signatures()}
    </article>`;
    print(markup, true);
  }

  function printLedgerReport(data) {
    const rows = data.rows.map(row =>
      `<tr><td>${formatDate(row.tgl_jurnal)}</td><td>${getReference(row)}</td>
        <td>${escapeHtml(row.keterangan)}</td>
        <td class="amount-cell">${Number(row.debit) ? currency.format(Number(row.debit)) : '—'}</td>
        <td class="amount-cell">${Number(row.kredit) ? currency.format(Number(row.kredit)) : '—'}</td>
        <td class="amount-cell">${balanceLabel(row.balance, data.code)}</td></tr>`).join('');
    const markup = `<article class="official-document report-document">
      ${reportHeader(`BUKU BESAR · ${data.accountName}`, data.reference, data.period)}
      <p class="official-note">Akun ${escapeHtml(data.code)} · Saldo awal: ${balanceLabel(data.opening, data.code)}</p>
      <section class="official-section"><table class="official-table"><thead><tr>
        <th>Tanggal</th><th>No. Bukti/Ref</th><th>Keterangan Akun</th>
        <th class="amount-cell">Debit</th><th class="amount-cell">Kredit</th><th class="amount-cell">Saldo Berjalan</th>
      </tr></thead><tbody>${rows}
        <tr class="official-total"><th colspan="3">TOTAL MUTASI</th>
          <th class="amount-cell">${currency.format(data.debit)}</th><th class="amount-cell">${currency.format(data.credit)}</th>
          <th class="amount-cell">${balanceLabel(data.balance, data.code)}</th></tr>
      </tbody></table></section>
      ${signatures()}
    </article>`;
    print(markup, true);
  }

  global.RitmeReportPrinter = Object.freeze({
    printIncomeReport,
    printJournalReport,
    printLedgerReport
  });
})(window);
