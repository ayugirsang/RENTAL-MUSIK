(function registerRitmeWhatsAppReminders(global) {
  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('62')) return digits;
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (!digits.startsWith('8')) return '';
    return `62${digits}`;
  }

  function createLink(data) {
    const phone = normalizePhone(data.phone);
    if (!phone) return '';

    const name = String(data.customerName || 'Pelanggan').trim() || 'Pelanggan';
    const items = (data.itemNames || []).filter(Boolean).join(', ') || 'alat musik';
    let message;
    if (data.daysLate > 0) {
      const fine = Math.max(0, Number(data.finePerDay) || 0) * data.daysLate;
      const formattedFine = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
      }).format(fine);
      message = `Halo Kak ${name}, kami dari Ritme Studio Musik menginformasikan bahwa sewa alat musik ${items} telah melewati batas jatuh tempo (${data.daysLate} hari). Mohon segera mengembalikan unit ke studio. Denda keterlambatan berjalan: ${formattedFine}. Terima kasih!`;
    } else {
      message = `Halo Kak ${name}, kami dari Ritme Studio Musik ingin mengingatkan bahwa sewa alat musik ${items} jatuh tempo pada ${data.dueDate}. Mohon untuk melakukan pengembalian tepat waktu. Terima kasih!`;
    }

    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }

  global.RitmeWhatsAppReminders = Object.freeze({ createLink, normalizePhone });
})(window);
