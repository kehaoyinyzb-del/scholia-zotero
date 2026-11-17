/** Diagnostics exclude credentials and provider responses; retain local UI failure locations. */
export function redactDiagnostic(value) {
  return String(value)
    .replace(
      /([?&](?:code|state|code_challenge|id_token|access_token)=)[^&\s"']+/giu,
      '$1[redacted]',
    )
    .replace(/(Bearer\s+)[^\s"']+/giu, '$1[redacted]')
    .replace(
      /((?:\w*token|api.?key|password|authorization|pairing)["']?\s*[:=]\s*)[^\s,}]+/giu,
      '$1[redacted]',
    );
}

export function captureFailure(error, where) {
  return {
    time: new Date().toISOString(),
    where,
    name: error?.name || 'Error',
    code: error?.code || null,
    message: redactDiagnostic(error?.message || error).slice(0, 1200),
    stack: redactDiagnostic(error?.stack || '').slice(0, 4000),
  };
}
