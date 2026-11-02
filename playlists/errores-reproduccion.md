# Diagnóstico de la lista Chile

Comprobación realizada el 2 de noviembre de 2026 a partir del registro del reproductor.

- El proxy rechazaba los puertos 4000, 8000 y 8080. Ahora admite esos puertos para HLS y conserva la validación de direcciones públicas y de cada redirección.
- Los enlaces `http://181.78.79.131:8000/play/...` sin extensión pertenecen a una fuente MPEG-TS continua. Una muestra de 13C confirmó paquetes TS. Se reconocen como MPEG-TS, en vez de enviarlos al proxy HLS. En la web HTTPS necesitan una fuente HTTPS del proveedor, conversión a HLS o el reproductor local HTTP del proyecto.
- `rudo.video/live/...` entrega HTML, no un manifiesto. El proxy puede leer su variable `streamURL` como datos, sin ejecutar scripts, y validar el destino antes de solicitar el video. Mega devolvió HLS en la prueba; las fuentes declaradas por Rudo para TVN y Canal 13 devolvieron 404 y 401, respectivamente.
- El dominio CHV del archivo no resuelve. Un proxy no puede reparar un dominio inexistente. Ahora se muestra la causa sin repetir indefinidamente la misma solicitud.
- Se añadió un favicon integrado para evitar la solicitud automática fallida de `/favicon.ico`.

## Lista para volver a importar

`chile-hls-comprobados.m3u` incluye únicamente las fuentes que devolvieron un manifiesto HLS y una muestra reconocible de un fragmento MPEG-TS o MP4. Sustituye la lista anterior desde el perfil para evitar mantener sus enlaces fallidos y duplicados.

`chile-hls-comprobacion.json` registra los resultados y la hora. Estas pruebas no garantizan decodificación, continuidad, audio ni acceso desde todas las redes o ubicaciones.

Para repetir la comprobación y regenerar la lista: `node scripts/check-chile-hls.js`.

Las alternativas de 13C y TVN se contrastaron con el catálogo público [IPTV-org Chile](https://github.com/iptv-org/iptv/blob/master/streams/cl.m3u); la fuente de Mega se obtuvo de la declaración de su reproductor Rudo. La lista original y sus credenciales permanecen fuera del repositorio.
