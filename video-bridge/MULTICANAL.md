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

### Conversor existente tnt-video-bridge

El servicio `https://tnt-video-bridge.onrender.com` debe ejecutar la versión
multicanal antes de usarlo como `M3U_PLAYBACK_BRIDGE_URL`. La versión antigua solo
atiende `/live/index.m3u8` y no puede atender los identificadores de los demás
canales. Una respuesta `503 Video not ready` indica que todavía no hay HLS
reproducible; no basta con que `/health` devuelva `200`.

Para actualizar ese mismo servicio, `video-bridge/render.yaml` conserva el nombre
`tnt-video-bridge` y cambia el Dockerfile a `video-bridge/Dockerfile.multi`, el
contexto Docker a la raíz del repositorio y `ALLOWED_ORIGINS` a los dominios de la
web. Si el servicio fue creado manualmente, aplica también estos valores en sus
ajustes de Render; editar el YAML no actualiza automáticamente un servicio que
no esté vinculado a ese Blueprint.

Cuando `/health` muestre `running`, `channels` y `sessions`, prueba
`/live/c55014add896e9fc907dc4d0/index.m3u8` con el origen de Vercel y comprueba
que los segmentos se descarguen. Solo después configura en producción de Vercel:

```text
M3U_PLAYBACK_BRIDGE_URL=https://tnt-video-bridge.onrender.com
```

Vuelve a desplegar Vercel. Los enlaces locales registrados de la cuenta se
convertirán en enlaces HTTPS al consultar los canales. No configures esta variable
contra la versión antigua, porque sus rutas multicanal devuelven `404`.

### Migración de la lista guardada

Si la cuenta contiene `chile-convertidos-local.m3u`, sus direcciones `127.0.0.1`
no son accesibles desde Vercel ni desde otros equipos. Cuando se configura
`M3U_PLAYBACK_BRIDGE_URL`, la API reconoce los identificadores registrados en esas
direcciones y entrega sus equivalentes en el conversor público. No modifica la
lista de la base de datos y no requiere volver a importarla. Los identificadores
desconocidos siguen necesitando registrar su fuente original en el conversor.

Para preparar Render por separado, usa el Blueprint `render.bridge.yaml`, con
el repositorio completo como contexto Docker. Este archivo selecciona el plan
`starter`; revisa el costo que muestra Render antes de crear el servicio. No se
activa ningún alojamiento al guardar este archivo.

Después del despliegue:

1. Comprueba `https://DOMINIO-DEL-CONVERSOR/health`.
2. En el proyecto Vercel `m3u-player-one`, configura para producción
   `M3U_PLAYBACK_BRIDGE_URL=https://DOMINIO-DEL-CONVERSOR`.
3. Despliega de nuevo Vercel con el código actualizado.
4. Abre TV en vivo con tu cuenta. En `/api/user/channels`, CHV debe tener una URL
   HTTPS del conversor con el mismo identificador `c55014add896e9fc907dc4d0` y
   `playbackType: "hls"`. No debe apuntar a `127.0.0.1`.
5. Comprueba que el video avance en el navegador y que el origen CORS sea
   `https://m3u-player-one.vercel.app`. Una respuesta correcta de `/health` por sí
   sola no confirma que el proveedor permita reproducir desde ese alojamiento.

La misma salida HLS se puede usar en el reproductor existente de navegador y Android. Necesita un conversor encendido con HTTPS; una dirección local de este equipo no sustituye ese despliegue.

1. Despliega un servicio Docker persistente usando `video-bridge/Dockerfile.multi`, con el directorio raíz del repositorio como contexto.
2. Configura `ALLOWED_ORIGINS` con los orígenes exactos de la web y de la app Android, separados por comas. La dirección de Android es `https://appassets.androidplatform.net`.
3. Comprueba `/health`. El contenedor incluye la lista pública sin credenciales; para una lista privada diferente debes proporcionar `SOURCE_PLAYLIST` en el alojamiento, sin subir sus credenciales a Git.
4. En el servidor de la app/Vercel configura `M3U_PLAYBACK_BRIDGE_URL=https://tu-conversor` y vuelve a desplegar la API. Los identificadores públicos están en `api/_lib/bridge-sources.json`; para una lista privada diferente configura `M3U_BRIDGE_SOURCE_IDS` con sus identificadores y registra esas mismas fuentes en el conversor.
5. Vuelve a abrir TV en vivo. La API conserva `sourceUrl` y entrega HLS del conversor para las fuentes registradas. No hace falta cambiar la interfaz ni contratar un servicio distinto por cada canal.

El despliegue y el dominio HTTPS no se activan al guardar el código. Se requiere acceso al alojamiento para completarlos. La instancia necesita CPU para convertir en tiempo real; los planes suspendidos o insuficientes producen cortes. El uso de alojamiento puede tener costo.

## Límites y disponibilidad

El límite predeterminado es de dos conversiones simultáneas, compartidas entre quienes ven el mismo canal. Al solicitar un tercer canal se libera la conversión menos reciente; puede afectar a otro espectador. `MAX_SESSIONS` permite entre uno y ocho procesos según los recursos del equipo. Las conversiones sin solicitudes se detienen tras 45 segundos. La salida predeterminada usa hasta 640 píxeles de ancho y 25 fps para reducir el trabajo de conversión. Se puede recuperar el perfil anterior con `BRIDGE_VIDEO_WIDTH=960` y `BRIDGE_VIDEO_FPS=30`, según la capacidad del alojamiento.

Si FFmpeg confirma un HTTP 400, 401, 403, 404 o 410, o un dominio inexistente,
el conversor devuelve un código de causa sin publicar la dirección original. El
reproductor muestra esa causa y detiene los reintentos: una fuente caída necesita
un enlace vigente. El perfil ligero se comprobó con conversión H.264/AAC y cuatro
segundos de decodificación en CHV y TNT; el informe está en
`playlists/diagnostico-perfil-ligero.json`. No mide el rendimiento de Render.

El servicio no publica las URLs originales ni ejecuta scripts de páginas. CORS limita los orígenes web, pero no autentica espectadores; para distribuir canales privados en Internet se requiere añadir control de acceso al alojamiento. No se ha activado un alojamiento público automáticamente.

Una fuente que devuelve 404, un dominio inexistente o un token vencido sigue necesitando un enlace actualizado. El conversor no elimina esas restricciones. El proveedor también puede aceptar la conexión desde tu casa y rechazar una IP de un centro de datos.

## Comprobación real

`node scripts/verify-compatible-player.js` toma CHV, TNT Sports Premium SD y CNN Chile de la lista pública, genera HLS, inspecciona los códecs y decodifica cuatro segundos de video/audio. Guarda los resultados en `playlists/compatibilidad-conversion.json`, sin direcciones privadas ni credenciales.

Con `node scripts/check-compatible-sources.js` se revisan los 28 enlaces originales sin publicar sus credenciales. La comprobación encontró nueve enlaces que entregaban video, tres páginas HTML y 16 errores de origen.

`node scripts/verify-compatible-player.js --all` comprueba los enlaces que entregaron video. La prueba de esta versión confirmó conversión a H.264/AAC y decodificación en los nueve: 13C, CHV, Canal 13, MEGA HD, TNT SPORTS, TNT Sports Premium SD, ViaX, Zona Latina y CANAL 13 NACIONAL SIN TRANS. Los dos últimos nombres de Canal 13 son alternativas del mismo canal. CNN Chile devolvió HTTP 404 en la consulta directa, también con el identificador de VLC. Esto no es una comprobación visual en un dispositivo físico.

Referencias: [salida HLS de FFmpeg](https://ffmpeg.org/ffmpeg-formats.html#hls-2), [compilaciones Windows enlazadas por FFmpeg](https://ffmpeg.org/download.html).
