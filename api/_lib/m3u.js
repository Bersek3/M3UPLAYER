// api/_lib/m3u.js — M3U parser shared helper
function extractChannelNameFromUrl(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
            let last = parts[parts.length - 1];
            last = last.replace(/\.(m3u8|m3u|ts|mp4|mkv)$/i, '');
            last = decodeURIComponent(last).replace(/[-_]/g, ' ').trim();
            const reserved = ['master', 'index', 'playlist', 'live'];
            if (last && !reserved.includes(last.toLowerCase())) {
                return last.charAt(0).toUpperCase() + last.slice(1);
            }
            if (parts.length > 1) {
                let prev = parts[parts.length - 2];
                prev = decodeURIComponent(prev).replace(/[-_]/g, ' ').trim();
                if (prev) return prev.charAt(0).toUpperCase() + prev.slice(1);
            }
        }
    } catch (e) {}
    return 'Canal En Vivo';
}

function parseM3UContent(rawText, sourceUrl = '', defaultName = '') {
    if (!rawText || typeof rawText !== 'string') return [];
    let text = rawText.replace(/^\uFEFF/, '').trim();
    if (!text) return [];

    const isDirectHlsStream = (
        sourceUrl && (sourceUrl.toLowerCase().includes('.m3u8') || sourceUrl.toLowerCase().includes('.ts')) &&
        (text.includes('#EXT-X-STREAM-INF') || text.includes('#EXT-X-TARGETDURATION') || text.includes('#EXT-X-MEDIA-SEQUENCE')) &&
        !text.includes('group-title=') && !text.includes('tvg-name=')
    );

    if (isDirectHlsStream) {
        const channelName = defaultName || extractChannelNameFromUrl(sourceUrl) || 'Canal M3U8 En Vivo';
        return [{ number: '001', name: channelName, logo: '', group: 'En Vivo', url: sourceUrl }];
    }

    const lines = text.split(/\r?\n/);
    const channels = [];
    let currentChannel = null;
    let counter = 1;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannel = { number: String(counter).padStart(3, '0') };
            counter++;
            const logoMatch = line.match(/tvg-logo=["']([^"']+)["']/i);
            currentChannel.logo = logoMatch ? logoMatch[1].trim() : '';
            const groupMatch = line.match(/group-title=["']([^"']+)["']/i);
            currentChannel.group = groupMatch ? groupMatch[1].trim() : 'General';
            const commaIndex = line.lastIndexOf(',');
            if (commaIndex !== -1 && commaIndex < line.length - 1) {
                currentChannel.name = line.substring(commaIndex + 1).trim();
            } else {
                const nameMatch = line.match(/tvg-name=["']([^"']+)["']/i);
                currentChannel.name = nameMatch ? nameMatch[1].trim() : `Canal ${currentChannel.number}`;
            }
            currentChannel.name = currentChannel.name.replace(/^["']|["']$/g, '');
        } else if (line.startsWith('#EXTGRP:')) {
            if (currentChannel && (!currentChannel.group || currentChannel.group === 'General')) {
                currentChannel.group = line.substring(8).trim() || 'General';
            }
        } else if (!line.startsWith('#')) {
            if (currentChannel) {
                let streamUrl = line;
                if (sourceUrl && !streamUrl.startsWith('http://') && !streamUrl.startsWith('https://')) {
                    try { streamUrl = new URL(streamUrl, sourceUrl).href; } catch (e) {}
                }
                currentChannel.url = streamUrl;
                channels.push(currentChannel);
                currentChannel = null;
            }
        }
    }

    if (channels.length === 0) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('http://') || line.startsWith('https://')) {
                channels.push({
                    number: String(counter).padStart(3, '0'),
                    name: extractChannelNameFromUrl(line),
                    logo: '', group: 'General', url: line
                });
                counter++;
            }
        }
    }

    if (channels.length === 0 && sourceUrl && sourceUrl.startsWith('http')) {
        channels.push({
            number: '001',
            name: defaultName || extractChannelNameFromUrl(sourceUrl) || 'Canal M3U8',
            logo: '', group: 'En Vivo', url: sourceUrl
        });
    }

    return channels;
}

module.exports = { parseM3UContent, extractChannelNameFromUrl };
