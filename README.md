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

## 🚀 Despliegue en Render (Cloud Hosting Gratuito)

Este proyecto está 100% preparado para ejecutarse en [Render](https://render.com).

### Pasos para desplegar:
1. Inicia sesión en [Render.com](https://render.com).
2. Haz clic en **New +** y selecciona **Web Service**.
3. Conecta tu repositorio de GitHub: `https://github.com/Bersek3/M3UPLAYER.git`.
4. Render detectará automáticamente la configuración o puedes definir:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. En la sección **Environment Variables**, asegúrate de tener:
   - `MONGO_URI`: `mongodb+srv://franciscojmaguilar11_db_user:8KHcxKKvUMbHeVk2@cluster0.rpmhjcl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
   - `NODE_ENV`: `production`
6. Haz clic en **Deploy Web Service**.
7. Una vez desplegado, Render te dará un enlace público (ejemplo: `https://m3uplayer.onrender.com`).

---

## 📲 Cómo Usar

1. **Registro / Subida de Listas**:
   - Abre tu enlace de Render en cualquier navegador (PC o celular).
   - Crea tu cuenta de usuario.
   - Sube tu lista M3U (archivo local o enlace web).
2. **Acceso en la TV**:
   - Al abrir la aplicación en tu televisor Samsung, verás la pantalla de inicio.
   - **Opción 1 (Recomendada)**: Escanea el código QR con la cámara de tu teléfono móvil, inicia sesión y pulsa **Vincular TV**. La TV entrará automáticamente y cargará tus canales.
   - **Opción 2**: Ingresa tu usuario y contraseña directamente con las flechas del control remoto.

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
