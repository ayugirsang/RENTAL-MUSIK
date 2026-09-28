# Ritme - Rental & Accounting

Sistem web untuk mengelola rental alat musik, pengembalian, denda keterlambatan, pembayaran, dan jurnal akuntansi.

## Kebutuhan

- Node.js
- Project Supabase
- Git (opsional, untuk mengirim kode ke GitHub)

## Menjalankan aplikasi

1. Install dependensi:

   ```powershell
   npm install
   ```

2. Salin `.env.example` menjadi `.env`, lalu isi kredensial Supabase:

   ```env
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   PORT=3000
   ```

3. Jalankan isi `schema.sql` melalui Supabase SQL Editor.

4. Jalankan server:

   ```powershell
   npm start
   ```

5. Buka aplikasi di [http://localhost:3000](http://localhost:3000).

## Pemeriksaan

```powershell
npm run check
```

## GitHub

Repository lokal terhubung ke:

```text
https://github.com/ayugirsang/rental-musik.git
```

Setelah repository kosong dibuat di GitHub, kirim commit dengan:

```powershell
git push -u origin main
```

File `.env` dan `node_modules` tidak dikirim ke GitHub.
