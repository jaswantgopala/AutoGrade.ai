export type PaymentOrderStatus = 'created' | 'paid' | 'failed' | undefined;

export function normalizeIdempotencyKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveWebhookEventId(headerValue: unknown): string {
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function shouldIgnoreDuplicateWebhookEvent(existingEvent: unknown): boolean {
  return Boolean(existingEvent);
}

export function shouldIgnoreDuplicateCapture(
  eventType: string | undefined,
  currentOrderStatus: PaymentOrderStatus
): boolean {
  return eventType === 'payment.captured' && currentOrderStatus === 'paid';
}
