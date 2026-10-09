const { MongoClient } = require('mongodb');
const fs = require('fs');

const MONGO_URI = 'mongodb+srv://franciscojmaguilar11_db_user:8KHcxKKvUMbHeVk2@cluster0.rpmhjcl.mongodb.net/m3u_tv_database?retryWrites=true&w=majority&appName=Cluster0';

async function purgeAndSave() {
    const audit = JSON.parse(fs.readFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/channel_audit_results.json', 'utf8'));
    
    // Filtrar solo los canales 100% OK
    const workingChannels = audit
        .filter(c => c.status === 'OK')
        .map((c, idx) => ({
            number: String(idx + 1).padStart(3, '0'),
            name: c.name,
            group: c.group || 'Nacional',
            logo: c.logo || '',
            url: c.url
        }));

    console.log(`Canales activos listos: ${workingChannels.length}`);

    // 1. Guardar en final_channels.json
    fs.writeFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/final_channels.json', JSON.stringify(workingChannels, null, 2));

    // 2. Actualizar M3UPLAYER/main.js
    const mainJsPath = 'C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/M3UPLAYER/main.js';
    let mainJs = fs.readFileSync(mainJsPath, 'utf8');
    const replacement = 'const FALLBACK_CHANNELS = ' + JSON.stringify(workingChannels, null, 4) + ';';
    mainJs = mainJs.replace(/const FALLBACK_CHANNELS = \[[\s\S]*?\];/, replacement);
    fs.writeFileSync(mainJsPath, mainJs, 'utf8');
    console.log('M3UPLAYER/main.js actualizado con canales limpios.');

    // 3. Actualizar M3UPLAYER/channels.m3u
    let m3u = '#EXTM3U\n';
    for (const ch of workingChannels) {
        m3u += `#EXTINF:-1 tvg-id="${ch.name}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.group}",${ch.name}\n${ch.url}\n`;
    }
    fs.writeFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/M3UPLAYER/channels.m3u', m3u, 'utf8');
    console.log('M3UPLAYER/channels.m3u actualizado.');

    // 4. Actualizar MongoDB Atlas
    console.log('Actualizando MongoDB Atlas...');
    const client = new MongoClient(MONGO_URI, { family: 4 });
    await client.connect();
    const db = client.db('m3u_tv_database');
    const playlistsCol = db.collection('playlists');

    await playlistsCol.updateMany(
        {},
        {
            $set: {
                channels: workingChannels,
                channelCount: workingChannels.length,
                name: 'Canales Chile 100% Online',
                updatedAt: new Date()
            }
        }
    );
    console.log('MongoDB Atlas actualizado exitosamente.');
    await client.close();
}

purgeAndSave().catch(console.error);
