import crypto from 'crypto';
import Razorpay from 'razorpay';

export type RazorpayOrderInput = {
  amountPaise: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
};

export type RazorpayOrderResponse = {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
};

function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }

  return { keyId, keySecret };
}

let razorpayClient: Razorpay | null = null;

function getRazorpayClient(): Razorpay {
  if (razorpayClient) {
    return razorpayClient;
  }

  const { keyId, keySecret } = getRazorpayConfig();
  razorpayClient = new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });

  return razorpayClient;
}

export async function createRazorpayOrder(input: RazorpayOrderInput): Promise<RazorpayOrderResponse> {
  const client = getRazorpayClient();

  const payload = {
    amount: Math.max(100, Math.round(input.amountPaise)),
    currency: input.currency || 'INR',
    receipt: input.receipt || `receipt_${Date.now()}`,
    notes: input.notes || {},
  };

  const order = await client.orders.create(payload as any);

  return order as unknown as RazorpayOrderResponse;
}

export function verifyRazorpayWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is missing. Set it in your environment variables.');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Use timing-safe comparison to prevent timing side-channel attacks
  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Verifies the payment signature returned by Razorpay Checkout on the client.
 * The signature is an HMAC-SHA256 of `orderId|paymentId` using the
 * Razorpay Key Secret (NOT the webhook secret).
 */
export function verifyRazorpayPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const { keySecret } = getRazorpayConfig();

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
