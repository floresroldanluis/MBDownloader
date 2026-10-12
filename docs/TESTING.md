# Pruebas

## Test Strategy

Las reglas puras de URL, argumentos y canal de actualización se prueban sin Electron ni red. La verificación de empaquetado confirma que el proceso principal y los recursos se incluyen.

## Safety Net Map

| Módulo | Comportamientos fijados | Archivo |
|---|---|---|
| Dominio | URL segura, video, audio, GitHub | `test/domain.test.js` |
