const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'android/build/assets');
fs.mkdirSync(dest, { recursive: true });
for (const stale of ['player.js', 'account.js', 'mobile.css', 'channels.json']) {
    const file = path.join(dest, stale);
    if (fs.existsSync(file)) fs.unlinkSync(file);
}
// Package the same interface as the browser for mobile and Android TV.
for (const file of ['index.html', 'app.js', 'style.css']) fs.copyFileSync(path.join(root, file), path.join(dest, file));
fs.copyFileSync(path.join(root, 'hls.min.js'), path.join(dest, 'hls.min.js'));
console.log('Android: interfaz compartida con navegador, móvil y Android TV.');
