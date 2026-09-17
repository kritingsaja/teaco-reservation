# Kontrak integrasi aplikasi kasir

Tujuan integrasi ini adalah membuat **draft order** di aplikasi kasir setelah menu reservasi telah final. Integrasi tidak boleh membuat transaksi lunas atau mengurangi stok tanpa validasi dari kasir.

## Trigger yang direkomendasikan

1. Reservasi berubah ke `MENU_SELECTED`.
2. Sistem reservasi mengirim payload ke endpoint adaptor kasir.
3. Adaptor melakukan mapping menu TEACO ke `product_id` kasir dan membuat/menyegarkan draft dengan `external_reference = reservation_code`.
4. Kasir membalas ID draft. Respons disimpan agar request berikutnya idempoten.

## Payload HTTP yang disarankan

```json
{
  "external_reference": "TEACO-8FEB-0042",
  "visit_date": "2027-02-08",
  "customer": { "name": "Budi", "phone": "08123456789" },
  "party_size": 10,
  "seating": { "zone": "Indoor", "section": "Meja 12" },
  "items": [
    { "menu_code": "NASI-GORENG", "quantity": 6, "note": "Pedas level 2" },
    { "menu_code": "ES-TEH", "quantity": 10, "note": "Less sugar" }
  ],
  "source_status": "MENU_SELECTED"
}
```

## Fallback berkas

Jika kasir belum menyediakan endpoint, ekspor berkas UTF-8 `.txt` menjadi jalur awal:

```text
KODE|TANGGAL|NAMA|HP|JUMLAH|ZONA|SECTION|MENU|CATATAN|STATUS
TEACO-8FEB-0042|2027-02-08|Budi|08123456789|10|Indoor|Meja 12|Nasi Goreng;Es Teh|Pedas level 2;Less sugar|MENU_SELECTED
```

## Yang diperlukan dari repositori kasir

- URL repositori atau akses kolaborator.
- Cara kasir membuat draft order (API, database, atau import).
- Daftar ID/SKU produk yang dipetakan dengan menu TEACO.
- Mekanisme autentikasi untuk endpoint internal.
- Aturan jika menu direvisi, reservasi dibatalkan, atau date-change terjadi.

Dengan informasi itu, adaptor dapat dibuat idempoten memakai `external_reference`, sehingga ekspor ulang tidak menggandakan draft.
