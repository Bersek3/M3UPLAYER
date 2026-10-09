const fs = require('fs');

const channels = JSON.parse(fs.readFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/final_channels.json', 'utf8'));
let m3u = '#EXTM3U\n';
for (const ch of channels) {
    m3u += `#EXTINF:-1 tvg-id="${ch.name}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.group}",${ch.name}\n${ch.url}\n`;
}

fs.writeFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/M3UPLAYER/channels.m3u', m3u, 'utf8');
console.log('M3UPLAYER/channels.m3u actualizado con', channels.length, 'canales.');
