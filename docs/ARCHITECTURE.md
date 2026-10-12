# Arquitectura

## System Context

Electron ofrece la interfaz y el instalador. El proceso principal controla archivos y ejecuta motores; el renderizador nunca recibe acceso directo a Node.js.

## Layer Map & Dependency Rule

- `renderer/`: presentación y estado visual.
- `preload.js`: API estrecha y tipada por intención mediante IPC.
- `domain.js`: validación y construcción pura de trabajos de descarga.
- `services.js`: adaptadores para yt-dlp, FFmpeg, GitHub y preferencias.
- `main.js`: composición y controladores IPC.

El dominio no importa Electron ni infraestructura. La UI no ejecuta procesos ni escribe archivos.

## Decisiones

| Decisión | Motivo |
|---|---|
| Electron | Toolchain disponible y empaquetado estable para Windows |
| yt-dlp detrás de un adaptador | Amplia compatibilidad y actualizaciones independientes |
| FFmpeg externo | Evita inflar el repositorio y permite reparación separada |
| GitHub Releases configurable | El repositorio definitivo aún no existe |
