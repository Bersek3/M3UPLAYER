# M3U Player Android 1.2.0

APK: dist/M3U-Player-1.2.0.apk. Android 8.0 o superior. Paquete cl.m3uplayer.mobile, versionCode 3.

Al abrir presenta un formulario de usuario/correo y contrasena para la cuenta existente de M3U Player. Usa POST /api/auth/login y GET /api/user/channels en https://m3u-player-one.vercel.app. Despues del acceso carga exclusivamente los canales de esa cuenta. Una cuenta vacia muestra un aviso, sin listas publicas de respaldo. Actualizar vuelve a consultar la cuenta; Cerrar sesion detiene el video y limpia el token y los canales de memoria.

Mantiene el reproductor horizontal inmersivo y la fila deslizable de canales. Tocar el video muestra u oculta controles. Pantalla completa los oculta. El token solo vive en memoria, la contrasena se borra del formulario despues del acceso y no se guarda. Una apertura nueva del proceso requiere iniciar sesion; volver desde segundo plano conserva la sesion en memoria. Una sesion expirada devuelve al formulario.

Instalar el APK encima de 1.0.0 o 1.1.0: conserva el identificador y la clave de firma. Abrirlo desde Archivos y permitir instalar desde esa fuente si Android lo solicita.

Compilar con las herramientas locales de .android-tools:

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1

Pruebas: node --test android/account.test.js. Cubren carga de canales personales, cuenta vacia, sesion expirada y cierre de sesion con respuestas simuladas. No se utilizan credenciales reales en las pruebas.

Conservar .android-tools/m3uplayer-personal.keystore para futuras actualizaciones. Es una firma personal, excluida de Git, con password local android. No corresponde a una configuracion de publicacion en Play Store.
