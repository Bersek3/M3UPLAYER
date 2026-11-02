# TNT Sports en la pagina de Vercel

El origen `http://181.78.79.131:8000/play/a0q9` entrega MPEG-TS continuo.
Este servicio lo convierte a HLS con video H.264 y audio AAC. La pagina conserva
su reproductor HLS actual. Vercel sirve la pagina y la API; los segmentos de video
viajan directamente del conversor al navegador por HTTPS, sin el proxy de Vercel.

## Puesta en marcha sin tener un VPS

1. Crea una cuenta en [Render](https://dashboard.render.com/) y conecta este repositorio.
2. Crea un **Web Service**, selecciona **Docker** y configura:
   - Dockerfile: `video-bridge/Dockerfile`
   - Docker build context: `video-bridge`
   - Health check: `/health`
   - `SOURCE_URL`: `http://181.78.79.131:8000/play/a0q9`
   - `ALLOWED_ORIGIN`: la direccion HTTPS exacta de tu pagina, sin `/` al final.
     Por ejemplo, `https://m3u-player-one.vercel.app`.
3. Elige una instancia con recursos suficientes para FFmpeg. Para uso continuo,
   utiliza una instancia que no se suspenda por inactividad. Revisa el costo de
   computo y transferencia antes de crear el servicio. La configuracion opcional
   `video-bridge/render.yaml` usa un plan de pago; no se despliega automaticamente.
   No uses el `render.yaml` de la raiz para este servicio: corresponde a la app anterior.
4. Cuando Render termine, abre
   `https://NOMBRE-DEL-SERVICIO.onrender.com/live/index.m3u8`.
   Debe devolver una lista que empiece con `#EXTM3U`. Puede tardar unos segundos
   despues del arranque. `/health` confirma que el servicio esta ejecutando;
   no confirma que el origen entregue video.
5. En **Vercel > proyecto > Settings > Environment Variables**, agrega:
   `TNT_SPORTS_HLS_URL=https://NOMBRE-DEL-SERVICIO.onrender.com/live/index.m3u8`.
   Aplica la variable al entorno Production y vuelve a desplegar la pagina.
6. Cierra y vuelve a abrir el reproductor o actualiza los canales. La API sustituye
   el enlace original en las listas ya guardadas. No necesitas editar ni volver a
   subir tu archivo M3U. Una importacion nueva tambien prueba la URL convertida.

## Comprobacion

- En Network del navegador, este canal debe pedir `/live/index.m3u8` y archivos
  `segment-....ts` al dominio de Render, con estado 200. No debe pedir su URL original
  mediante `/api/proxy/hls`.
- Si hay 403, compara `ALLOWED_ORIGIN` con el origen exacto de la pagina, incluido
  un dominio personalizado si lo usas. Las vistas previas de Vercel tienen otro origen.
- Si hay 503, el origen no esta generando video o el conversor esta arrancando.
  Revisa los registros de Render. Prueba el enlace original en VLC desde esa red:
  funcionar en tu casa no garantiza que el proveedor acepte la IP de Render.
- Si la conversion no alcanza tiempo real, aumenta los recursos de la instancia.
  Cambiar de biblioteca de video no elimina la necesidad de transportar este origen HTTP por HTTPS.

FFmpeg se reinicia al perder la fuente y elimina segmentos antiguos. Solo hay
una conexion al origen para todos los espectadores. El servicio no es un proxy
abierto: solo publica los archivos del canal configurado. La URL HLS es publica;
CORS limita los navegadores permitidos, pero no es autenticacion. No incluye
control de acceso por usuario ni garantia de disponibilidad de la fuente.

## Uso local opcional

Con Node.js y FFmpeg instalados, en PowerShell:

```powershell
$env:SOURCE_URL = 'http://181.78.79.131:8000/play/a0q9'
$env:ALLOWED_ORIGIN = 'https://m3u-player-one.vercel.app'
node video-bridge/server.js
```

Esto publica HTTP en el puerto 10000 de tu equipo; para usarlo desde la pagina
HTTPS necesitas exponerlo con un dominio HTTPS. Render realiza esa parte en el
despliegue descrito arriba.

Referencias: [limites de funciones Vercel](https://vercel.com/docs/functions/limitations),
[servicios web y HTTPS en Render](https://render.com/docs/web-services),
[suspension del plan gratuito](https://render.com/docs/free),
[salida HLS de FFmpeg](https://ffmpeg.org/ffmpeg-formats.html#hls-2).


## Continuidad y diagnostico de cortes

El conversor usa H.264 ultrafast con ancho maximo de 960 pixeles y 30 fps para reducir CPU,
con segmentos de 2 segundos y una ventana de 60 segundos. El cambio a 30 fps
reduce la fluidez de fuentes de 50/60 fps; ultrafast puede reducir calidad al
mismo limite de bitrate. La ventana amplia tolera retrasos del cliente, pero no
obliga al reproductor a esperar un minuto antes de reproducir.

Los registros imprimen la velocidad de FFmpeg cada 15 segundos. Una velocidad
sostenida inferior a 1x indica que la salida no alcanza el tiempo real; puede
ser por CPU insuficiente o por una entrada que entrega video lentamente.
Comprueba tambien CPU en Render y errores HTTP de segmentos en el navegador.
El reproductor reintenta fallos fatales de red hasta tres veces (1, 2 y 4 segundos),
y restaura ese presupuesto cuando descarga un fragmento correctamente.

Estos cambios requieren desplegar tanto video-bridge en Render como la pagina.
Las pruebas automaticas verifican argumentos, transporte y recuperacion; no
miden la velocidad real de FFmpeg ni garantizan la disponibilidad de la fuente.


Para evitar propagar errores de transporte se descartan paquetes marcados como
corruptos y se generan timestamps faltantes. El audio usa AAC a 192 kbit/s y
resincronizacion a 48 kHz con async=1: rellena o recorta huecos sin estirar las
voces. No reconstruye muestras o cuadros ya perdidos en el origen.
Los registros incluyen un contador de errores de decodificacion/timestamps por
intervalo, sin publicar mensajes del origen ni sus credenciales. Es un indicador
de diagnostico, no una medida exacta de paquetes perdidos.
