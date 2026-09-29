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
