# MB Downloader

Aplicación de escritorio para Windows inspirada en las referencias visuales proporcionadas. Usa `yt-dlp` como extractor y FFmpeg para combinar o convertir formatos.

## Funciones

- Análisis de enlaces, miniatura y metadatos.
- Video hasta 8K cuando la fuente lo ofrece; MP4, MKV y WebM.
- Audio MP3, M4A, FLAC y Opus.
- Cola con progreso, velocidad, ETA, cancelación e historial persistente.
- Arrastrar enlaces, pegar y descargar, vista previa y detalles técnicos.
- Abrir el archivo en Explorer o enviarlo a la Papelera.
- Cookies opcionales de Chrome, Edge o Firefox para contenido accesible por el usuario.
- Temas claro, oscuro y automático según sistema/hora.
- Carpeta de salida configurable.
- Instalación/actualización de `yt-dlp` y reparación de FFmpeg.
- Canal de actualización configurable mediante un repositorio de GitHub Releases.

## Ejecutar

```powershell
npm install
npm start
```

El instalador incluye `yt-dlp`, FFmpeg, FFprobe y Deno. No necesita Python, Node, FFmpeg ni otras herramientas instaladas en la computadora de destino. Los enlaces copiados desde navegadores o aplicaciones móviles funcionan cuando el sitio es compatible con el motor.

Telegram puede conectarse mediante una cuenta personal y una sesión local cifrada. Esto permite acceder a archivos de canales privados `t.me/c/...` cuando la cuenta conectada pertenece al canal. Se requieren un API ID y API Hash creados por el usuario en `my.telegram.org`; los códigos y contraseñas se introducen exclusivamente en la aplicación.

La descarga múltiple acepta un enlace por línea. Cada trabajo se ejecuta de forma independiente, por lo que Telegram y otros sitios pueden descargar simultáneamente y cancelarse por separado.

## Crear instalador

```powershell
npm run test
npm run dist
```

El instalador se genera en `release/`. El canal oficial de actualizaciones es [floresroldanluis/MBDownloader](https://github.com/floresroldanluis/MBDownloader): al publicar una etiqueta `vX.Y.Z`, GitHub Actions compila el instalador y conserva esa versión en GitHub Releases. La aplicación consulta automáticamente la versión más reciente al abrirse y permite instalarla y reiniciar desde Configuración.

## Compatibilidad y uso responsable

La compatibilidad depende de los sitios admitidos por `yt-dlp`. DRM, cambios de plataforma o restricciones de cuenta pueden impedir una descarga. La aplicación no evita DRM ni controles de acceso. Utilícela únicamente con contenido propio, autorizado o legalmente descargable y respete los términos de cada servicio.
