# TEACO Reservation

Reservasi buka puasa Ramadan 2027, 8 Februari–7 Maret. Kuota 65 tamu per hari, DP Rp20.000/orang. Dark terracotta menjadi tema awal; tombol di header mengubahnya ke light mode.

## Menjalankan lokal

Memerlukan Node.js 24.

```sh
npm install
npm run dev
```

Buka `http://127.0.0.1:4173`. Klik **Admin** dan buat akun pertama untuk pengujian lokal. Tidak ada password bawaan. Atur rekening pembayaran di **Pengaturan** sebelum menerima bukti DP.

Tanpa `DATABASE_URL`, server lokal membuat database SQLite sungguhan di `.data/teaco.sqlite`. File ini bertahan setelah server di-restart dan tidak dimasukkan ke GitHub. Database dimulai kosong: tidak ada booking atau produk menu palsu.

## Yang sudah bekerja

- Kalender berdasarkan reservasi database; hold 15 menit dan validasi kuota dalam transaksi.
- Denah Indoor, AC normal, Outdoor; pilihan beberapa meja/section dan preview alokasi antararea.
- Data tamu, kode reservasi, nominal DP dan kode unik; bukti JPG/PNG/WebP/PDF privat maksimal 2 MB.
- Login admin di server dengan password hash scrypt, sesi HttpOnly dan pembatasan percobaan login.
- Dashboard jumlah booking terkonfirmasi, tamu booked, verifikasi DP, uang diterima dan breakdown area.
- Daftar reservasi dengan pencarian serta filter tanggal/status; validasi atau penolakan bukti DP.
- Pengecekan reservasi melalui kode + nomor WhatsApp.
- Sinkronisasi produk dari API kasir; input menu oleh admin hanya setelah DP dikonfirmasi.
- Finalisasi menu menyimpan item dan mengirim draft jika endpoint kasir sudah dikonfigurasi. Tanpa endpoint, UI menyatakan draft belum terkirim.

## Database online di Vercel

SQLite lokal **tidak** dipakai di Vercel. Hubungkan PostgreSQL (misalnya Neon melalui Vercel Storage) lalu isi environment variable proyek:

- `DATABASE_URL`: connection string PostgreSQL.
- `ADMIN_USERNAME` dan `ADMIN_PASSWORD`: akun admin pertama; password minimal 10 karakter. Hapus `ADMIN_PASSWORD` dari environment setelah akun dibuat.
- `POS_MENU_URL`, `POS_DRAFT_URL`, `POS_API_TOKEN`: adaptor aplikasi kasir, jika sudah tersedia.

Schema dan data konfigurasi event diinisialisasi secara idempoten dari `server/schema.sql`. Tidak ada seed transaksi, data tamu, rekening atau menu. Tanpa database online, kalender tidak mengarang ketersediaan dan admin tidak menawarkan login palsu. Redeploy sesudah mengatur environment variable.

Lihat [struktur database](docs/DATABASE.md) dan [kontrak integrasi kasir](docs/POS-INTEGRATION.md).

## Verifikasi

```sh
npm run build
npm test
```

Pengujian menggunakan SQLite terisolasi di memori; tidak mengubah database lokal maupun production.

## Belum disambungkan

Database PostgreSQL production, API kasir dan Hermes/WhatsApp memerlukan akun/kredensial milik pengelola. QRIS, override AC eksklusif 20 tamu, mode split Bawah TV, pindah tanggal dan check-in dari dokumen flow belum diimplementasikan pada revisi ini. Deadline pembayaran saat ini maksimal 24 jam atau waktu kunjungan, bukan seluruh matriks adaptif pada dokumen.
