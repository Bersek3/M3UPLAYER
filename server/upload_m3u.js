const fs = require('fs');
const path = require('path');
const http = require('http');

const M3U_FILE = 'C:/Users/franc/Downloads/iptv/teles_repo/canales_chile.m3u';
const SERVER_HOST = 'localhost';
const SERVER_PORT = 3000;

function httpPost(path, headers, body) {
    return new Promise((resolve, reject) => {
        const bodyBuf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
        const opts = { hostname: SERVER_HOST, port: SERVER_PORT, path, method: 'POST', headers: { 'Content-Length': bodyBuf.length, ...headers } };
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch(e) { resolve({ status: res.statusCode, body: data }); } });
        });
        req.on('error', reject);
        req.write(bodyBuf);
        req.end();
    });
}

async function main() {
    const fileContent = fs.readFileSync(M3U_FILE);
    const text = fileContent.toString('utf8');
    const count = (text.match(/#EXTINF/g) || []).length;
    console.log('Archivo:', path.basename(M3U_FILE));
    console.log('Canales:', count);

    const loginBody = JSON.stringify({ username: 'admin', password: 'admin1234' });
    let token = null;

    let res = await httpPost('/api/auth/register', { 'Content-Type': 'application/json' }, loginBody);
    if (res.body && res.body.token) {
        token = res.body.token;
        console.log('Usuario registrado!');
    } else {
        res = await httpPost('/api/auth/login', { 'Content-Type': 'application/json' }, loginBody);
        if (res.body && res.body.token) {
            token = res.body.token;
            console.log('Login exitoso!');
        } else {
            console.error('Error auth:', JSON.stringify(res.body));
            return;
        }
    }

    const boundary = 'SAMSUNGATV' + Date.now().toString(16);
    const CRLF = '\r\n';
    const namePart = Buffer.from('--' + boundary + CRLF + 'Content-Disposition: form-data; name="name"' + CRLF + CRLF + 'Canales Chile' + CRLF, 'utf8');
    const fileHeader = Buffer.from('--' + boundary + CRLF + 'Content-Disposition: form-data; name="m3uFile"; filename="canales_chile.m3u"' + CRLF + 'Content-Type: application/x-mpegurl' + CRLF + CRLF, 'utf8');
    const tail = Buffer.from(CRLF + '--' + boundary + '--' + CRLF, 'utf8');
    const multipartBody = Buffer.concat([namePart, fileHeader, fileContent, tail]);

    const uploadRes = await httpPost('/api/user/playlist/upload', { 'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/form-data; boundary=' + boundary }, multipartBody);
    
    if (uploadRes.status === 200 || uploadRes.status === 201) {
        console.log('');
        console.log('=== SUBIDA EXITOSA ===');
        console.log('Canales importados:', uploadRes.body.channelCount);
        console.log('TOKEN:', token);
        fs.writeFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/tv_auth.json', JSON.stringify({ token, username: 'admin', server: 'http://localhost:3000' }, null, 2));
        console.log('Guardado en tv_auth.json');
    } else {
        console.log('Error upload status:', uploadRes.status, JSON.stringify(uploadRes.body).substring(0, 200));
        
        // Fallback: copy to public folder
        const pubDir = 'C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/public/playlists';
        if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });
        fs.copyFileSync(M3U_FILE, pubDir + '/canales_chile.m3u');
        console.log('');
        console.log('Archivo copiado como alternativa a:');
        console.log('  http://localhost:3000/playlists/canales_chile.m3u');
        console.log('  Usa esta URL en la app (Menu > PIN 1234 > pegar URL)');
    }
}

main().catch(console.error);
