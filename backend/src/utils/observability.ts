type LogLevel = 'info' | 'warn' | 'error';

function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    value: String(error),
  };
}

export function logEvent(level: LogLevel, message: string, meta?: Record<string, unknown>, error?: unknown): void {
  const payload: Record<string, unknown> = {
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  if (meta) {
    payload.meta = meta;
  }

  const errorPayload = serializeError(error);
  if (errorPayload) {
    payload.error = errorPayload;
  }

  if (level === 'error') {
    console.error(JSON.stringify(payload));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

export async function emitAlert(title: string, body: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        sentAt: new Date().toISOString(),
      }),
    });
  } catch (error) {
    logEvent('warn', 'Failed to emit alert webhook.', { title }, error);
  }
}
