# Ritme - Rental & Accounting

Sistem web untuk mengelola rental alat musik, pengembalian, denda keterlambatan, pembayaran, dan jurnal akuntansi. Inventaris awal mencakup gitar, bass, keyboard, drum, mikrofon, biola, ukulele, cajon, saksofon, trompet, seruling, ampli, dan speaker; penjual juga dapat menambahkan alat beserta tarif sewanya dari halaman Transaksi. Setiap alat ditampilkan dengan ilustrasi vektor berdasarkan jenisnya. Untuk menambahkan delapan instrumen contoh pada database Supabase yang sudah ada, jalankan [migrations/20261008_add_more_instruments.sql](./migrations/20261008_add_more_instruments.sql) melalui SQL Editor Supabase. Dashboard penjual merangkum rental aktif, jadwal jatuh tempo tiga hari ke depan, keterlambatan, stok alat tersedia, dan pembayaran denda yang diterima. Jadwal dapat difilter berdasarkan status, sementara daftar tindak lanjut menyorot rental terlambat, pengembalian dekat, dan tagihan denda terbuka. Menu **Detail & laporan** menyediakan riwayat cicilan per tagihan, riwayat penyewaan pelanggan, performa tiap alat, serta rekap denda dan piutang yang dapat difilter tanggal dan diunduh sebagai CSV.

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

## Deploy menjadi link publik

Untuk tampilan dan link seperti `username.github.io/nama-repository`, repository ini sudah menyediakan workflow GitHub Pages. Mode Pages menjalankan frontend langsung di browser dan memakai Supabase sebagai backend data.

1. Buka repository GitHub, masuk ke **Settings > Secrets and variables > Actions**.
2. Tambahkan repository secrets `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY`.
3. Masuk ke **Settings > Pages**, pilih source **GitHub Actions**.
4. Jalankan workflow **Deploy GitHub Pages** dari tab **Actions**.
5. Salin URL Pages yang diberikan GitHub, biasanya `https://ayugirsang.github.io/RENTAL-MUSIK/`.

Workflow akan membuat `config.js` saat build tanpa menyimpan `.env` di repository. Setiap push ke branch `main` akan memicu deploy ulang.

Untuk menjalankan Express sebagai server API, gunakan `render.yaml` dan deployment Render. Mode ini cocok untuk penggunaan lokal atau server Node.js.

## Keamanan Supabase

`schema.sql` saat ini berisi policy demo untuk aplikasi akademik tanpa login. Sebelum deployment publik, ganti policy tersebut dengan RLS berbasis autentikasi Supabase dan batasi akses setiap pengguna sesuai kebutuhan.
