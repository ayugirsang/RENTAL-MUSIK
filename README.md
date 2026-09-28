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

## GitHub dan Supabase

Kode aplikasi disimpan di GitHub, sedangkan data transaksi disimpan di Supabase. GitHub Actions hanya memeriksa kode; kredensial Supabase tetap disimpan sebagai environment variable dan tidak dimasukkan ke repository.

Repository:

```text
https://github.com/ayugirsang/rental-musik.git
```

Untuk mengirim perubahan:

```powershell
git push -u origin main
```

File `.env` dan `node_modules` tidak dikirim ke GitHub. Jangan menaruh `service_role` key di repository atau di browser.

## Keamanan Supabase

`schema.sql` saat ini berisi policy demo untuk aplikasi akademik tanpa login. Sebelum deployment publik, ganti policy tersebut dengan RLS berbasis autentikasi Supabase dan batasi akses setiap pengguna sesuai kebutuhan.
