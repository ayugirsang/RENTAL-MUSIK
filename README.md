# Ritme — Sistem Informasi Rental Alat Musik

**Ritme** adalah aplikasi web untuk membantu penjual mengelola usaha rental alat musik. Aplikasi mencatat pelanggan, inventaris, transaksi penyewaan, pengembalian, denda keterlambatan, pembayaran cicilan denda, serta jurnal dan laporan.

> Proyek ini dibuat sebagai aplikasi demo/tugas akademik. Data tersimpan di Supabase.

## Tautan proyek

- **Repository GitHub:** [ayugirsang/RENTAL-MUSIK](https://github.com/ayugirsang/RENTAL-MUSIK)
- **Aplikasi demo:** [ayugirsang.github.io/RENTAL-MUSIK](https://ayugirsang.github.io/RENTAL-MUSIK/)

Repository berisi kode sumber, skema database, panduan, dan konfigurasi deployment. Tautan demo digunakan untuk mencoba aplikasinya.

## Fitur

| Menu/fitur | Penjelasan |
| --- | --- |
| **Ringkasan penjual** | Menampilkan jumlah penyewaan aktif, alat tersedia, pengembalian yang segera jatuh tempo, keterlambatan, dan pembayaran denda yang diterima. Daftar jadwal dapat difilter dan dilengkapi tindak lanjut. |
| **Pelanggan** | Menambahkan dan memilih pelanggan untuk transaksi rental. |
| **Inventaris alat musik** | Menyediakan contoh gitar, bass, keyboard, drum, mikrofon, biola, ukulele, cajon, saksofon, trompet, seruling, ampli, dan speaker. Penjual dapat menambahkan alat beserta tarif sewa dan denda per hari. Pilihan alat dilengkapi ilustrasi vektor. |
| **Penyewaan** | Membuat penyewaan dari alat yang tersedia. Biaya dihitung dari tarif harian dan lama penyewaan. Alat yang dipilih berubah menjadi berstatus disewa. |
| **Pengembalian** | Mencatat tanggal kembali, menghitung keterlambatan dan denda secara otomatis, menyelesaikan penyewaan, dan mengembalikan status alat menjadi tersedia. |
| **Pembayaran denda** | Menerima pembayaran tunai, transfer, atau QRIS. Denda dapat dibayar bertahap; sistem menampilkan total tagihan, jumlah yang dibayar, dan sisanya serta menolak pembayaran melebihi sisa denda. |
| **Detail & laporan** | Menampilkan riwayat cicilan per tagihan, riwayat penyewaan pelanggan, performa alat, serta laporan denda dan piutang dengan filter tanggal dan ekspor CSV. |
| **Jurnal akuntansi** | Mencatat akrual denda dan pembayaran denda secara otomatis, serta menyediakan ringkasan debit/kredit dan ekspor CSV. |

### Alur pencatatan denda

1. Saat pengembalian dicatat, denda dihitung berdasarkan jumlah hari terlambat dan tarif denda alat.
2. Denda yang timbul dicatat sebagai piutang dan pendapatan denda.
3. Setiap pembayaran mengurangi piutang. Pembayaran sebagian menyisakan saldo sampai tagihan lunas.
4. Status tagihan diperbarui menjadi **Belum Lunas**, **Sebagian**, atau **Lunas**.

| Peristiwa | Debit | Kredit |
| --- | --- | --- |
| Denda diakui saat pengembalian | Piutang Denda (1130) | Pendapatan Denda Keterlambatan (4110) |
| Pembayaran denda diterima | Kas (1110) | Piutang Denda (1130) |

**Catatan:** aplikasi mencatat nilai/tagihan biaya sewa, tetapi belum memiliki pencatatan penerimaan pembayaran biaya sewa. Karena itu, nilai sewa tidak ditampilkan sebagai kas yang sudah diterima.

## Teknologi

- **Frontend:** HTML, CSS, JavaScript (tanpa framework)
- **API/server lokal:** Node.js dan Express
- **Database:** Supabase PostgreSQL
- **Hosting demo:** GitHub Pages
- **Pemeriksaan otomatis:** GitHub Actions

Di GitHub Pages, frontend mengakses Supabase langsung menggunakan publishable key yang disediakan melalui konfigurasi GitHub Actions. Pada mode server, aplikasi menggunakan Express sebagai API.

## Menjalankan secara lokal

### Persiapan

- Node.js dan npm
- Project Supabase

### Langkah

1. Clone repository dan masuk ke folder proyek:

   ```powershell
   git clone https://github.com/ayugirsang/RENTAL-MUSIK.git
   cd RENTAL-MUSIK
   ```

2. Pasang dependensi:

   ```powershell
   npm install
   ```

3. Buat file `.env` berdasarkan `.env.example`, lalu isi konfigurasi Supabase:

   ```env
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   PORT=3000
   ```

4. Jalankan isi [`schema.sql`](./schema.sql) melalui Supabase SQL Editor untuk membuat tabel, fungsi, trigger, kebijakan demo, dan inventaris contoh.

5. Jalankan server dan buka [http://localhost:3000](http://localhost:3000):

   ```powershell
   npm start
   ```

Untuk menambahkan delapan instrumen contoh ke database yang sudah pernah dibuat, jalankan sekali [`migrations/20261008_add_more_instruments.sql`](./migrations/20261008_add_more_instruments.sql) melalui Supabase SQL Editor. Migrasi tersebut tidak menggandakan alat dengan nama yang sama.

## Pemeriksaan proyek

```powershell
npm test
node --check public\script.js
git diff --check
```

## Deployment GitHub Pages

Repository ini memiliki workflow **Deploy GitHub Pages**. Untuk menyiapkan deployment:

1. Tambahkan repository secrets `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` melalui **Settings → Secrets and variables → Actions**.
2. Pastikan GitHub Pages menggunakan source **GitHub Actions** di **Settings → Pages**.
3. Push perubahan ke branch `main`; workflow akan membangun konfigurasi frontend dan menerbitkan situs.

URL demo proyek: <https://ayugirsang.github.io/RENTAL-MUSIK/>.

## Struktur penting repository

```text
app.js                                  API Express
public/                                 Frontend aplikasi
schema.sql                              Skema, fungsi, trigger, dan data contoh Supabase
migrations/20261008_add_more_instruments.sql
                                        Migrasi alat musik untuk database yang sudah ada
.github/workflows/                      Pemeriksaan dan deployment otomatis
```

## Batasan keamanan demo

Aplikasi ini belum menggunakan login. Kebijakan pada [`schema.sql`](./schema.sql) mengizinkan operasi data demo melalui role Supabase `anon` agar aplikasi akademik dapat dicoba. **Jangan gunakan konfigurasi ini untuk menyimpan data usaha nyata atau data sensitif.** Untuk penggunaan produksi, tambahkan autentikasi Supabase dan batasi Row Level Security (RLS) sesuai peran pengguna.

Jangan pernah memasukkan `service_role` key atau file `.env` ke repository, frontend, maupun konfigurasi publik.
