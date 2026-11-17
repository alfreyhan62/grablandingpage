# Landing Cloner

Tool lokal untuk capture landing page publik yang kamu miliki atau memiliki izin eksplisit untuk disalin. Menyimpan HTML, aset yang termuat, screenshot desktop/mobile, serta ZIP hasil capture.

## Kebutuhan

- Node.js LTS
- Koneksi internet

## Instalasi

```bash
git clone https://github.com/alfreyhan62/grablandingpage.git
cd grablandingpage
npm install
npx playwright install chromium
```

## Menjalankan

```bash
npm start
```

Pilih menu CLI:

1. **Buka dashboard** — membuka `http://localhost:4173` di browser.
2. **Buka folder output** — membuka hasil capture di File Explorer.
3. **Keluar** — menghentikan server.

Masukkan URL `http` atau `https` di dashboard, centang konfirmasi izin, lalu pilih **Capture landing**. Hasil berada di folder `output/` dan dapat dipreview, diunduh sebagai ZIP, atau dihapus dari dashboard.

Untuk menjalankan server tanpa menu CLI:

```bash
npm run web
```

## Pemeriksaan

```bash
npm run check
```

## Catatan

- Hanya HTML publik, aset termuat, dan screenshot yang diambil.
- Backend, login, token, API privat, serta data sesi tidak disalin.
- Gunakan hanya untuk situs milik sendiri atau dengan izin eksplisit.
- Aplikasi berjalan lokal pada `127.0.0.1:4173`; jangan dipublikasikan tanpa pengamanan tambahan.
- `node_modules/`, browser Playwright, dan hasil `output/` tidak disimpan di Git; jalankan instalasi di atas pada setiap komputer baru.
