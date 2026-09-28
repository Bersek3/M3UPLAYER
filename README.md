# 📺 M3U Player Pro - Samsung Smart TV & Cloud Portal

Aplicación profesional de reproducción IPTV / M3U para **Samsung Smart TV (Tizen OS)** con panel web en la nube y vinculación rápida mediante **Código QR**.

---

## 🌟 Características Principales

- **📱 Vinculación Rápida con Código QR**:
  - Olvídate de escribir usuario y contraseña con el control remoto.
  - Escanea el código QR desde tu teléfono celular y presiona un botón para autorizar el televisor al instante.
- **☁️ Sincronización en la Nube (MongoDB Atlas)**:
  - Cada usuario tiene su propia cuenta personal y privada.
  - Sube listas `.m3u` o enlaces URL desde cualquier teléfono o PC y tus canales aparecerán automáticamente en tu televisor.
- **🎮 Mando Inteligente Samsung (SolarCell / BN59)**:
  - Balancín de canales (**CH +/-**) para cambio secuencial de canal.
  - Flechas **Arriba / Abajo** para zapeo directo de canales a pantalla completa.
  - Flechas **Izquierda / Derecha** o pulsación simple de **OK** para abrir el menú lateral translúcido con navegación por categorías.
  - Botón **Play / Pause (⏯)** nativo.
  - Mantener pulsado **OK** durante 2.5 segundos (o botón menú/rojo) para abrir el panel de configuración (PIN por defecto: `1234`).
- **🚀 Ultra Optimizado para TV**:
  - Cero lag, renderizado virtualizado por lotes (chunks de 12 canales).
  - Compatible con motores web antiguos y modernos de Tizen OS.

---

## 📲 Cómo Usar

1. **Acceso Rápido en la TV mediante Código QR**:
   - Al abrir la aplicación en tu Smart TV Samsung, verás el código QR de vinculación instantánea.
   - Escanéalo con la cámara de tu teléfono celular para abrir la página oficial en GitHub Pages (`https://bersek3.github.io/M3UPLAYER/pair.html`).
   - Inicia sesión con tu **correo electrónico o usuario** y contraseña.
   - ¡Tu televisor iniciará sesión automáticamente y sincronizará todos tus canales!
   - *(Opcional)*: Si deseas probar los canales sin iniciar sesión, pulsa **[ ATRÁS ]** en el control remoto para activar el **Modo Libre / Canales Demo**.

2. **Subida y Gestión de Listas M3U8**:
   - Accede a tu panel desde cualquier celular o PC (vía GitHub Pages o Render).
   - Agrega tus enlaces `.m3u8` directos o listas completas IPTV.
   - Los canales aparecerán automáticamente organizados por categorías con logos en tu televisor.

---

## 📁 Estructura del Proyecto

```
├── M3UPLAYER/              # Aplicación cliente para Samsung Smart TV (Tizen OS)
│   ├── index.html          # Interfaz principal (UI optimizada)
│   ├── main.js             # Lógica de reproducción, control remoto y emparejamiento QR
│   ├── qrcode.min.js       # Generador de códigos QR local de alto rendimiento
│   ├── hls.min.js          # Motor de reproducción de vídeo HLS
│   ├── config.xml          # Manifiesto de la aplicación Tizen OS
│   └── css/style.css       # Estilos visuales Dark Mode premium
├── server/                 # Servidor Backend y Portal Web
│   ├── server.js           # API REST con Express, MongoDB Atlas y sistema de emparejamiento
│   ├── package.json        # Dependencias de Node.js
│   └── public/             # Portal web para usuarios y página móvil de escaneo QR
│       ├── index.html      # Portal de usuario para gestionar listas y canales
│       └── pair.html       # Interfaz móvil para autorizar TV con 1 tap
├── render.yaml             # Configuración de despliegue automático para Render
├── package.json            # Configuración raíz de Node.js
└── README.md               # Documentación general
```
