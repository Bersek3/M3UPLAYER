# M3U Player Android 1.5.0

## Google Play Console (Android App Bundle)

Archivo de carga: `dist/M3U-Player-1.5.0.aab`. Paquete `cl.m3uplayer.mobile`, versionCode 10, targetSdkVersion 36. El AAB se firma con una clave de carga independiente del APK personal.

Requisitos locales (excluidos de Git): JDK 17 en `.android-tools/java/<jdk>/`, Android Build Tools 35 en `.android-tools/build-tools/<version>/`, plataforma Android 36 en `.android-tools/platform/<version>/` y `bundletool.jar` en `.android-tools/`. Descargar desde Eclipse Adoptium, el repositorio oficial Android y las releases de `google/bundletool`.

Primera compilacion, solo si todavia no existe una clave de carga:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android-bundle.ps1 -CreateUploadKey
```

Compilaciones posteriores:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android-bundle.ps1
```

El script valida la estructura con bundletool y verifica la firma JAR. Respaldar juntos `.android-tools/m3uplayer-upload.keystore` y `.android-tools/upload-key-password.txt` en un lugar privado y seguro. No subirlos al repositorio. El certificado publico se exporta a `dist/m3uplayer-upload-certificate.pem`.

En Play Console, activar Play App Signing y cargar el `.aab` en la version de prueba o produccion. Para futuras cargas aumentar `android:versionCode` en el manifiesto y conservar la clave de carga. La validacion local no sustituye las pruebas en dispositivos ni la revision de Google Play.

APK: dist/M3U-Player-1.5.0.apk. Android 8.0 o superior. Paquete cl.m3uplayer.mobile, versionCode 10.

La app comparte la interfaz del navegador. En movil abre el acceso con correo y contrasena en vertical. Tras validar la cuenta, carga los canales habilitados y abre automaticamente TV en vivo en horizontal. Android TV conserva la orientacion horizontal tambien durante el acceso.

Una sesion guardada se valida al abrir y pasa directamente a TV en vivo. Una sesion expirada regresa al formulario. La contrasena se borra al autenticar y no se guarda. El token se conserva en el almacenamiento de la app hasta cerrar sesion o expirar.

Usa POST /api/auth/login y GET /api/user/channels en https://m3u-player-one.vercel.app. Si la cuenta no tiene canales propios, permanece vacia; no se cargan canales publicos de respaldo. Si no hay canales o falla la conexion, muestra el error con opcion de reintentar el acceso; no reproduce una lista fija de respaldo.

La lista vertical de canales permite deslizar con inercia dentro de su propio sector. El gesto recorre la lista sin cambiar la reproduccion; tocar un recuadro selecciona ese canal. El menu permanece visible durante el gesto y el desplazamiento.

Los controles son iconos abajo a la derecha y se ocultan tras 3,5 segundos de inactividad. Se muestran al tocar, mover el cursor o pulsar el mando. El volumen se despliega al interactuar con su icono. El icono de salida cierra la sesion y vuelve al acceso vertical en movil.

Instalar encima de la version anterior conserva el identificador y la firma.

Compilar:

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1

Pruebas del flujo actual: node --test scripts/android-startup.test.js scripts/favorites.test.js scripts/player.test.js.

Los archivos player.js, account.js y mobile.css son del reproductor Android anterior y no se empaquetan. El APK usa index.html, app.js y style.css de la raiz.

Conservar .android-tools/m3uplayer-personal.keystore para futuras actualizaciones. La firma personal y las herramientas estan excluidas de Git.

El reproductor usa una interfaz propia con fondo oscuro, indicador de carga discreto y boton lateral de reproducir/pausar/reintentar. El video mantiene su proporcion sin recortes. Se suprime el poster gris predeterminado de WebView y sus controles nativos.

Al eliminar una lista remota o un archivo, sus canales se retiran del perfil, favoritos y TV en vivo. Si el canal actual desaparece, se reproduce otro habilitado o se detiene el video si la cuenta queda vacia. La app comprueba los cambios de la cuenta cada 30 segundos mientras TV en vivo esta visible y al volver a primer plano. Los errores temporales de conexion conservan la ultima lista confirmada.
