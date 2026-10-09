const fs = require('fs');

async function testStream(ch, timeoutMs = 7000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
        const res = await fetch(ch.url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (SmartTV; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0.3809.146 TV Safari/537.36'
            },
            signal: controller.signal
        });
        clearTimeout(timeout);
        const elapsed = Date.now() - start;

        if (!res.ok) {
            return {
                ...ch,
                status: 'ERROR',
                httpCode: res.status,
                timeMs: elapsed,
                reason: `HTTP ${res.status} ${res.statusText}`
            };
        }

        const text = await res.text();
        const isHls = text.includes('#EXTM3U') || text.includes('#EXT-X-STREAM-INF') || text.includes('.ts') || text.includes('.m3u8');
        
        return {
            ...ch,
            status: isHls || res.status === 200 ? 'OK' : 'WARNING',
            httpCode: res.status,
            timeMs: elapsed,
            contentType: res.headers.get('content-type') || '',
            hasHlsHeader: text.includes('#EXTM3U')
        };
    } catch (err) {
        clearTimeout(timeout);
        const elapsed = Date.now() - start;
        return {
            ...ch,
            status: 'OFFLINE',
            httpCode: 0,
            timeMs: elapsed,
            reason: err.name === 'AbortError' ? 'Timeout (>7s)' : err.message
        };
    }
}

async function runCheck() {
    const channels = JSON.parse(fs.readFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/final_channels.json', 'utf8'));
    console.log(`Verificando ${channels.length} canales en tiempo real...\n`);

    const results = [];
    for (let i = 0; i < channels.length; i++) {
        const ch = channels[i];
        process.stdout.write(`[${i + 1}/${channels.length}] Probando ${ch.name}... `);
        const res = await testStream(ch);
        results.push(res);
        if (res.status === 'OK') {
            console.log(`✅ ACTIVO (${res.timeMs}ms, HTTP ${res.httpCode})`);
        } else if (res.status === 'WARNING') {
            console.log(`⚠️ RESPUESTA EXTRAÑA (${res.timeMs}ms)`);
        } else {
            console.log(`❌ CAÍDO / ERROR (${res.reason})`);
        }
    }

    fs.writeFileSync('C:/Users/franc/OneDrive/Desktop/APP_SAMSUNG/server/channel_audit_results.json', JSON.stringify(results, null, 2));

    const online = results.filter(r => r.status === 'OK');
    const offline = results.filter(r => r.status !== 'OK');

    console.log('\n================ RESUMEN DE AUDITORÍA ================');
    console.log(`Total canales probados: ${results.length}`);
    console.log(`✅ Canales funcionando: ${online.length}`);
    console.log(`❌ Canales fallando / caídos: ${offline.length}`);
    console.log('=======================================================\n');
}

runCheck().catch(console.error);
