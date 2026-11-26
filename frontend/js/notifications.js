(function () {
  'use strict';

  function formatRupiah(value) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(Math.max(0, Number(value) || 0));
  }

  function showToast(message, type = 'success') {
    let container = document.querySelector('#toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const icon = type === 'success' ? '✓' : type === 'warning' ? '!' : '×';
    toast.innerHTML =
      `<span class="toast-icon" aria-hidden="true">${icon}</span>` +
      `<span class="toast-message"></span>` +
      '<button class="toast-close" type="button" aria-label="Tutup notifikasi">×</button>';
    toast.querySelector('.toast-message').textContent = String(message || 'Terjadi kesalahan.');

    let timer = window.setTimeout(() => dismissToast(toast), 4500);
    toast.querySelector('.toast-close').addEventListener('click', () => {
      window.clearTimeout(timer);
      dismissToast(toast);
    });
    container.appendChild(toast);
  }

  function dismissToast(toast) {
    if (!toast.isConnected) return;
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 180);
  }

  function ensureErrorElement(input) {
    let error = input.parentElement?.querySelector(`:scope > [data-error-for="${CSS.escape(input.id)}"]`);
    if (!error) {
      error = document.createElement('small');
      error.className = 'input-error-msg';
      error.dataset.errorFor = input.id;
      error.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', error);
    }
    return error;
  }

  function setFieldError(input, message) {
    if (!input) return false;
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
    const error = ensureErrorElement(input);
    error.textContent = message || '';
    error.hidden = !message;
    return Boolean(message);
  }

  function clearFieldError(input) {
    return setFieldError(input, '');
  }

  function setupFieldValidation(input, validator) {
    if (!input) return;
    const validate = () => setFieldError(input, validator(input.value));
    input.addEventListener('input', validate);
    input.addEventListener('blur', validate);
    input.addEventListener('change', validate);
  }

  function validateCustomerName(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return 'Nama pelanggan wajib diisi.';
    if (trimmed.length < 3) return 'Nama pelanggan minimal 3 karakter.';
    return '';
  }

  function validatePhone(value) {
    const phone = String(value || '').trim();
    if (!phone) return 'Nomor telepon wajib diisi.';
    if (!/^\d+$/.test(phone)) return 'Nomor telepon harus berupa angka.';
    if (phone.length < 10 || phone.length > 15) return 'Nomor telepon minimal 10 dan maksimal 15 digit.';
    return '';
  }

  function validatePositiveRate(value) {
    if (String(value || '').trim() === '') return 'Tarif sewa wajib diisi.';
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return 'Tarif sewa / hari harus lebih besar dari 0.';
    return '';
  }

  function validateFineRate(value) {
    if (String(value || '').trim() === '') return 'Tarif denda wajib diisi.';
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return 'Tarif denda / hari tidak boleh negatif.';
    return '';
  }

  function validateDatePair(startInput, endInput) {
    if (!endInput.value) {
      setFieldError(endInput, 'Tanggal rencana kembali wajib diisi.');
      return false;
    }
    const message = startInput.value && endInput.value && endInput.value < startInput.value
      ? 'Tanggal jatuh tempo tidak boleh sebelum tanggal sewa!'
      : '';
    setFieldError(endInput, message);
    return !message;
  }

  function validatePaymentAmount(input, getMaximum) {
    const amount = Number(input.value);
    const maximum = Number(getMaximum() || 0);
    if (!input.value.trim()) return setFieldError(input, 'Nominal pembayaran wajib diisi.');
    if (!Number.isFinite(amount) || amount <= 0) {
      return setFieldError(input, 'Nominal pembayaran tidak boleh nol atau negatif.');
    }
    if (maximum <= 0) return setFieldError(input, 'Tidak ada sisa tagihan yang dapat dibayar.');
    if (amount > maximum) {
      return setFieldError(input, `Nominal bayar melebihi sisa tagihan (Maks. ${formatRupiah(maximum)}).`);
    }
    return clearFieldError(input);
  }

  function setupFormValidation(form, rules, extraValid = () => true) {
    if (!form) return;
    const button = form.querySelector('[type="submit"]');
    const validateAll = () => {
      let valid = extraValid();
      for (const rule of rules) {
        const input = form.querySelector(rule.selector);
        if (!input) continue;
        const message = rule.validator(input.value);
        setFieldError(input, message);
        if (message) valid = false;
      }
      if (button) button.disabled = !valid;
      return valid;
    };

    for (const rule of rules) {
      const input = form.querySelector(rule.selector);
      if (!input) continue;
      ['input', 'change', 'blur'].forEach(eventName =>
        input.addEventListener(eventName, validateAll));
    }
    form.addEventListener('reset', () => window.setTimeout(validateAll, 0));
    validateAll();
  }

  window.showToast = showToast;
  window.RitmeFeedback = {
    showToast,
    setFieldError,
    clearFieldError,
    setupFieldValidation,
    setupFormValidation,
    validateCustomerName,
    validatePhone,
    validatePositiveRate,
    validateFineRate,
    validateDatePair,
    validatePaymentAmount,
    formatRupiah
  };
})();
