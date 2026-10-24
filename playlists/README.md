# Importación del HTML guardado

Origen: `https://pelisjuanita.com/tv/tv/index.php`, archivo local `TV GRATIS.html`.

- 246 entradas de catálogo, excluida la categoría de adultos.
- 60 entradas con fuentes de vídeo extraíbles: 62 enlaces contando alternativas.
- 186 entradas apuntan a páginas o reproductores, sin una fuente directa extraíble del HTML.
- Prueba de red: 31 enlaces aceptados (29 canales distintos), 31 rechazados.
- Rechazos: 27 tiempos de espera, dos HTTP 404, un HTTP 403 y un fallo de conexión.

## Archivos

- `tv-gratis-verificados.m3u`: lista para importar mediante el formulario de archivos del proyecto.
- `tv-gratis-candidatos.m3u`: todos los enlaces directos encontrados, incluidos los que no superaron la prueba.
- `tv-gratis-catalog.json`: catálogo y enlaces de reproductores pendientes de resolver.
- `tv-gratis-verificacion.json`: resultados de la prueba con fecha y motivo de rechazo.

La prueba descarga un manifiesto HLS y una muestra de un fragmento. No comprueba decodificación, CORS del navegador, continuidad, audio ni restricciones geográficas en el dispositivo final. Un rechazo por tiempo de espera no demuestra que el canal esté permanentemente caído. Las fuentes pueden caducar.

Para repetir la extracción: `node scripts/import-saved-tv.js "ruta/al/TV GRATIS.html"`.
El extractor lee los datos del archivo sin ejecutar sus scripts. Repetir la extracción no actualiza la verificación de red.
