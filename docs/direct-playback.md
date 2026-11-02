# Prueba directa MPEG-TS sin Render

La página independiente reproduce el MPEG-TS original con mpegts.js, sin convertir
imagen ni audio a HLS. Los datos van del proveedor al navegador; el servidor local
solo entrega los archivos de la página. No requiere cuenta, base de datos ni API.

El canal probado entrega video H.264 a 1080p y audio MPEG Layer II (MP2). Para
conservar el video original sin depender del soporte nativo de MP2, la página
separa el audio y lo decodifica con WebAssembly (`mpg123-decoder`). WebAudio lo
reproduce siguiendo el reloj del video, sin acelerar voces. Hay una sola conexión
al proveedor; el servidor local no recibe ni convierte los datos de la señal.
Las bibliotecas se incluyen en el proyecto, sin requerir un CDN al reproducir.
El arranque espera un fotograma de acceso con su configuración. En fuentes
entrelazadas PAFF, los dos campos se agrupan en una muestra completa para el
decodificador del navegador, conservando los datos H.264 originales.

## Prueba en este equipo

Con Node.js instalado, abre PowerShell en la carpeta del proyecto y ejecuta:

```powershell
node scripts/serve-direct-player.js
```

1. Abre `http://127.0.0.1:4173/direct-player.html` en el navegador del mismo equipo.
2. Conserva el enlace precargado de TNT o pega una URL MPEG-TS compatible.
3. Pulsa **Reproducir**. Si el navegador pide una interacción para iniciar el audio,
   pulsa el botón de reproducción del video.
4. Pulsa **Detener** para cerrar la conexión. Usa `Ctrl+C` en PowerShell para cerrar
   el servidor local.

El servidor escucha únicamente en `127.0.0.1:4173`, no permite explorar carpetas y
no actúa como proxy. No compartas esta dirección con otros dispositivos: loopback
siempre apunta al equipo desde el que se abre. No abras el HTML con `file://` ni
desactives la seguridad del navegador.

Se comprobó en Chrome que la página HTTP en loopback puede solicitar esta fuente
HTTP sin indicadores de seguridad desactivados; el origen respondió HTTP 200 y
`Access-Control-Allow-Origin: *`. Eso no demuestra reproducción sostenida ni que
todos los navegadores se comporten igual. La disponibilidad del proveedor puede
cambiar.

El transporte directo incluido admite MPEG-TS alineado de 188 bytes y un solo
programa, con tablas PAT/PMT de una sección (pueden ocupar varios paquetes).
Si la fuente utiliza otra estructura o no entrega un punto de acceso durante
el inicio, el reproductor informa del fallo y limita los reintentos.

## Página publicada con HTTPS

La fuente original usa HTTP. Una página publicada con HTTPS no puede obtener esa
fuente directamente por JavaScript: el navegador bloquea el contenido mixto.
Para publicar sin Render ni otro intermediario, el proveedor debe entregar una
URL **HTTPS**, conservar códecs compatibles y permitir CORS para la página.
Cambiar solamente `http` por `https` no instala HTTPS en el proveedor.

En la aplicación principal, configura `TNT_SPORTS_DIRECT_URL` con esa URL HTTPS
del proveedor y vuelve a desplegar la aplicación. No hace falta esta variable
para la página independiente: introduce allí la URL en el formulario.
Una antigua variable `TNT_SPORTS_HLS_URL` ya no activa Render automáticamente;
el puente HLS solo se selecciona expresamente con `TNT_SPORTS_PLAYBACK=hls`.

## Qué comprobar si falla

- **Contenido mixto:** usa la dirección local HTTP para la prueba o pide HTTPS
  al proveedor para la página publicada.
- **Error de red o CORS:** comprueba que la fuente responda y permita al navegador
  leerla. Esta página no oculta los errores con un proxy.
- **Códec no compatible:** VLC admite más formatos. Esta página cubre video
  compatible con MSE y audio MPEG Layer I/II/III mediante el decodificador
  incluido; no decodifica por software todos los formatos de video de VLC.
- **Pixelación o audio dañado:** compara con VLC al mismo tiempo y desde la misma
  red. Evitar la recodificación conserva la señal recibida, pero no reconstruye
  datos ausentes o dañados en el origen.

## Resultado de la prueba realizada

En Chrome se comprobó reproducción real de una señal de prueba H.264 + MP2:
video a 1280 × 720, avance del reloj, audio PCM no silencioso y controles de
volumen y detención. El navegador obtuvo el contenido sin Render.

La fuente TNT indicada respondió HTTP 200 y CORS `*`, con H.264 High 4.0
entrelazado a 1080p y audio MP2. La nueva ruta llegó a mostrar un cuadro, pero
Chrome rechazó los cuadros siguientes con `PIPELINE_ERROR_DECODE`.
La decodificación de audio y la conexión funcionan; **la reproducción sostenida
de este canal no quedó resuelta en el navegador probado**. Que VLC lo reproduzca
no demuestra que el decodificador nativo de Chrome admita este flujo.

El modo directo muestra ese error y no vuelve automáticamente a Render. No se
debe considerar una solución verificada para TNT hasta probar una fuente de
video compatible o resolver esa limitación del decodificador.

Referencias: [mpegts.js](https://github.com/xqq/mpegts.js),
[CORS del reproductor](https://github.com/xqq/mpegts.js/blob/master/docs/cors.md),
[contenido mixto](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content).
