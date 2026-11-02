# Reproducción compatible de la lista completa

El conversor acepta únicamente las fuentes de una lista M3U configurada. Cada canal tiene un identificador opaco; el navegador solicita `/live/<id>/index.m3u8`, nunca una URL arbitraria. FFmpeg convierte el canal seleccionado a H.264/AAC, desentrelaza cuando corresponde y publica segmentos HLS de dos segundos. La primera imagen puede tardar varios segundos.

## En este equipo

Abre `Abrir-Reproductor.cmd`, o ejecuta `npm run compatible-player`.

- Abre `http://127.0.0.1:3000` e inicia sesión con tu cuenta habitual.
- El lanzador utiliza `playlists/chile.m3u` si existe; si no, utiliza la copia sin credenciales.
- Las listas ya guardadas en la cuenta conservan sus nombres y canales. La API sustituye los enlaces registrados por sus versiones convertidas mientras esta modalidad está activa.
- También se genera `playlists/chile-convertidos-local.m3u`, excluido de Git, para importar las rutas del conversor local si hace falta.
- FFmpeg debe estar instalado o indicado mediante `FFMPEG_PATH`. El lanzador detecta la instalación local en `.android-tools/ffmpeg`.
- Cierra la consola o pulsa Ctrl+C para detener. Los servicios locales escuchan solo en la interfaz de bucle local; esta dirección no funciona desde otro equipo o teléfono.

## Web pública y Android

La misma salida HLS se puede usar en el reproductor existente de navegador y Android. Necesita un conversor encendido con HTTPS; una dirección local de este equipo no sustituye ese despliegue.

1. Despliega un servicio Docker persistente usando `video-bridge/Dockerfile.multi`, con el directorio raíz del repositorio como contexto.
2. Configura `ALLOWED_ORIGINS` con los orígenes exactos de la web y de la app Android, separados por comas. La dirección de Android es `https://appassets.androidplatform.net`.
3. Comprueba `/health`. El contenedor incluye la lista pública sin credenciales; para una lista privada diferente debes proporcionar `SOURCE_PLAYLIST` en el alojamiento, sin subir sus credenciales a Git.
4. En el servidor de la app/Vercel configura `M3U_PLAYBACK_BRIDGE_URL=https://tu-conversor` y vuelve a desplegar la API. Los identificadores públicos están en `api/_lib/bridge-sources.json`; para una lista privada diferente configura `M3U_BRIDGE_SOURCE_IDS` con sus identificadores y registra esas mismas fuentes en el conversor.
5. Vuelve a abrir TV en vivo. La API conserva `sourceUrl` y entrega HLS del conversor para las fuentes registradas. No hace falta cambiar la interfaz ni contratar un servicio distinto por cada canal.

El despliegue y el dominio HTTPS no se activan al guardar el código. Se requiere acceso al alojamiento para completarlos. La instancia necesita CPU para convertir en tiempo real; los planes suspendidos o insuficientes producen cortes. El uso de alojamiento puede tener costo.

## Límites y disponibilidad

El límite predeterminado es de dos conversiones simultáneas, compartidas entre quienes ven el mismo canal. Al solicitar un tercer canal se libera la conversión menos reciente; puede afectar a otro espectador. `MAX_SESSIONS` permite entre uno y ocho procesos según los recursos del equipo. Las conversiones sin solicitudes se detienen tras 45 segundos. El video se limita a 960 píxeles de ancho y 30 fps.

El servicio no publica las URLs originales ni ejecuta scripts de páginas. CORS limita los orígenes web, pero no autentica espectadores; para distribuir canales privados en Internet se requiere añadir control de acceso al alojamiento. No se ha activado un alojamiento público automáticamente.

Una fuente que devuelve 404, un dominio inexistente o un token vencido sigue necesitando un enlace actualizado. El conversor no elimina esas restricciones. El proveedor también puede aceptar la conexión desde tu casa y rechazar una IP de un centro de datos.

## Comprobación real

`node scripts/verify-compatible-player.js` toma CHV, TNT Sports Premium SD y CNN Chile de la lista pública, genera HLS, inspecciona los códecs y decodifica cuatro segundos de video/audio. Guarda los resultados en `playlists/compatibilidad-conversion.json`, sin direcciones privadas ni credenciales.

Con `node scripts/check-compatible-sources.js` se revisan los 28 enlaces originales sin publicar sus credenciales. La comprobación encontró nueve enlaces que entregaban video, tres páginas HTML y 16 errores de origen.

`node scripts/verify-compatible-player.js --all` comprueba los enlaces que entregaron video. La prueba de esta versión confirmó conversión a H.264/AAC y decodificación en los nueve: 13C, CHV, Canal 13, MEGA HD, TNT SPORTS, TNT Sports Premium SD, ViaX, Zona Latina y CANAL 13 NACIONAL SIN TRANS. Los dos últimos nombres de Canal 13 son alternativas del mismo canal. CNN Chile devolvió HTTP 404 en la consulta directa, también con el identificador de VLC. Esto no es una comprobación visual en un dispositivo físico.

Referencias: [salida HLS de FFmpeg](https://ffmpeg.org/ffmpeg-formats.html#hls-2), [compilaciones Windows enlazadas por FFmpeg](https://ffmpeg.org/download.html).
