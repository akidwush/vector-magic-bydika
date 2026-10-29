# Audit NEXORA — 29 Oktober 2026

Audit ini menemukan bahwa kekurangan kualitas terbesar tetap berada pada
**region/segmentasi dan konsistensi batas setelah komposisi**. Memperbanyak
iterasi Bézier atau menurunkan jumlah node secara global tidak memperbaiki
bentuk yang sudah hilang sebelumnya.

Perbaikan langsung dalam audit ini menutup kegagalan lifecycle Worker dan
cleanup decode, serta memperluas cakupan CI. Tidak ada algoritma geometri,
palet, source-drift allowance atau toleransi historis yang diubah. Riset
Watershed dan thin-feature tetap eksperimental; hasil PARTIAL sebelumnya tidak
dianggap selesai oleh patch ini.

## 1. Sumber dan cakupan

- Checkout awal: `30bf123e9ce9838efd57bf1135c6216d99357201`, akhir Stage 1.7C.
- `main` yang benar-benar di-fetch saat audit:
  `69b06ef8383b729223040a1282cd10809eb172f1` — merge riset sampai 1.6F.
- Branch kerja baru: `feat/audit-runtime-reliability`. Tidak merge ke `main`.
- Commit implementasi:
  `e811ca75898c54ea77b8b24efd41e547540016a9`.
- `src/engine/client.ts` dan `src/lib/input.ts` pada checkout awal sama dengan
  kedua file pada `main` tersebut. Temuan lifecycle berlaku pada kode bersama,
  bukan hanya kode eksperimen Stage 1.7C.
- Masukan pengguna: `audit_static_vector_magic_v115.md`, SHA256
  `3c4090c216b9d6fbec2930c63d33e198f3bb06baaa3679ec2bb59bf77749ec16`.
  Yang diperiksa di sini adalah dokumen itu; binary `vmde.exe` tidak dijalankan
  atau dianalisis ulang, dan tidak dimasukkan ke repositori.

Audit membaca instruksi repositori, pipeline Rust, coverage/source fitting,
compositor, Worker/client, decode, validasi SVG, UI, konfigurasi CI, laporan
1.7A–C, dan pengujian terkait. Temuan arsitektur dibedakan dari temuan yang
direproduksi dengan fault injection, ekspor nyata, atau pengujian native.

## 2. Apa yang dapat dipelajari dari lampiran

Pipeline indikatif dalam laporan Vector Magic masuk akal sebagai pembanding
arsitektur: klasifikasi → palet → segmentasi → kontur → fitting → ekspor.
NEXORA sudah mempunyai sebagian besar tahapan itu melalui VTracer,
visioncortex, flo_curves dan lapisan source fitting sendiri. Kekurangannya
bukan sekadar tidak mempunyai nama tahap yang sama.

| Petunjuk lampiran | Penilaian untuk NEXORA |
| --- | --- |
| Segmentasi dan subpixel mendahului fitting | Relevan; kehilangan region terukur terjadi sebelum Bézier. Prioritas utama tetap region survival. |
| LAPACK/ANN dan nama optimizer muncul | Tidak membuktikan algoritma proprietari atau bahwa menambah library tersebut akan meningkatkan hasil kita. Tidak ditambahkan dependency baru. |
| Sepuluh blok konfigurasi dengan angka berbeda | Profil aktif, unit dan tujuan tidak diketahui. Angka tidak disalin menjadi toleransi NEXORA. |
| Tiga mode shape pada UI Vector Magic | NEXORA mempunyai stacked/Mosaic secara internal, tetapi belum menyediakan tiga semantik ekspor yang independen dan tervalidasi. |
| Pengaturan nodes/smoothness | Kontrol tambahan perlu batas error dan perlindungan detail. Checkbox node optimization yang sudah ada bukan bukti kualitas universal. |
| Nama file/thread dalam binary | Bukti nama yang tertanam, bukan akses source, benchmark keluaran, atau bukti representasi shared-edge internal. |

Belum ada keluaran Vector Magic berlisensi dengan input/settings sepadan dalam
audit ini. Tidak ada klaim kesetaraan atau pemulihan original vector yang pasti.

## 3. Temuan berdasarkan prioritas

### A1 — Tinggi: region dan negative space hilang sebelum fitting

Pada pale garden, diagnostik source-only yang dipertahankan dari Stage 1.7C
menunjukkan source 12 foreground components / 12 negative spaces, cut Watershed
14 region tetapi hanya 3 foreground / 0 negative spaces, lalu Mosaic 13 owned
region → 4 paint dan 2 foreground / 0 negative spaces. Ini bukan satu ukuran
yang sama: jumlah region tidak sama dengan jumlah objek terlihat.

SVG akhir masih memiliki IoU foreground sekitar 0.626865 dan libvips RGBA MAE
5.293861. Kurva yang lebih halus tidak bisa membangun kembali region tersebut
tanpa bukti/ownership yang benar. Stage 1.7B hanya membuktikan subset gap
ColorCluster; Stage 1.7C hanya menerima pemulihan bar botanical 128. Pale garden
belum diperbaiki. Bukti dan batas penerimaannya tetap di
[laporan 1.7C](STAGE_01_7C_WATERSHED_REGION_RECOVERY_REPORT.md).

**Belum diperbaiki dalam audit ini.** Dibutuhkan intervensi region tersendiri
dengan evaluasi paint lokal, kompleksitas dan topology; bukan pelonggaran speckle,
detail Watershed global, atau toleransi Bézier.

### A2 — Tinggi: canonical shared edges tidak dijamin pada semua route Auto

Route locked planar mempunyai shared cache dan reuse reversal. Akan tetapi,
`engine/src/lib.rs` masih memanggil `coverage::refine` untuk `source-blend`, dan
`coverage.rs` melakukan update per-subpath. Sesudahnya `refine_mosaic` hanya
menangani ring terisolasi yang berhasil dipasangkan, bukan seluruh junction
dan chain pada dokumen.

Artinya, graph yang canonical saat komposisi belum menjamin semua face tetap
canonical setelah tahap berikutnya. Guard Stage 1.7C menolak kandidat pale
garden dengan `FINAL_SHARED_EDGE_MISMATCH`. Ketidakcocokan atom bukan bukti
bahwa setiap atom menciptakan celah terlihat—subdivision yang ekuivalen juga
bisa gagal pada guard konservatif. Seams antialias renderer juga harus tetap
dibedakan dari celah geometri.

**Belum diperbaiki dalam audit ini.** Mengganti route atau mematikan refinement
secara global tanpa pengukuran dapat merusak hasil yang sudah benar. Ini
merupakan target arsitektur berikutnya, dengan graph ownership tetap tunggal.

### A3 — Tinggi: detail preservation dan noise belum terpisah dengan baik

Corpus sebelumnya mencatat clean anime 512 sebanyak 32 path / 965 anchor,
sedangkan versi WebP menjadi 692 / 5810. Compressed fox dan noisy garden juga
tetap terfragmentasi. Sebaliknya, glyph counters dan garis tipis nyata bisa
hilang. Melestarikan semua region kecil akan memperburuk masalah noise.

**Belum diperbaiki dalam audit ini.** Kebijakan harus memakai coherent support,
ownership dan source paint, dengan negative controls codec. Data Stage 1.7A–C
dipakai sebagai bukti historis, bukan diakui sebagai benchmark kualitas baru.

### A4 — Tinggi: kegagalan transport Worker dapat menggantung atau meninggalkan state

Pada implementasi awal:

- `messageerror` tidak ditangani; Promise konversi bisa tetap pending.
- `new Worker` / `postMessage` yang throw melewati cleanup normal. Transfer
  yang gagal dapat meninggalkan Worker tersimpan dan reject state tidak konsisten.
- Balasan duplikat dengan ID yang sama memasang dua idle timer. Timer pertama
  bisa membatalkan pekerjaan baru walaupun timer terakhir telah dihapus.

**Diperbaiki.** Satu hasil hanya boleh menyelesaikan satu request; error start,
send dan receive dinormalisasi menjadi `WORKER`, instance gagal diterminasi,
dan konversi berikutnya memakai instance baru. Error saat Worker idle juga
mematikan instance itu tanpa mengubah Promise yang sudah selesai. Stale callback
tetap ditolak berdasarkan generation dan identitas Worker.

Tes browser mengungkap detail tambahan pada Chromium 154.0.8037.57:
`onmessageerror` tidak tersedia sebagai handler property. Probe terpisah
memberi `propertyExists=false`, callback property 0 kali, callback
`addEventListener` 1 kali. Implementasi final memakai event listener, melepas
listener lama saat reuse/cancel, dan tidak menumpuk listener per-konversi.

Ini perbaikan transport/lifecycle. Bukan bukti penyebab episode CPU 10 detik
Stage 1.6H–J sudah ditemukan atau diperbaiki.

### A5 — Sedang: decode Canvas tidak dikosongkan pada jalur error

`ImageBitmap.close()` sudah berada dalam `finally`, tetapi Canvas hanya di-reset
pada jalur sukses. Jika `getContext`, `drawImage` atau `getImageData` gagal,
ukuran backing Canvas bertahan sampai pengelolaan memori browser berikutnya.

**Diperbaiki.** Reset Canvas ke 0×0 berada dalam `finally`. Bitmap tetap
ditutup dan error asli diteruskan. Posisi pengukuran `decodeMs` tetap setelah
cleanup seperti sebelumnya. Tes unit serta browser memeriksa ukuran 0×0 dan
panggilan close, bukan mengklaim pengukuran penurunan RSS Android.

### A6 — Tinggi: cakupan CI berbasis daftar branch tertinggal

Workflow validasi normal hanya mencantumkan branch sampai 1.6J secara eksplisit.
Branch 1.7A/B/C mempunyai workflow riset sendiri, tetapi push branch baru tidak
otomatis menerima seluruh rangkaian validasi produksi itu.

**Diperbaiki.** Trigger push sekarang `main` dan `feat/**`; pull-request trigger
tetap ada. Kondisi job riset dan semua threshold historis tidak dilonggarkan.
Log validasi lengkap ikut dipertahankan sebagai artifact. Runner Stage 1.7C
menambah annotation kegagalan ter-escape agar subcommand dan potongan error
dapat dibaca tanpa bergantung pada akses detailed job log.

Pemeriksaan publik pada 29 Oktober mengonfirmasi run Stage 1.7C
[40610070364](https://github.com/akidwush/vector-magic-bydika/actions/runs/40610070364)
dan [40621689370](https://github.com/akidwush/vector-magic-bydika/actions/runs/40621689370)
keduanya **FAIL**. Status pending dalam laporan terdahulu merupakan observasi
saat itu, bukan hasil akhir. Annotation publik hanya menyebut exit 1; penyebab
seluruh kegagalan remote belum dapat diverifikasi dari log yang dapat diakses.
Keduanya tidak dinyatakan lulus karena suite lokal lulus.

### A7 — Sedang: semantik ekspor belum dipisahkan dari route tracing

Stacked, Mosaic/cutout dan grouping warna bukan sekadar tiga label UI. Grouping
shape dengan fill sama dapat mengubah occlusion jika dilakukan melintasi layer.
Raster negative space juga tidak selalu identik dengan compound-path hole.
Belum ada tiga kontrol ekspor independen dengan matriks alpha/topology/overlap
yang sepadan dengan lampiran. Tidak ditambahkan checkbox kosmetik pada audit ini.

### A8 — Sedang: readiness dan keputusan distribusi masih terbuka

README diberi index audit/status baru agar perbaikan riset tidak disalahartikan
sebagai fitur Auto yang aktif. Dokumentasi yang ada menyatakan lisensi kode
asli NEXORA belum dipilih; lisensi upstream dan CC0 fixture bukan lisensi aplikasi.
Pemilihan lisensi kode asli memerlukan keputusan pemilik, bukan dipilih diam-diam.

Alpha kontinu, Photo, edit GUI/Illustrator dan physical Android belum mendapat
bukti lengkap. Browser mobile emulation dan Inkscape CLI bukan pengganti bukti itu.
Merge source riset juga tidak berarti feature aktif: misalnya hasil Triangle 128
sekitar 0.410 px berasal dari build opt-in `large_apex`, bukan janji hasil normal
Auto atau ekuivalen dari checkbox refinement yang berbeda.

## 4. Implementasi yang diselesaikan

| File | Perubahan |
| --- | --- |
| `src/engine/client.ts` | Single settlement, cleanup create/send/receive failure, event-based messageerror, idle-failed Worker retirement, bounded listener reuse |
| `src/lib/input.ts` | Canvas reset dalam finally, Bitmap close dan timing boundary dipertahankan |
| `tests/unit/client-failures.test.ts` | Fault startup/transfer/receive, obsolete callback, duplicate timer, idle failure/retry |
| `tests/unit/decode-cleanup.test.ts` | Tiga jalur error decode, resource cleanup |
| `tests/unit/core.test.ts` | Mock Worker memakai EventTarget agar mengikuti kontrak browser; assertion lama tetap |
| `tests/e2e/worker-failures.spec.ts` | Empat fault injection, pemulihan memakai Worker/WASM nyata dan download SVG |
| `.github/workflows/stage0-check.yml` | Validasi semua feat branch dan retensi command log |
| `scripts/watershed-region-research.sh` | Annotation detail gate gagal, exit code tidak diubah |
| `scripts/audit-export-identity.mjs` | Perbandingan byte SVG browser lama/baru dan empat hasil pemulihan |
| `README.md` | Status audit dan batas produksi/riset |

Tidak ada dependency baru, upload gambar, perubahan hosting, layanan eksternal,
WASM feature yang diaktifkan, atau perubahan Rust/vendor/fitting/palette.

## 5. Pengujian dan bukti

Raw evidence berada pada namespace baru `benchmark-results/audit-20261029/`;
hasil lama tidak ditimpa. Reproduksi sengaja dilakukan sebelum patch:

| Tahap | Hasil / makna |
| --- | --- |
| Tujuh reproduksi terhadap kode awal | 7 FAIL; membuktikan masalah, bukan disamarkan menjadi PASS |
| Patch awal unit | 7 PASS |
| Uji idle-error patch antara | FAIL; menemukan regresi sementara, diperbaiki sebelum delivery |
| Verification v1 | Lint FAIL karena alias `this` pada mock; browser 30 PASS / 1 FAIL pada reply fault; raw exit/log dipertahankan |
| Probe event browser | Handler property tidak dipanggil; listener event dipanggil |
| Verification final | Dicatat setelah seluruh command selesai; tidak ada timeout/threshold yang dinaikkan |

Empat skenario browser baru menyuntikkan fault terkontrol. Sesudah fault,
pengguna mendapat error, kontrol konversi dapat dipakai lagi, retry menjalankan
VTracer WASM nyata, dan SVG benar-benar diunduh. Ini bukan klaim bahwa crash
spontan terjadi pada perangkat pengguna atau bahwa penyebab historical stall
telah diselesaikan.

Pemeriksaan `npm audit --omit=dev --json` melaporkan **0 advisory** pada dependency
produksi saat dijalankan. Ini bukan bukti bebas seluruh kelemahan kode atau
dependency development; versi dependency tidak dinaikkan tanpa kebutuhan.

### Hasil final dan identitas geometri

`verification-v2/exit-status.tsv` mencatat semua command final exit 0:

| Pemeriksaan | Hasil |
| --- | --- |
| Native Rust default / source_geometry | 69 / 69 PASS |
| large_apex / large_apex,inverse_hotpath | 72 / 76 PASS |
| watershed_region_research / combined explicit features | 76 / 83 PASS |
| Vendor VTracer native | 53 PASS |
| TypeScript/Vitest | 50 PASS, termasuk 8 pengujian baru |
| Lint / typecheck / default WASM / Vite | Exit 0 |
| Chromium E2E | 31 PASS, termasuk 4 fault/recovery scenarios |
| Offline corner/source/curve readers | Ketiganya exit 0, gate lama tetap |
| SVG evidence lama vs hasil final | 271/271 identik byte |
| Download setelah fault/retry | 4/4 sama dengan baseline icon illustration |
| Dependency produksi | npm audit 0 advisory |

SHA256 default WASM sebelum dan setelah rebuild sama:
`e6ee763c9101714171f4b28263e71ae89c87429b27330c83f4d47516a65389b4`.
Rust/vendor maupun skrip threshold lama tidak berubah. Perbandingan 271 file
memakai unduhan E2E produksi Stage 1.7C dan hasil E2E final dengan nama kasus
yang sama, bukan SVG buatan tangan atau intermediate optimizer.

Identitas byte ini menjaga hasil pada kasus yang diperbandingkan; bukan klaim
bahwa semua bentuk baseline itu benar. Rangkaian riset historis 45-case dan
investigasi timing multi-session tidak diulang dalam audit ini; buktinya tetap
di laporan masing-masing. Pengujian native seluruh feature dan kesamaan binary
tidak diubah menjadi klaim pengujian browser feature yang tidak dijalankan.

Reproduksi dari checkout yang dependensinya sudah terpasang:

```bash
NEXORA_WATERSHED_VERIFY="$PWD/benchmark-results/audit-fresh" \
  bash scripts/watershed-region-verify-local.sh

# Baseline adalah artifact E2E lama yang harus tersedia, bukan reference engine input.
NEXORA_AUDIT_BASE=/path/to/old/e2e \
NEXORA_AUDIT_CANDIDATE="$PWD/benchmark-results/audit-fresh/e2e" \
NEXORA_AUDIT_IDENTITY="$PWD/benchmark-results/audit-fresh/identity.json" \
  node scripts/audit-export-identity.mjs
```

Gunakan folder output baru; hasil gagal tidak ditimpa. Di lingkungan lokal ini
Chromium memakai `/usr/bin/chromium` dan test port 4187. Browser 154.0.8037.57,
Node v24.19.0; physical Android **UNVERIFIED**. Tidak ada klaim penurunan CPU,
heap/RSS, atau perbaikan episode runtime lama dari data audit ini.

Status CI branch audit dicatat terpisah dari hasil lokal. Tidak ada job pending
yang diberi PASS, dan kedua kegagalan CI lama di bagian A6 tetap dipertahankan.
Implementasi dikirim ke
[run 40838101625](https://github.com/akidwush/vector-magic-bydika/actions/runs/40838101625),
commit `e811ca7`: observasi terminal **SUCCESS**, job `validate` selesai,
langkah retensi log dan upload artifact juga sukses. Rangkaian produksi yang
berlaku, termasuk E2E dan gate source-refinement, tidak diturunkan. Tiga job
investigasi riset yang kondisi branch-nya tidak cocok tetap skipped, bukan
dianggap ikut lulus. Artifact normal bernama `stage-01-evidence`, termasuk
`benchmark-results/validation.log`, screenshot dan SVG hasil browser.

Hasil ini mendukung patch runtime/cleanup tersebut. Tidak membatalkan kedua
FAIL Stage 1.7C, tidak menyelesaikan misteri CPU historis, dan tidak membuktikan
semua fitur eksperimen siap dipromosikan.

## 6. Prioritas pengembangan berikutnya

1. Pertahankan canonical shared-boundary ownership sampai serialisasi, termasuk
   setelah source/coverage refinement. Ukur geometry equality dan paint lokal
   bersamaan; jangan cukup memperbaiki graph awal.
2. Baru evaluasi ulang satu split Watershed dan veto Mosaic yang diblokir oleh
   kontrak itu. Pastikan loss per-tile tidak memburuk; pale garden tetap target
   region dengan artifact yang jujur.
3. Kembangkan pembeda intentional detail vs codec noise pada corpus terpisah.
   Ukur detail/holes, path/anchor/byte dan waktu, bukan hanya MAE global.
4. Pisahkan ekspor stacked/cutout/grouping hanya setelah semantik occlusion,
   alpha dan holes diuji. Tidak cukup meniru string menu aplikasi pembanding.
5. Kumpulkan bukti perangkat Android nyata dan keluaran pembanding berlisensi
   bila tersedia. Statusnya tetap UNVERIFIED sampai benar-benar diukur.

Perbaikan runtime/cleanup dalam audit ini dapat direview secara terpisah dari
riset geometri. Tidak ada promosi global atau merge `main` pada pekerjaan ini.
