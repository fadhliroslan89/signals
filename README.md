# KuCoin Scalping Radar — Website (Node.js 20+)

Website responsif untuk **telefon dan MacBook**, tanpa langganan TradingView. Mengimbas **semua pair spot USDT yang masih aktif di KuCoin** menggunakan API awam. Tiada API key trading atau integrasi beli/jual.

## Apa yang disediakan

- Data semasa: harga terakhir, **volume 24 jam dalam USDT**, bid–ask spread dan perubahan harga 5m/15m/30m.
- Sejarah: satu permintaan **candle 1 minit per pair** semasa mula dijalankan (proses bootstrap berperingkat; semua coin diimbas). Selepas itu harga disimpan daripada **allTickers** setiap 20 saat.
- Ranking: score 0–100 berdasarkan momentum, volume dan spread. **Score BUKAN kebarangkalian profit.**
- Status **BUY / WATCH / AVOID / DATA** berdasarkan penapis; BUY tidak bermaksud harga pasti naik.
- Carian coin, filter BUY/WATCH/favorit, penapisan volume/spread, susunan ranking, detail coin dengan carta dan sasaran TP/SL ilustrasi.
- Notifikasi browser jika halaman **sedang terbuka** dan kebenaran diberikan; optional **Telegram** daripada server walaupun halaman ditutup (server mesti sentiasa hidup).
- Kedua-dua paparan telefon dan MacBook melalui alamat URL yang sama bila website dideploy.

## Jalankan pada MacBook (percuma)

1. Pasang Node.js **20 atau lebih baru** daripada https://nodejs.org/ jika belum ada.
2. Ekstrak ZIP ini ke folder, buka aplikasi **Terminal** dan masuk ke folder projek:

   ```bash
   cd ~/Downloads/kucoin-scalping-radar
   npm start
   ```

3. Di MacBook buka **http://localhost:3000**.
4. Untuk buka dari telefon pada **Wi-Fi yang sama**: cari IP MacBook dalam **System Settings → Wi-Fi → Details → TCP/IP**, kemudian buka `http://IP-MACBOOK:3000` di browser telefon. Benarkan sambungan rangkaian jika macOS bertanya. Ini bekerja hanya semasa MacBook hidup dan kedua-duanya dalam rangkaian yang sama.
5. Notification API dalam browser memerlukan **HTTPS** atau `localhost`. Telefon yang mengakses `http://IP-MACBOOK:3000` mungkin tidak boleh mengaktifkan browser notification; gunakan hosting HTTPS atau Telegram.

**Tiada `npm install` diperlukan** — projek ini tidak mempunyai package dependency selain Node.js standard.

## Cara paling mudah deploy ke Render (MacBook dan telefon, HTTPS)

Pakej ini disediakan untuk **Render Free Web Service** dan **rantau Singapore** dalam `render.yaml`. Hosting belum disediakan pada akaun pengguna.

1. Ekstrak ZIP, buka folder `kucoin-scalping-radar`.
2. Log masuk https://github.com/new dan buat repository, contoh `kucoin-scalping-radar` (Public untuk mudah bermula, atau Private jika disambungkan kepada Render). Jangan masukkan apa-apa token API/Telegram ke GitHub.
3. Buka repository yang kosong, pilih **uploading an existing file** / **Add file → Upload files**. Seret **semua fail dan folder DI DALAM** `kucoin-scalping-radar`, bukan ZIP. Pastikan `package.json`, `server.js`, `render.yaml` dan folder `public`, `lib`, `test` berada di akar (root) repository. Commit changes.
4. Buka https://dashboard.render.com/ → **New → Blueprint**. Sambungkan GitHub, pilih repository tadi, Render membaca `render.yaml`; semak `plan: free` dan `region: singapore`, kemudian **Apply**. (Alternatif: **New → Web Service**, pilih repo, pilih Free, Singapore, `npm install --omit=dev` dan `npm start`.)
5. Tunggu status **Live**, kemudian buka URL seperti `https://kucoin-scalping-radar-xxxx.onrender.com` (URL sebenar diberi oleh Render; `xxxx` hanya contoh). Di `/api/status`, pastikan `mock:false`, dan tunggu sejarah coin siap dimuatkan sebelum bertindak terhadap signal.
6. Di telefon, buka URL HTTPS sama dan pilih **Add to Home Screen** pada Safari/Chrome. Browser notification memerlukan kebenaran dan bergantung kepada sokongan browser/peranti.
7. Untuk Telegram: Render → service → Environment → tambah `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` secara rahsia; Save/Deploy. Jangan letak token dalam repo.

**Had Free:** Render akan 'spin down' selepas 15 minit tanpa trafik masuk. Telegram tidak dipantau ketika server tidur; restart dan warm-up data sejarah selepas kembali hidup. Untuk alert yang benar-benar sentiasa berjalan, pilih hosting/instance *always-on* (biasanya berbayar). Render boleh menetapkan had penggunaan/kuota percuma dan kos jika akaun ada kaedah bayaran, semak Billing.

**Perlindungan:** Website bersifat umum (tiada login). Jangan siarkan token Telegram atau API key trading dalam fail website, screenshot log atau GitHub.

## Jadikan website boleh dibuka dari mana-mana

Hosting memerlukan pelayan yang boleh menjalankan **Node.js secara berterusan**, contohnya Render Web Service, Railway atau VPS. Muat naik kandungan projek ke repositori GitHub kemudian pilih **New Web Service** di hosting. Konfigurasi `Build Command` kosong / `npm install`, `Start Command` `npm start`, Node 20+, dan biarkan hosting menetapkan `PORT`. Domain HTTPS yang diberi hosting membolehkan telefon dan MacBook membuka laman yang sama.

> **Nota:** Projek belum dideploy; ZIP ini kod website, **bukan URL website yang sudah live**. Host yang tidur selepas tidak digunakan akan mengganggu scanner/alert; untuk Telegram 24/7 perlukan host sentiasa hidup.

## Alert Telegram opsyenal (24/7 jika server hidup)

1. Di Telegram, mesej **@BotFather**, cipta bot dan salin token. Hantar mesej kepada bot milik sendiri; dapatkan `chat_id` menggunakan kaedah rasmi Telegram.
2. Pada hosting, set environment variables **TELEGRAM_BOT_TOKEN** dan **TELEGRAM_CHAT_ID** (jangan masukkan dalam fail HTML/JS dan jangan commit token ke GitHub).
3. Restart server. Bila status bertukar atau melepasi cooldown 15 minit untuk pair BUY berdasarkan **penapis lalai server**, Telegram akan terima mesej.

**Penting:** Filter yang kau ubah pada dashboard (volume, spread, momentum 15m) hanya mengubah penapisan dan browser notification pada peranti itu. Telegram menggunakan penapis standard server: minimum $5 juta 24j, spread maksimum 0.30%, momentum 15m >=1.10%, 30m >=1.80%, 5m >=0.20%, dan momentum 15m lebih kuat daripada 15m sebelumnya. Tidak ada button untuk order trading. Tiada alert Telegram dalam mod DEMO.

## Cara kira & had teknikal

- Pasangan aktif: `/api/v2/symbols` dengan `quoteCurrency=USDT`, `enableTrading=true`, bukan `st` atau call auction.
- Harga, volume dan bid-ask: `/api/v1/market/allTickers`, setiap 20s. Spread = `(ask−bid) ÷ midpoint ×100`.
- Momentum 5m/15m/30m = `(lastPrice ÷ historicalPrice − 1) ×100`. Harga sejarah diambil daripada penutupan candle 1m atau snapshot terdekat **tidak lebih lewat daripada waktu sasaran**, maksimum tertinggal 3 minit. Jika sejarah tiada, label `DATA` bukan `BUY`.
- Bootstrap perlahan untuk elak rate limit KuCoin. Untuk banyak pair boleh mengambil **beberapa minit**. Setelah bootstrap, data snapshot terkini menggantikan keperluan kline request berulang (KuCoin menyatakan kline tidak sesuai untuk polling terlalu kerap).
- Skor 0–100 ialah **heuristik teknikal** (momentum + spread + volume) yang belum dibacktest. Ia bukan peluang 3.5% atau kadar menang.
- Harga tick KuCoin dan candle mungkin tidak aktif setiap minit bagi pair tidak cair. Harga sejarah tidak semestinya mewakili masa yang tepat saat itu.
- Host/server mati, internet terputus, API error/429 → scanner boleh lapuk; UI menandakan status sambungan / ralat. Browser notification tidak dijamin berjalan semasa tab tertutup.
- 3–4% dalam 15–30 minit **sangat agresif** tanpa leverage; pertimbangkan risiko spread, slippage, trading fee, order-book depth dan drawdown. Paper-trade dahulu.

## Ujian tempatan tanpa akses KuCoin

```bash
npm test
npm run demo
```

Buka `http://localhost:3000`: `DEMO DATA` jelas dipaparkan. Mod demo memaparkan *data sintetik* untuk pembangunan sahaja — **JANGAN digunakan untuk trade**.

## API rujukan

- https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-all-tickers/
- https://www.kucoin.com/en-au/docs-new/rest/spot-trading/market-data/get-all-symbols
- https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-klines

**Nota keselamatan:** Ini alat maklumat, bukan nasihat kewangan atau bot trading automatik.


## v1.2 — Top 10 Coin Momentum

Panel di bawah metrik pasaran memilih sehingga 10 pair untuk dipantau, **walaupun tiada BUY**. Syarat: data lengkap 5/15/30 minit, momentum 15 dan 30 minit positif, momentum 5 minit tidak lebih rendah daripada -0.30%, volume 24j dan spread lulus filter pengguna. Ranking mengikut skor saringan, momentum 15 minit dan volume. Panel tidak melonggarkan syarat alert BUY asal.

Apabila data API lapuk melebihi 90 saat atau bermasalah, Top 10 tidak dipaparkan sebagai ranking LIVE. Filter Market Radar mempengaruhi Top 10 dengan serta-merta. Fail tambahan `public/top10.js`.


## v1.3 (Oct 2026)

- New 1m and 10m public price-return fields (via `lib/scanner.js`); 5m acceleration compares most recent 5m against previous 5m using compounded returns.
- EARLY WATCH label and opt-in browser notifications for *new* near-BUY conditions within Top 10; separate from existing BUY criteria. Alert requires both browser notification and early-switch enabled, website open, and fresh/live data. Cooldown 15 min per symbol persists in browser localStorage.
- Modal entry/TP/SL calculator with budget, buy/sell fees and estimated slippage, net TP/SL and break-even; estimates, never executes trades.
- JavaScript tests: `npm test`.

Deploy incremental update: copy only updated folders `public/` and `lib/` from the GitHub Update ZIP into repository root, Commit, let Render Auto-Deploy. Do not upload Telegram secrets.

- Ranking score now adjusts −17 to +10 points for short-term deceleration/acceleration consistently in both backend/frontend; BUY threshold rules are unchanged.

## v1.4 Breakout Hunter (2026-10-21)

Laman ada panel BREAKOUT HUNTER di antara Top 10 Momentum dan Market Radar. Data semua pair USDT pada ticker tetap diproses untuk scanner momentum, tetapi kiraan candle lengkap + spike volume yang segar dibuat hanya bagi sehingga **30 pair** yang dipilih daripada kecairan, spread dan momentum semasa; tidak semua 787 pair menjalani ujian OHLCV secara serentak. Setiap ~75s pelayan mengambil candle baru melalui API KuCoin untuk pair tersebut. Semasa bootstrap pertama sedang berjalan, panel menunggu.

- `BREAKOUT 1M`: **candle 1 minit lengkap** ditutup atas high 12 candle terdahulu; volume candle sekurang-kurangnya 1.8× purata 20 candle.
- `BREAKOUT 5M`: **candle 5 minit lengkap** ditutup atas high enam candle 5min terdahulu; volume 5m sekurang-kurangnya 1.4× purata enam candle 5m.
- `SETUP`: harga menghampiri high 1m, disertai beberapa tanda aktiviti volume; bukan BUY.
- `NONE`/`DATA`/`GAP`/`STALE`: tiada bukti segar dan lengkap untuk memberi isyarat.

Data candle adalah OHLCV KuCoin yang sah dan berurutan. Ketika tidak cukup candle, terdapat jurang, volume asas 0, atau data lapuk, label breakout tidak dikeluarkan. Ambil perhatian bahawa apabila data tidak menepati syarat, panel boleh kosong — ini normal. Breakout bukan signal BUY, bukan bukti potensi untung 3–4%, dan bukan order secara automatik. Active browser notifications perlukan HTTPS + browser terbuka, bukan 24 jam pada Render Free.

## v1.5 — Trading Journal (browser-local)

From **Top 10 Momentum** and **Breakout Hunter**, click **+ Pantau Trade** to open a manual position form. This does not place an exchange order. Use **PAPER** for simulations, or **REAL** only after actually trading on KuCoin. Entry includes a user-defined fee per side (0.1% default). Quantity can be entered from actual fills; when left blank it is estimated from the entered budget, including buy fees.

Open journal positions refresh unrealized estimated P&L from fresh KuCoin **bid** prices when available; exchange trades are never automatically closed. After executing a sell manually, record the actual price, time and reason using **Tutup / Rekod Exit**. Only closed trades contribute to realized net P&L and win-rate figures. A breakeven close is counted in closed trades but not a win or loss. Real and paper stats are segregated.

**Storage and privacy:** The journal is saved exclusively in browser `localStorage`, not in Render, GitHub, or KuCoin. Entries do not automatically sync across devices. Use **Backup JSON** and **Import JSON** to move or recover trades. CSV export supports Excel/Sheets. Browser clearing/private mode/device loss can permanently erase records without backup. The journal has no broker connection, account-level verification, secure login or multi-device sync. Do not use it as your only accounting record.

## v1.7 — Intraday Hit & Run (selepas Trading Journal)

Panel intraday baharu diletakkan **di bawah Trading Journal dan sebelum Market Radar**.
Ia menyenaraikan KuCoin Spot USDT yang telah meningkat sekurang-kurangnya **10% dalam 24 jam**, mencapai volume 24 jam **≥10 juta USDT** dan spread **≤0.30%** secara default. Pengguna boleh menetapkan ambang +10/+15/+20%, volume ≥5/10/25/50 juta dan menyusun berdasarkan momentum terkini, volume atau kenaikan harian.

Momentum 1m/5m/15m digunakan untuk membezakan `MEMECUT`, `PANTAU`, `PULLBACK`, `TERLALU PANAS`, `DATA`. Penyenaraian +10% ialah **kenaikan lalu**, bukan ramalan, peluang untung atau isyarat BUY. Modul menapis stablecoin dan token leverage lazim, serta tidak memaparkan baris ticker semasa API lapuk. Sejarah intraday boleh lambat tersedia selepas Render dihidupkan semula. Setiap kad mempunyai butang `+ Pantau Trade` yang merekod posisi secara manual ke journal browser sedia ada tanpa membuat transaksi KuCoin.
