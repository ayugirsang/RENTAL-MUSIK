(function registerRitmePrintReceipt(global) {
  const currency = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  });
  const numberWords = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

  function numberToWords(value) {
    if (value < 12) return numberWords[value];
    if (value < 20) return `${numberToWords(value - 10)} belas`;
    if (value < 100) return `${numberToWords(Math.floor(value / 10))} puluh${value % 10 ? ` ${numberToWords(value % 10)}` : ''}`;
    if (value < 200) return `seratus${value % 100 ? ` ${numberToWords(value % 100)}` : ''}`;
    if (value < 1000) return `${numberToWords(Math.floor(value / 100))} ratus${value % 100 ? ` ${numberToWords(value % 100)}` : ''}`;
    if (value < 2000) return `seribu${value % 1000 ? ` ${numberToWords(value % 1000)}` : ''}`;
    if (value < 1_000_000) return `${numberToWords(Math.floor(value / 1000))} ribu${value % 1000 ? ` ${numberToWords(value % 1000)}` : ''}`;
    if (value < 1_000_000_000) return `${numberToWords(Math.floor(value / 1_000_000))} juta${value % 1_000_000 ? ` ${numberToWords(value % 1_000_000)}` : ''}`;
    return `${numberToWords(Math.floor(value / 1_000_000_000))} miliar${value % 1_000_000_000 ? ` ${numberToWords(value % 1_000_000_000)}` : ''}`;
  }

  function spellRupiah(value) {
    const amount = Math.round(Number(value) || 0);
    return `${numberToWords(amount)} rupiah`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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

  function printMarkup(markup, mode, landscape = false) {
    const area = document.querySelector('#printable-receipt-area');
    if (!area) throw new Error('Kontainer cetak tidak ditemukan.');
    area.innerHTML = markup;
    document.body.classList.toggle('printing-receipt', mode === 'thermal');
    document.body.classList.toggle('printing-document', mode !== 'thermal');
    document.body.classList.toggle('print-landscape', landscape);
    area.hidden = false;
    const cleanup = () => {
      document.body.classList.remove('printing-receipt', 'printing-document', 'print-landscape');
      area.hidden = true;
      global.removeEventListener('afterprint', cleanup);
    };
    global.addEventListener('afterprint', cleanup);
    global.print();
    global.setTimeout(cleanup, 1000);
  }

  function transactionRows(data) {
    return (data.items || []).map(item =>
      `<tr><td>${escapeHtml(item.name)} × ${Number(item.quantity || 1)}</td>
        <td>${currency.format(Number(item.amount || 0))}</td></tr>`).join('');
  }

  function renderThermal(data) {
    const business = data.business || {};
    const late = data.late || {};
    const damage = data.damage || {};
    const payment = data.payment || {};
    const itemRows = transactionRows(data);
    const amountRows = [
      `<div><span>Total sewa</span><strong>${currency.format(Number(data.rentTotal || 0))}</strong></div>`,
      `<div><span>Denda terlambat · ${Number(late.days || 0)} hari</span><strong>${currency.format(Number(late.amount || 0))}</strong></div>`,
      `<div><span>Biaya kerusakan</span><strong>${currency.format(Number(damage.cost || 0))}</strong></div>`,
      `<div><span>Total tagihan</span><strong>${currency.format(Number(payment.total || 0))}</strong></div>`,
      `<div><span>Dibayar</span><strong>${currency.format(Number(payment.paid || 0))}</strong></div>`,
      `<div><span>Sisa piutang</span><strong>${currency.format(Number(payment.balance || 0))}</strong></div>`,
      `<div><span>Metode</span><strong>${escapeHtml(payment.method || '—')}</strong></div>`
    ].join('');
    return `<article class="receipt">
      <header class="receipt-header"><strong>RITME</strong><span>STUDIO MUSIK</span><h1>${escapeHtml(data.title)}</h1></header>
      <div class="receipt-meta"><span>No. transaksi</span><strong>${escapeHtml(data.reference)}</strong>
        <span>Tanggal</span><strong>${formatDate(data.date)}</strong></div>
      <section class="receipt-customer"><strong>${escapeHtml(data.customer?.name || 'Pelanggan')}</strong>
        <span>${escapeHtml(data.customer?.phone || 'Nomor HP tidak tersedia')}</span></section>
      <table class="receipt-items"><thead><tr><th>RINCIAN</th><th class="receipt-number">JUMLAH</th></tr></thead>
        <tbody>${itemRows || '<tr><td>Alat musik</td><td class="receipt-number">—</td></tr>'}</tbody></table>
      <p class="receipt-duration">Durasi sewa ${Number(data.durationDays || 0)} hari · Kembali rencana ${formatDate(data.dueDate)}${data.returnDate ? ` · aktual ${formatDate(data.returnDate)}` : ''}</p>
      <section class="receipt-payment">${amountRows}
        <div><span>Kondisi alat</span><strong>${escapeHtml(damage.condition || 'Belum dicatat')}</strong></div>
        ${damage.note && damage.note !== '-' ? `<div><span>Catatan</span><strong>${escapeHtml(damage.note)}</strong></div>` : ''}
      </section>
      <footer><p>${escapeHtml(business.address || 'Alamat usaha belum diatur')}</p>
        <p>Kontak: ${escapeHtml(business.phone || 'Belum diatur')}</p>
        <p>Dicetak ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</p>
        <strong>${escapeHtml(payment.status || 'BELUM LUNAS')}</strong><p>Terima kasih telah memilih Ritme.</p></footer>
    </article>`;
  }

  function renderOfficial(data) {
    const business = data.business || {};
    const late = data.late || {};
    const damage = data.damage || {};
    const payment = data.payment || {};
    const items = (data.items || []).map(item =>
      `<tr><td>${escapeHtml(item.name)} × ${Number(item.quantity || 1)}</td>
        <td>${currency.format(Number(item.dailyRate || 0))}</td>
        <td>${currency.format(Number(item.amount || 0))}</td></tr>`).join('');
    const printedAt = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'long',
      timeStyle: 'short'
    }).format(new Date());
    const signatures = data.signatures
      ? `<section class="official-signatures"><div><span>Penyewa / Pelanggan</span><i></i><strong>${escapeHtml(data.customer?.name || 'Nama & tanda tangan')}</strong></div>
          <div><span>Petugas / Kasir Ritme</span><i></i><strong>Nama &amp; tanda tangan</strong></div></section>`
      : '';
    return `<article class="official-document">
      <header class="official-header"><h1>RITME — Rental &amp; Studio Musik</h1>
        <p>${escapeHtml(business.address || 'Alamat usaha belum diatur')}</p>
        <p>WhatsApp: ${escapeHtml(business.phone || 'Belum diatur')} · Email: ${escapeHtml(business.email || 'Belum diatur')}</p>
        <div class="official-double-rule"></div><h2>${escapeHtml(data.title)}</h2>
        <div class="official-meta"><span>No. dokumen</span><strong>${escapeHtml(data.reference)}</strong>
          <span>Tanggal</span><strong>${formatDate(data.date)}</strong></div></header>
      <section class="official-section"><h3>Identitas pelanggan</h3><dl class="official-details">
        <dt>Nama</dt><dd>${escapeHtml(data.customer?.name || 'Pelanggan')}</dd>
        <dt>Nomor telepon</dt><dd>${escapeHtml(data.customer?.phone || 'Tidak tersedia')}</dd>
        <dt>Nomor penyewaan</dt><dd>${escapeHtml(data.rentalReference || data.reference)}</dd>
      </dl></section>
      <section class="official-section"><h3>Rincian alat musik · tarif per hari</h3>
        <table class="official-table"><thead><tr><th>Nama alat</th><th>Tarif / hari</th><th>Subtotal sewa</th></tr></thead>
          <tbody>${items || '<tr><td colspan="3">Tidak ada rincian alat.</td></tr>'}</tbody></table>
        <p class="official-note">Tanggal sewa: ${formatDate(data.rentDate)} · Rencana kembali: ${formatDate(data.dueDate)}</p>
      </section>
      ${data.returnDate ? `<section class="official-section"><h3>Rincian pengembalian</h3><dl class="official-details">
        <dt>Tanggal kembali aktual</dt><dd>${formatDate(data.returnDate)}</dd>
        <dt>Keterlambatan</dt><dd>${Number(late.days || 0)} hari</dd>
        <dt>Denda keterlambatan</dt><dd>${currency.format(Number(late.amount || 0))}</dd>
        <dt>Kondisi alat</dt><dd>${escapeHtml(damage.condition || 'Baik')}</dd>
        <dt>Biaya kerusakan</dt><dd>${currency.format(Number(damage.cost || 0))}</dd>
        <dt>Catatan kerusakan</dt><dd>${escapeHtml(damage.note || '-')}</dd>
      </dl></section>` : ''}
      <section class="official-section"><h3>Ringkasan pembayaran</h3><dl class="official-details">
        <dt>Total sewa</dt><dd>${currency.format(Number(data.rentTotal || 0))}</dd>
        <dt>Denda terlambat</dt><dd>${currency.format(Number(late.amount || 0))}</dd>
        <dt>Biaya kerusakan</dt><dd>${currency.format(Number(damage.cost || 0))}</dd>
        <dt>Total tagihan</dt><dd>${currency.format(Number(payment.total || 0))}</dd>
        <dt>Dibayar saat ini</dt><dd>${currency.format(Number(payment.amountNow || 0))}</dd>
        <dt>Terbilang</dt><dd>${escapeHtml(spellRupiah(payment.amountNow || 0))}</dd>
        <dt>Akumulasi dibayar</dt><dd>${currency.format(Number(payment.paid || 0))}</dd>
        <dt>Metode</dt><dd>${escapeHtml(payment.method || '—')}</dd>
        <dt>Sisa piutang</dt><dd>${currency.format(Number(payment.balance || 0))}</dd>
        <dt>Status</dt><dd><strong>${escapeHtml(payment.status || 'BELUM LUNAS')}</strong></dd>
      </dl></section>
      <section class="official-section"><h3>Tanggung jawab alat &amp; ganti rugi</h3>
        <p>Pelanggan wajib menjaga alat selama masa sewa. Kerusakan atau kehilangan dicatat terpisah dari denda keterlambatan dan dapat dikenakan biaya ganti rugi berdasarkan pemeriksaan petugas.</p>
      </section>
      ${signatures}
      <footer class="official-footer"><span>Dicetak ${escapeHtml(printedAt)}</span><span>${escapeHtml(business.name || 'Ritme — Rental & Studio Musik')}</span></footer>
    </article>`;
  }

  global.RitmePrintReceipt = Object.freeze({
    printThermal(data) {
      printMarkup(renderThermal(data), 'thermal');
    },
    printOfficial(data) {
      printMarkup(renderOfficial(data), 'official');
    },
    printHtml(markup, landscape = false) {
      printMarkup(markup, 'official', landscape);
    }
  });
})(window);
