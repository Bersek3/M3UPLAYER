const { MongoClient } = require('mongodb');
const fs = require('fs');

const MONGO_URI = 'mongodb+srv://franciscojmaguilar11_db_user:8KHcxKKvUMbHeVk2@cluster0.rpmhjcl.mongodb.net/m3u_tv_database?retryWrites=true&w=majority&appName=Cluster0';

async function updateAllChannels() {
    console.log('1. Descargando lista actualizada de https://orieus-lesauce.github.io/iptv-chile/CL.m3u ...');
    const res = await fetch('https://orieus-lesauce.github.io/iptv-chile/CL.m3u');
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const downloadedChannels = [];
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
            downloadedChannels.push({
                name: cur.name || 'Canal',
                logo: cur.logo || '',
                group: cur.group || 'Nacional',
                url: cur.url
            });
            cur = {};
        }
    }
    console.log(`Descargados ${downloadedChannels.length} canales de la lista CL.m3u.`);

    // Canales base importantes de Chile con stream directo verificado
    const baseDirectChannels = [
        {
            name: 'TVN',
            group: 'Nacional',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/3/33/Logotipo_de_Televisi%C3%B3n_Nacional_de_Chile.svg',
            url: 'https://mdstrm.com/live-stream-playlist-v/555c9a91eb4886825b07ee7b.m3u8'
        },
        {
            name: 'Chilevisión',
            group: 'Nacional',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/8/87/Emblema_de_Chilevisi%C3%B3n.svg',
            url: 'https://redirector.rudo.video/hls-video/10b92cafdf3646cbc1e727f3dc76863621a327fd/chv/chv.smil/playlist.m3u8'
        },
        {
            name: 'Canal 13 HD',
            group: 'Nacional',
            logo: 'https://cdn.m3u.cl/logo/457_Canal_13.png',
            url: 'https://jireh-9-hls-video-cl-movistar.dps.live/hls-video/ey6283je82983je9823je8jowowiekldk9838274/13live/13live.smil/13live/livestream1/chunks.m3u8'
        },
        {
            name: 'BioBio TV',
            group: 'Noticias',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a8/Biobio_TV_logo.jpg',
            url: 'https://redirector.rudo.video/hls-video/339f69c6122f6d8f4574732c235f09b7683e31a5/bbtv/bbtv.smil/playlist.m3u8'
        },
        {
            name: 'Radio Carolina TV',
            group: 'Música',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/b/b8/Logo_Radio_Carolina_2020.png',
            url: 'https://mdstrm.com/live-stream-playlist/63a06468117f42713374addd.m3u8'
        },
        {
            name: 'Radio Cooperativa',
            group: 'Música / Noticias',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/Radio_Cooperativa_Logo.svg',
            url: 'https://unlimited1-cl-isp.dps.live/coopetv/coopetv.smil/playlist.m3u8'
        },
        {
            name: 'Radio ADN TV',
            group: 'Música / Noticias',
            logo: 'https://upload.wikimedia.org/wikipedia/commons/c/c2/ADN_Radio_Chile.svg',
            url: 'https://redirector.rudo.video/hls-video/931b584451fa6dd1313ee66efbfd5802e3f3bcea/adntv/adntv.smil/playlist.m3u8'
        },
        {
            name: 'Tevex',
            group: 'General',
            logo: 'https://tevex.cl/wp-content/uploads/2021/01/logo_tevex_formato_3.svg',
            url: 'https://v4.tustreaming.cl:443/tevexinter/index.m3u8'
        }
    ];

    // Combinar y deduplicar por URL o nombre normalizado
    const combined = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    function addChannel(ch) {
        const u = ch.url.trim();
        const n = ch.name.trim().toLowerCase();
        if (!seenUrls.has(u) && !seenNames.has(n)) {
            seenUrls.add(u);
            seenNames.add(n);
            combined.push(ch);
        }
    }

    // Agregar primero los canales descargados de la nueva lista
    for (const ch of downloadedChannels) {
        addChannel(ch);
    }
    // Agregar canales base adicionales
    for (const ch of baseDirectChannels) {
        addChannel(ch);
    }

    // Formatear con numeración
    const finalChannels = combined.map((ch, idx) => ({
        number: String(idx + 1).padStart(3, '0'),
        name: ch.name,
        group: ch.group || 'Nacional',
        logo: ch.logo || '',
        url: ch.url
    }));

    console.log(`2. Total de canales consolidados: ${finalChannels.length}`);

    // Guardar para M3UPLAYER/main.js FALLBACK_CHANNELS
    fs.writeFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/final_channels.json', JSON.stringify(finalChannels, null, 2));

    // 3. Actualizar MongoDB Atlas
    console.log('3. Conectando a MongoDB Atlas...');
    const client = new MongoClient(MONGO_URI, { family: 4 });
    await client.connect();
    const db = client.db('m3u_tv_database');
    const playlistsCol = db.collection('playlists');

    // Actualizar todas las listas en la base de datos o insertar la principal
    const result = await playlistsCol.updateMany(
        {},
        {
            $set: {
                channels: finalChannels,
                channelCount: finalChannels.length,
                name: 'IPTV Chile HD (Oficial)',
                sourceUrl: 'https://orieus-lesauce.github.io/iptv-chile/CL.m3u',
                updatedAt: new Date()
            }
        }
    );

    console.log(`Base de datos actualizada! Colecciones modificadas: ${result.modifiedCount}`);
    if (result.matchedCount === 0) {
        await playlistsCol.insertOne({
            name: 'IPTV Chile HD (Oficial)',
            sourceUrl: 'https://orieus-lesauce.github.io/iptv-chile/CL.m3u',
            channels: finalChannels,
            channelCount: finalChannels.length,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        console.log('Lista insertada por primera vez en la colección playlists.');
    }

    await client.close();
    console.log('Proceso completado exitosamente.');
}

updateAllChannels().catch(console.error);
