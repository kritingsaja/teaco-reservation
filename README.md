# TEACO Reservation

Prototipe web untuk reservasi buka puasa TEACO Ramadan 2027. Tampilannya dibuat ringkas dan bertahap: kalender → jumlah tamu → tempat duduk → DP → konfirmasi admin → menu dari kasir.

## Yang sudah tersedia

- Halaman pertama berupa kalender 28 hari dengan jumlah kursi tersisa per tanggal.
- Popup jumlah tamu setelah tanggal dipilih, kemudian denah tempat duduk pada layar berikutnya.
- Ringkasan DP dan unggahan bukti pada layar terpisah.
- Panel admin sederhana untuk konfirmasi DP dan mengambil daftar menu dari kasir.
- Kontrak integrasi kasir agar menu dan draft order dapat dihubungkan pada backend nanti.

## Batas prototipe

Proyek ini belum menyimpan reservasi sungguhan, tidak mengunggah bukti transfer, belum ada login admin, dan belum mengirim WhatsApp. Fitur tersebut perlu backend/database serta kredensial dari Hermes dan aplikasi kasir.

Lihat [dokumen integrasi kasir](docs/POS-INTEGRATION.md) untuk kontrak yang diperlukan agar export otomatis menjadi draft pada aplikasi kasir.

