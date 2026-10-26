# Analisis Kelayakan dan SDLC — Ritme

Dokumen ini melengkapi proyek **Ritme**, aplikasi Sistem Informasi Akuntansi
untuk usaha rental alat musik, sebagai laporan analisis dan pengembangan web.
Dokumen disusun mengikuti lima tahap System Development Life Cycle (SDLC) pada
materi tugas. Nilai biaya, manfaat, dan jadwal berikut merupakan estimasi
akademik; angka finansial usaha harus dikumpulkan dari pemilik sebelum dipakai
sebagai keputusan investasi.

## 1. Ringkasan proyek

Usaha rental alat musik perlu mengelola pelanggan, ketersediaan alat, lama
penyewaan, pengembalian, keterlambatan, tagihan, dan penerimaan kas. Jika
informasi tersebut dicatat terpisah, pemilik berisiko kesulitan mengetahui alat
yang sedang disewa, rental yang jatuh tempo, sisa piutang, serta perbedaan
antara pendapatan yang diakui dan kas yang diterima.

Ritme menggabungkan proses operasional rental dengan pencatatan akuntansi
berbasis akrual. Pengguna dapat melihat dashboard, mengelola pelanggan dan
inventaris, mencatat rental dan pengembalian, mencatat cicilan pembayaran,
serta melihat jurnal umum, buku besar, dan laporan pendapatan.

**Tujuan:** menyediakan prototipe web yang membantu pencatatan operasional dan
akuntansi rental secara terintegrasi, menampilkan status transaksi secara
dinamis, dan mengurangi perhitungan manual.

**Pengguna yang dituju:** pemilik atau petugas rental yang mengelola transaksi.
Pelanggan tidak menggunakan aplikasi secara langsung.

**Ruang lingkup:** pencatatan satu usaha rental, data pelanggan dan alat,
penyewaan, pengembalian dan denda, pembayaran sewa dan denda, serta laporan
akuntansi dasar.

**Di luar ruang lingkup:** autentikasi dan pembagian peran, pembayaran daring,
multi-cabang, perpajakan, penggajian, dan laporan keuangan lengkap untuk
kepatuhan eksternal.

## 2. Analisis sistem

### 2.1 Survei proses dan permasalahan

Alur yang ditangani aplikasi:

1. Petugas memilih atau menambahkan pelanggan dan alat yang tersedia.
2. Petugas membuat transaksi rental dengan tanggal sewa dan tanggal rencana
   kembali.
3. Sistem menghitung nilai sewa, mencatat detail alat, dan menandai alat
   sebagai sedang disewa.
4. Petugas dapat mencatat pembayaran sewa penuh atau sebagian.
5. Saat pengembalian, sistem membandingkan tanggal aktual dengan tanggal
   rencana, menghitung hari keterlambatan dan denda, lalu mengembalikan status
   alat menjadi tersedia.
6. Petugas dapat mencatat pembayaran denda penuh atau sebagian.
7. Sistem menyediakan ringkasan operasional dan laporan jurnal untuk
   peninjauan.

Sebelum dipakai di luar demonstrasi kelas, proses di atas perlu divalidasi
bersama pemilik rental, khususnya kebijakan minimum lama sewa, tarif, denda,
metode pembayaran, pembatalan, dan koreksi transaksi.

### 2.2 Kebutuhan sistem

**Kebutuhan fungsional**

- Menampilkan ringkasan pendapatan, kas, piutang yang tercatat, stok, rental
  aktif, dan pengingat jatuh tempo.
- Menambah, menampilkan, dan memperbarui data pelanggan serta inventaris alat
  musik. Tarif unit yang sedang disewa tidak boleh diubah sampai pengembalian
  selesai agar perhitungan transaksi berjalan tetap konsisten.
- Membuat rental dengan satu atau lebih alat yang tersedia dan mencegah alat
  yang sama dipilih lebih dari sekali.
- Menghitung biaya rental dan denda keterlambatan dari tarif serta durasi.
- Mencatat pembayaran sewa dan denda, termasuk cicilan, dengan metode tunai,
  transfer, atau QRIS.
- Menampilkan status sisa tagihan, jurnal umum, buku besar, dan laporan
  pendapatan sesuai periode.
- Menyediakan ekspor CSV pada buku besar dan laporan pendapatan.

**Kebutuhan nonfungsional**

- Antarmuka berbahasa Indonesia dan dapat digunakan pada layar desktop maupun
  ponsel.
- Validasi dilakukan pada antarmuka dan di fungsi database untuk transaksi
  penting.
- Perubahan stok, transaksi rental, pengembalian, dan pencatatan jurnal
  disimpan dalam PostgreSQL melalui Supabase.
- Aplikasi memberikan notifikasi ketika permintaan gagal, bukan menyamarkan
  kegagalan sebagai transaksi berhasil.
- Konfigurasi publik hanya menggunakan Supabase publishable key; kunci
  `service_role` tidak boleh ditempatkan di frontend atau repository.

## 3. Studi kelayakan

| Aspek | Penilaian awal | Pertimbangan dan syarat |
| --- | --- | --- |
| Ekonomi | Layak untuk prototipe akademik; kelayakan usaha belum dapat dihitung. | Stack yang digunakan memiliki opsi gratis untuk demonstrasi. Tetap perhitungkan waktu pengembangan, internet, pemeliharaan, dan kemungkinan biaya layanan. Kumpulkan biaya dan manfaat nyata sebelum menghitung payback period; jangan menganggap manfaat atau ROI sudah terbukti. |
| Teknis | Layak. | HTML, CSS, JavaScript, Node.js, PostgreSQL/Supabase, GitHub Actions, dan GitHub Pages telah digunakan. Koneksi database bergantung pada konfigurasi project, kebijakan RLS, dan ketersediaan jaringan. |
| Hukum | Layak bersyarat untuk data demo. | Gunakan data fiktif untuk demonstrasi. Sebelum menyimpan data pelanggan nyata, tentukan tujuan dan dasar pemrosesan, batasi akses, lindungi data, dan tetapkan retensi/penghapusan sesuai ketentuan perlindungan data yang berlaku. Foto pihak ketiga harus tetap mengikuti lisensinya. |
| Penjadwalan | Layak untuk rencana 5-6 minggu. | Tahap analisis, desain konseptual, desain fisik, implementasi/konversi, dan uji/pemeliharaan dapat dijadwalkan bertahap. Perubahan aturan bisnis atau akses database dapat memengaruhi jadwal. |
| Operasional | Layak untuk uji coba petugas tunggal setelah pelatihan. | Pengguna memerlukan perangkat dan internet serta pemahaman untuk memasukkan tanggal, tarif, dan pembayaran dengan benar. Prosedur koreksi, pencadangan, akun pengguna, dan dukungan operasional perlu ditentukan sebelum produksi. |

**Kesimpulan kelayakan:** proyek layak dilanjutkan sebagai prototipe dan bahan
demonstrasi sistem informasi akuntansi. Kesimpulan ini bukan persetujuan untuk
penggunaan produksi. Penggunaan data usaha nyata menunggu autentikasi,
pembatasan akses database, prosedur pemulihan data, dan validasi proses oleh
pemilik.

## 4. Desain konseptual

### 4.1 Alternatif dan pilihan

- Pencatatan manual atau lembar kerja mudah dimulai, tetapi status stok,
  tagihan, pengembalian, dan jurnal tetap tersebar dan memerlukan rekonsiliasi
  manual.
- Aplikasi web terintegrasi membutuhkan pengembangan dan pemeliharaan, tetapi
  dapat menyimpan transaksi bersama, menghitung denda, dan menyajikan laporan
  dari sumber data yang sama.

Proyek memilih aplikasi web terintegrasi untuk memenuhi tujuan pembelajaran
HTML, CSS, JavaScript, database, dan pemrosesan akuntansi. GitHub Pages dipakai
untuk frontend demo; Supabase menyediakan PostgreSQL dan fungsi transaksi.
Express tetap tersedia sebagai mode API server lokal.

### 4.2 Alur pencatatan akuntansi

| Peristiwa | Debit | Kredit |
| --- | --- | --- |
| Rental diakui | Piutang Sewa (1120) | Pendapatan Sewa Alat Musik (4100) |
| Pembayaran sewa diterima | Kas (1110) | Piutang Sewa (1120) |
| Denda diakui saat pengembalian | Piutang Denda (1130) | Pendapatan Denda Keterlambatan (4110) |
| Pembayaran denda diterima | Kas (1110) | Piutang Denda (1130) |

Pendapatan yang diakui tidak selalu sama dengan kas yang diterima. Dashboard
dan laporan memisahkan kedua nilai tersebut. Aturan akun dan jurnal perlu
ditinjau oleh dosen atau praktisi akuntansi sebelum dipakai sebagai laporan
resmi.

### 4.3 Arsitektur konseptual

```text
Petugas
  | browser
  v
Frontend HTML/CSS/JavaScript
  +-- GitHub Pages untuk demo
  +-- Supabase client + publishable key
          | HTTPS / PostgREST / RPC
          v
     Supabase PostgreSQL
     +-- tabel transaksi dan jurnal
     +-- fungsi buat_penyewaan
     +-- trigger validasi dan pencatatan

Mode lokal: Browser -> Express API -> Supabase PostgreSQL
Deployment: GitHub Actions -> konfigurasi runtime -> GitHub Pages
```

Konfigurasi deployment membaca `SUPABASE_URL` dan
`SUPABASE_PUBLISHABLE_KEY` dari GitHub Actions secrets untuk membuat berkas
runtime. Frontend tidak menyimpan service-role key.

## 5. Desain fisik

### 5.1 Antarmuka dan input

Antarmuka aplikasi membagi pekerjaan menjadi Ringkasan, Rental & pembayaran,
Pelanggan & inventaris, Jurnal umum, Buku besar, dan Laporan pendapatan.
Formulir menerima identitas pelanggan, pilihan alat, tanggal rental dan
pengembalian, jumlah pembayaran, serta metode pembayaran. Dialog pengelolaan
data master memungkinkan pembaruan pelanggan dan inventaris dengan validasi.
Tarif alat dikunci saat masih disewa. Validasi tanggal, nominal, dan pilihan
alat mencegah sebagian besar input yang tidak sesuai aturan bisnis.

### 5.2 Database

Database menggunakan tabel `pelanggan`, `alat_musik`, `penyewaan`,
`detail_penyewaan`, `pengembalian`, `pembayaran_sewa`, `pembayaran_denda`, dan
`jurnal_akuntansi`. Primary key, foreign key, check constraint, indeks, fungsi,
dan trigger mendukung integritas relasi serta pencatatan transaksi. ERD rinci
tersedia pada bagian **Entity Relationship Diagram (ERD)** di [README](../README.md).

### 5.3 Pengendalian

- Fungsi `buat_penyewaan` mengunci dan memeriksa ketersediaan alat saat
  transaksi dibuat.
- Trigger memvalidasi pengembalian dan pembayaran, memperbarui status, serta
  membentuk jurnal terkait.
- Constraint database membatasi nilai nominal dan status yang diizinkan.
- Repository mengabaikan `.env` dan `frontend/js/config.js`; keduanya tidak
  boleh ditambahkan ke commit.

**Batasan pengendalian demo:** skema saat ini membuka akses role `anon` agar
prototipe tanpa login dapat digunakan. Karena itu, data pada project demo dapat
dibaca atau diubah sesuai kebijakan tabel. Jangan simpan data pelanggan nyata.
Sebelum produksi, terapkan Supabase Auth, kebijakan RLS per pengguna/peran,
aturan backup dan pemulihan, serta tinjau ulang kebijakan akses dan RPC.

## 6. Implementasi dan konversi

### 6.1 Implementasi yang tersedia

- Frontend dinamis pada `frontend/`, API lokal pada `backend/app.js`, dan skema
  database pada `backend/`.
- `backend/schema.sql`, `backend/triggers.sql`, dan `backend/seed.sql` digunakan
  berurutan untuk project database baru.
- Berkas pada `backend/migrations/` digunakan satu kali dan sesuai urutannya
  untuk database yang telah ada.
- Workflow GitHub Actions menjalankan pemeriksaan aplikasi dan deployment
  GitHub Pages. Workflow Pages membangun konfigurasi dari repository secrets.
- Demo aktif di <https://ayugirsang.github.io/RENTAL-MUSIK/>; repository dan
  instruksi deployment ditautkan dari [README](../README.md).

### 6.2 Rencana konversi dan rilis

1. Pastikan project Supabase tujuan benar dan buat cadangan sebelum mengubah
   database yang sudah berisi data.
2. Untuk database baru, jalankan skema, fungsi/trigger, lalu seed sesuai
   petunjuk README. Untuk database lama, tinjau dan jalankan migrasi yang
   diperlukan satu kali; jangan menjalankan migrasi tanpa memeriksa kondisi
   skema dan backup.
3. Atur `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY` di GitHub Actions secrets.
   Jangan mengirim service-role key ke browser, chat, atau commit.
4. Jalankan pemeriksaan lokal, tinjau perubahan, lalu push ke branch `main`
   melalui akun yang memiliki izin.
5. Periksa hasil workflow CI dan Pages. Lakukan uji alur transaksi menggunakan
   data fiktif sebelum menyatakan rilis siap.

### 6.3 Uji penerimaan

| Skenario | Hasil yang diharapkan |
| --- | --- |
| Tambah pelanggan dan alat valid | Data tersimpan dan tampil pada daftar terkait. |
| Ubah data pelanggan atau inventaris | Perubahan tersimpan dan ditampilkan ulang pada daftar terkait. |
| Ubah tarif alat yang sedang disewa | Perubahan ditolak agar perhitungan transaksi yang berjalan tetap konsisten. |
| Buat rental dengan alat tersedia | Nilai rental dan detail tercatat, stok menjadi disewa, dan jurnal pengakuan terbentuk. |
| Pilih alat yang sudah disewa | Transaksi ditolak; status stok dan jurnal tidak berubah. |
| Kembalikan alat terlambat | Hari keterlambatan dan denda dihitung; rental selesai dan alat tersedia kembali. |
| Bayar sewa atau denda sebagian | Kas/jurnal pembayaran tercatat dan sisa tagihan ditampilkan dengan benar. |
| Bayar melebihi sisa tagihan | Pembayaran ditolak oleh validasi database. |
| Buka jurnal, buku besar, dan laporan | Debit/kredit seimbang dan nilai pendapatan dipisahkan dari kas diterima. |
| Konfigurasi Supabase tidak tersedia | Aplikasi menunjukkan kesalahan koneksi, tidak mengklaim penyimpanan berhasil. |

Pemeriksaan otomatis yang tersedia melalui `npm test` memvalidasi sintaks
JavaScript. Pemeriksaan tersebut bukan pengganti uji integrasi Supabase atau uji
penerimaan di atas.

## 7. Operasi dan pemeliharaan

- Pantau workflow GitHub Actions dan pastikan situs serta konfigurasi runtime
  tersedia setelah perubahan.
- Tinjau notifikasi koneksi dan transaksi; selidiki kegagalan database sebelum
  pengguna mengulang transaksi.
- Cadangkan database dan uji pemulihan sebelum migrasi atau perubahan aturan.
- Tinjau ulang tarif, aturan denda, akun, kebijakan akses, dan laporan bersama
  pemilik usaha secara berkala.
- Perbarui dependensi secara terencana dan jalankan `npm test` serta skenario
  penerimaan setelah perubahan.
- Kumpulkan masukan petugas untuk perbaikan antarmuka. Tambahkan autentikasi,
  otorisasi, pencatatan audit, dan pengendalian data sebelum penggunaan nyata.

## 8. Jadwal kerja akademik 5-6 minggu

| Minggu | Tahap | Keluaran |
| --- | --- | --- |
| 1 | Analisis sistem | Permasalahan, kebutuhan pengguna, ruang lingkup, dan studi kelayakan awal. |
| 2 | Desain konseptual | Alternatif solusi, arsitektur, alur rental, dan aturan akuntansi. |
| 3 | Desain fisik | Rancangan UI, ERD, tabel, validasi, kontrol, dan rencana pengujian. |
| 4-5 | Implementasi dan konversi | Frontend, database, integrasi Supabase, konfigurasi deployment, dan pengujian. |
| 6 (opsional) | Operasi dan pemeliharaan awal | Uji penerimaan, perbaikan, dokumentasi, dan persiapan demonstrasi. |

## 9. Bahan laporan dan presentasi

Urutan presentasi yang disarankan: masalah dan tujuan; hasil kelayakan; arsitektur
serta ERD; demonstrasi alur rental hingga pembayaran; jurnal dan perbedaan
pendapatan/kas; hasil pengujian; batasan keamanan demo; serta rencana
pengembangan berikutnya. Anggota kelompok perlu membagi peran penyampaian dan
memahami alur data serta kode yang didemonstrasikan. Identitas anggota dan
hasil wawancara atau biaya aktual harus diisi oleh kelompok, bukan diasumsikan
dalam dokumen ini.
