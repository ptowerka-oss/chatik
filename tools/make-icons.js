// Генерирует иконки приложения для Android в resources/android-res (запускать вручную, нужен playwright).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'resources', 'android-res');
const BUBBLE = '<path d="M256 120c-84 0-152 55-152 124 0 40 23 75 58 98-3 22-13 42-27 58 33-4 62-17 84-35 12 2 24 3 37 3 84 0 152-55 152-124S340 120 256 120z" fill="#fff"/><circle cx="204" cy="244" r="17" fill="#2b7de9"/><circle cx="256" cy="244" r="17" fill="#2b7de9"/><circle cx="308" cy="244" r="17" fill="#2b7de9"/>';
const legacy = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${round ? 256 : 112}" fill="#2b7de9"/>${BUBBLE}</svg>`;
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(54 55) scale(0.15) translate(-256 -250)">${BUBBLE}</g></svg>`;
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  async function shot(svg, size, file) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: true });
  }
  for (const [d, k] of Object.entries(dens)) {
    const dir = path.join(out, 'mipmap-' + d);
    await shot(legacy(false), 48 * k, path.join(dir, 'ic_launcher.png'));
    await shot(legacy(true), 48 * k, path.join(dir, 'ic_launcher_round.png'));
    await shot(fg, 108 * k, path.join(dir, 'ic_launcher_fg.png'));
  }
  const any = path.join(out, 'mipmap-anydpi-v26'); fs.mkdirSync(any, { recursive: true });
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_fg"/>\n</adaptive-icon>\n';
  fs.writeFileSync(path.join(any, 'ic_launcher.xml'), xml); fs.writeFileSync(path.join(any, 'ic_launcher_round.xml'), xml);
  const vals = path.join(out, 'values'); fs.mkdirSync(vals, { recursive: true });
  fs.writeFileSync(path.join(vals, 'ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2B7DE9</color>\n</resources>\n');
  await b.close();
})();
