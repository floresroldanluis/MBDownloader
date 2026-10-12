'use strict';

function telegramErrorText(error) {
  const raw = String(error?.errorMessage || error?.message || error || '').trim();
  const code = raw.toUpperCase();
  const flood = code.match(/FLOOD_WAIT_?(\d+)/);
  if (flood) return `Telegram exige esperar ${flood[1]} segundos antes de volver a intentarlo.`;

  const messages = [
    [/PHONE_CODE_INVALID|CODE_INVALID/, 'El código de inicio de sesión es incorrecto. Revisa el código e inténtalo nuevamente.'],
    [/PHONE_CODE_EXPIRED|CODE_EXPIRED/, 'El código de inicio de sesión venció. Solicita uno nuevo y vuelve a intentarlo.'],
    [/PHONE_CODE_EMPTY/, 'Introduce el código de inicio de sesión enviado por Telegram.'],
    [/PASSWORD_HASH_INVALID|PASSWORD_INVALID/, 'La contraseña de verificación en dos pasos es incorrecta.'],
    [/SESSION_PASSWORD_NEEDED/, 'Esta cuenta tiene verificación en dos pasos. Introduce tu contraseña de Telegram.'],
    [/PHONE_PASSWORD_FLOOD/, 'Hubo demasiados intentos de contraseña. Espera antes de volver a intentarlo.'],
    [/PHONE_NUMBER_INVALID/, 'El número celular no es válido. Comprueba el prefijo y los nueve dígitos.'],
    [/PHONE_NUMBER_BANNED/, 'Telegram bloqueó este número y no permite iniciar sesión con él.'],
    [/API_ID_INVALID/, 'El API ID o el API Hash no son válidos. Revísalos en my.telegram.org.'],
    [/API_ID_PUBLISHED_FLOOD/, 'Telegram bloqueó estas credenciales de API porque fueron publicadas o usadas excesivamente. Crea credenciales nuevas.'],
    [/AUTH_USER_CANCEL/, 'La autorización fue cancelada desde Telegram. Vuelve a conectar y aprueba el inicio de sesión.'],
    [/AUTH_RESTART/, 'Telegram pidió reiniciar la autorización. Pulsa Conectar Telegram nuevamente.'],
    [/USER_DEACTIVATED_BAN|USER_DEACTIVATED/, 'La cuenta de Telegram está desactivada o bloqueada.'],
    [/CONNECTION|TIMEOUT|ETIMEDOUT|ENETUNREACH/, 'No se pudo comunicar con Telegram. Comprueba tu conexión a Internet e inténtalo nuevamente.']
  ];
  const match = messages.find(([pattern]) => pattern.test(code));
  return match ? match[1] : `Telegram rechazó la conexión: ${raw || 'error desconocido'}.`;
}

module.exports = { telegramErrorText };
