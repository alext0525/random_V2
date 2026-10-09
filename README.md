# PDF Toolkit

A Windows `.exe` that opens a PDF toolbox in your browser. Everything runs locally, offline. Files never leave your computer.

**Use it:** download `dist/PDFToolkit.exe` and double-click. Your browser opens the app. Close the tab and it exits.

## Features
- **Merge** PDFs, plus images, Word, Excel, PowerPoint, text, Markdown and HTML (auto-converted), with reordering
- **Split / extract**: custom ranges, every N pages, every page, or remove pages
- **Organize pages**: thumbnails, rotate, delete, reorder, add blank pages
- **Compress**: lossless optimize, or medium/high/extreme (rasterizes pages to JPEG)
- **Convert to PDF**: JPG, PNG, WebP, GIF, BMP, SVG, AVIF, DOCX, XLSX/XLS/ODS/CSV, PPTX (text only), MD, HTML, TXT and code/log files
- **PDF to other**: PNG/JPG/WebP images, TXT, DOCX (text only), HTML (text only)
- **Image converter**: PNG/JPG/WebP with quality and resize
- **Watermark, page numbers, metadata**

## Limits
- Legacy `.doc` / `.ppt` are not supported (save as `.docx` / `.pptx`)
- Office/HTML → PDF is rendered as page images (not selectable text); plain text → PDF keeps real text
- Compress levels other than lossless remove selectable text
- No password encryption/decryption

## Build (needs Go 1.22+)
```
./build.sh          # writes dist/PDFToolkit.exe (Windows) and dist/pdftoolkit (Linux)
```
The web UI is in `web/` and embedded into the binary. Libraries in `web/vendor` (pdf-lib, pdf.js, JSZip, mammoth, SheetJS, marked, html2canvas) are bundled, so no internet is needed.

---

# Sketch Racer (browser game)

Draw a track, tune hilliness / corner tightness / length, pick a car, add AI opponents with individual difficulty, and race. Real 3D (three.js from CDN) with a two-axle tyre physics model (slip angles, weight transfer, FWD/RWD/AWD, downforce, optional TC/ABS/stability assists), bloom, shadows, reflections, detailed cars with a full cockpit and 8 camera views. Single static page in `game/` (no build step).

- **Play locally:** open `game/index.html`.
- **Play from a link:** merge to `main`, then in the repo go to Settings → Pages → Source: **GitHub Actions**. `.github/workflows/pages.yml` publishes `game/` to `https://<user>.github.io/<repo>/`. Use your browser's "Install / Add to home screen" for a shortcut.
- **Controls:** ↑/W throttle, ↓/S brake/reverse, ←→/A D steer, Space handbrake, C or 1–8 camera (chase, far chase, cockpit, onboard, hood, bumper, TV, helicopter), R reset car, P/Esc pause, M mute. Gamepad: left stick steer, RT throttle, LT brake, B handbrake, Y/RB camera, Back reset, Start pause. Touch buttons appear on phones.


### Audio credits
- Engine loops: CC0 recordings from freesound.org — GiocoSound car engine pack (401547–401558), FreeCarSoundsGaming V8 pack (535037–535041), F1 idle & race start (181187), Lamborghini idle (112075), VW dune buggy (675200). Cut into seamless loops and crossfaded by rpm.
- Crash and horn: [pmndrs/racing-game](https://github.com/pmndrs/racing-game) (MIT).

### Car models
24 real cars live in `game/cars/*.glb` (meshopt + WebP compressed). Each class has several, picked under the class cards; "Sketch original" keeps the procedural car. Engine power, torque, rev range, mass, drivetrain, wheelbase and tyre size come from the real car; handling character still comes from the class.
Sources: Sketchfab artists via homework-26, raynocato/carmodels, rigmodels, Motorpool (McLaren F1), AlphaHub (Mercedes W14) and the three.js examples (Ferrari 458). For private use only.
