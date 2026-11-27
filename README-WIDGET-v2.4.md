# KuCoin Radar v2.4 — Widget Android + Radar Live

**Integrasi berdasarkan backup `KuCoin_Radar_v2_3_NO_TRADE_Full_Backup.zip`**, bukan bina semula website. Pelan ini mengekalkan `lib/market-risk-gate.js`, `lib/telegram-alerts.js`, `public/journal*.js`, folder `paperlab/` dan skrip chart. Tiada token/secret dalam kod widget.

## Komponen baharu

- `/live/`: halaman PWA berasingan, boleh dipasang ke Home Screen sebagai **Radar Live** dengan `display: fullscreen`.
- `/api/widget/summary`: data baca-sahaja. Ringkasan risiko, masa kemas kini, 3 coin untuk pemerhatian. Tidak hantar order.
- `public/index.html`: pautan `📱 Radar Live`, tanpa mengubah borang journal.
- `public/sw.js`: cache aset statik sahaja. API LIVE tidak pernah dicache. Laluan offline `/` dan `/live/` diasingkan.
- **Projek Android Studio berasingan** `KuCoinRadarWidget` untuk widget native Home Screen dengan refresh lebih kurang 15 minit + manual, menggunakan WorkManager. Projek Android tidak perlu di-upload ke Render.

## Pasang website (Render sekarang; boleh pindah Oracle kemudian)

1. Pada website lama, backup Trading Journal JSON / PaperLab terlebih dahulu.
2. Download `KuCoin_Radar_v2_4_Widget_RadarLive_GitHub_Update.zip`, extract, upload **kandungan fail/folder** ke GitHub `fadhliroslan89/signals` root. Jangan upload zip sebagai fail tunggal. Pastikan laluan `public/live/index.html` dan `lib/widget-summary.js` wujud.
3. Commit. Render yang dikonfigurasi Auto Deploy akan redeploy. Jangan ganti `render.yaml` atau fail env rahsia.
4. Selepas LIVE, buka `https://signals-ax4g.onrender.com/live/` dan `https://signals-ax4g.onrender.com/api/widget/summary` untuk pastikan laluan baru.
5. Pada Android Chrome, buka `/live/`, Chrome ⋮ → Add to Home screen / Install app → pasang **Radar Live**. Pilih `⛶ Skrin Penuh` atau gunakan mod skrin penuh PWA; tekan `☀ Skrin ON` bila mahu paparan tidak padam sewaktu app di hadapan. Ia tidak boleh memaksa paparan ketika telefon dikunci, dan mungkin menggunakan lebih bateri.

## Widget native Android

Lihat `README-ANDROID.md` dalam ZIP sumber Android. Sumber belum menjadi APK dan tidak dikompilasi di sini kerana Android SDK tiada. Pada MacBook buka folder `KuCoinRadarWidget` dalam Android Studio, pasang SDK API 35 jika diminta, Gradle Sync, Build APK, pindahkan APK ke telefon, kemudian Home Screen → Widgets → KuCoin Radar Widget.

Aplikasi widget boleh tukar domain dalam tetapan; gunakan URL Oracle HTTPS selepas migrasi. Widget menyembunyikan coin jika data API lebih 90 saat atau server offline.

## Had utama

- Widget home screen **bukan real-time 20 saat**. Android WorkManager periodic minimum 15 minit dan sistem boleh menundakannya. Tekan ↻ untuk refresh secara manual.
- Paparan Radar Live menyemak sekitar **20 saat hanya ketika aktif/kelihatan**. Ia tidak menjamin browser berjalan ketika skrin dikunci.
- Monitoring/Telegram 24 jam bergantung kepada **server Oracle/Render yang aktif**, bukan widget. Server Free boleh tidur.
- Risk Gate NO TRADE dan BUY alert Telegram PAUSED tidak diubah.
- Journal/Cloud PaperLab yang bergantung kepada origin tidak akan automatik berpindah domain Render→Oracle; eksport/import atau pindah rekod mengikut aturan asal.
- **Tiada auto-order, tiada jaminan profit.**

## Ujian projek

Dijalankan `npm test` di bawah Node.js 22: 107/107 test passed. Endpoint `/api/widget/summary`, `/live/` dan manifest berjaya menjawab HTTP 200 menggunakan `MOCK_KUCOIN=1`, bukan data LIVE KuCoin.
