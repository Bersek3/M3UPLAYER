const fs = require('fs');

async function run() {
    const res = await fetch('https://orieus-lesauce.github.io/iptv-chile/CL.m3u');
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const channels = [];
    let cur = {};

    for (let l of lines) {
        l = l.trim();
        if (l.startsWith('#EXTINF:')) {
            const logoMatch = l.match(/tvg-logo="([^"]+)"/);
            const nameMatch = l.match(/,(.+)$/);
            const groupMatch = l.match(/group-title="([^"]+)"/);
            cur.logo = logoMatch ? logoMatch[1] : '';
            cur.name = nameMatch ? nameMatch[1].trim() : 'Canal';
            cur.group = groupMatch ? groupMatch[1].trim() : 'Nacional';
        } else if (l.startsWith('http://') || l.startsWith('https://')) {
            cur.url = l;
            channels.push({
                name: cur.name || 'Canal',
                logo: cur.logo || '',
                group: cur.group || 'Nacional',
                url: cur.url
            });
            cur = {};
        }
    }

    console.log('Total canales descargados:', channels.length);
    fs.writeFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/new_channels.json', JSON.stringify(channels, null, 2));
}

run().catch(console.error);
