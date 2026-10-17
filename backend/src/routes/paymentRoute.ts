import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import requireJwt from '../middlewares/requireJwt';
import type { User } from '../database/models/userModel';
import { z } from 'zod';
import { validate } from '../middlewares/validateRequest';
import paymentOrderModel from '../database/models/paymentOrderModel';
import paymentWebhookEventModel from '../database/models/paymentWebhookEventModel';
import { calculateSpendWithProfit, inrToPaise } from '../services/billingService';
import {
  normalizeIdempotencyKey,
  resolveWebhookEventId,
  shouldIgnoreDuplicateCapture,
  shouldIgnoreDuplicateWebhookEvent,
} from '../services/paymentIdempotencyService';
import { createRazorpayOrder, verifyRazorpayPaymentSignature, verifyRazorpayWebhookSignature } from '../services/razorpayService';
import { emitAlert, logEvent } from '../utils/observability';
import { creditWallet } from '../services/walletService';

const router = Router();

function parseNumeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumeric(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const razorpayOrderSchema = z.object({
  rechargeAmountInr: z.union([z.string(), z.number()]).optional().transform(val => Number(val) || undefined),
  geminiInputTokens: z.union([z.string(), z.number()]).optional().transform(val => Number(val) || 0),
  geminiOutputTokens: z.union([z.string(), z.number()]).optional().transform(val => Number(val) || 0),
  ocrPages: z.union([z.string(), z.number()]).optional().transform(val => Number(val) || 0),
  gcsStorageGb: z.union([z.string(), z.number()]).optional().transform(val => Number(val) || 0),
  gcsEgressGb: z.union([z.string(), z.number()]).optional().transform(val => Number(val) || 0),
});

router.post('/razorpay/order', requireJwt, validate(razorpayOrderSchema), async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const idempotencyKey = normalizeIdempotencyKey(req.header('x-idempotency-key'));

    if (idempotencyKey) {
      const existing = await paymentOrderModel.findOne({
        userId: String(user.id),
        idempotencyKey,
      }).lean();

      if (existing) {
        logEvent('info', 'Returning existing payment order for idempotency key.', {
          userId: String(user.id),
          idempotencyKey,
          razorpayOrderId: existing.razorpayOrderId,
          status: existing.status,
        });

        return res.status(200).json({
          message: 'Existing Razorpay order returned for idempotency key.',
          keyId: process.env.RAZORPAY_KEY_ID,
          order: {
            orderId: existing.razorpayOrderId,
            amountPaise: existing.amountPaise,
            currency: existing.currency,
            receipt: existing.receipt,
            status: existing.status,
          },
          localOrderId: existing._id,
          breakdown: existing.spendBreakdown,
          idempotent: true,
        });
      }
    }
    const {
      rechargeAmountInr: requestedRechargeAmountInr,
      geminiInputTokens,
      geminiOutputTokens,
      ocrPages,
      gcsStorageGb,
      gcsEgressGb,
    } = req.body as z.infer<typeof razorpayOrderSchema>;

    const isWalletRecharge = requestedRechargeAmountInr !== undefined && requestedRechargeAmountInr > 0;

    if (isWalletRecharge && Number(requestedRechargeAmountInr) < 100) {
      return res.status(400).json({
        message: 'Minimum wallet recharge amount is Rs 100.',
        minimumRechargeAmountInr: 100,
        requestedRechargeAmountInr,
      });
    }

    const safeProfitMargin = Number(process.env.BILLING_PROFIT_MARGIN_PERCENT || 30);

    const breakdown = isWalletRecharge
      ? {
          geminiInputCostInr: 0,
          geminiOutputCostInr: 0,
          geminiTotalCostInr: 0,
          ocrCostInr: 0,
          gcsStorageCostInr: 0,
          gcsEgressCostInr: 0,
          infraCostInr: 0,
          baseCostInr: Number(requestedRechargeAmountInr || 0),
          profitInr: 0,
          finalChargeInr: Number(requestedRechargeAmountInr || 0),
          rates: {
            geminiInputPer1kInr: 0,
            geminiOutputPer1kInr: 0,
            ocrPerPageInr: 0,
            gcsStoragePerGbInr: 0,
            gcsEgressPerGbInr: 0,
            infraFlatInr: 0,
            profitMarginPercent: 0,
          },
        }
      : calculateSpendWithProfit({
          geminiInputTokens: parseNumeric(geminiInputTokens),
          geminiOutputTokens: parseNumeric(geminiOutputTokens),
          ocrPages: parseNumeric(ocrPages),
          gcsStorageGb: parseNumeric(gcsStorageGb),
          gcsEgressGb: parseNumeric(gcsEgressGb),
          profitMarginPercent: safeProfitMargin,
        });

    const amountPaise = inrToPaise(breakdown.finalChargeInr);
    const receipt = `ag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const razorpayOrder = await createRazorpayOrder({
      amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: String(user.id),
        email: user.email,
      },
    });

    const paymentOrder = await paymentOrderModel.create({
      userId: String(user.id),
      idempotencyKey,
      orderType: isWalletRecharge ? 'wallet_recharge' : 'usage',
      razorpayOrderId: razorpayOrder.id,
      receipt,
      amountPaise,
      amountInr: breakdown.finalChargeInr,
      currency: 'INR',
      status: 'created',
      spendInput: {
        geminiInputTokens: parseNumeric(geminiInputTokens),
        geminiOutputTokens: parseNumeric(geminiOutputTokens),
        ocrPages: parseNumeric(ocrPages),
        gcsStorageGb: parseNumeric(gcsStorageGb),
        gcsEgressGb: parseNumeric(gcsEgressGb),
        profitMarginPercent: safeProfitMargin,
      },
      spendBreakdown: {
        geminiInputCostInr: breakdown.geminiInputCostInr,
        geminiOutputCostInr: breakdown.geminiOutputCostInr,
        geminiTotalCostInr: breakdown.geminiTotalCostInr,
        ocrCostInr: breakdown.ocrCostInr,
        gcsStorageCostInr: breakdown.gcsStorageCostInr,
        gcsEgressCostInr: breakdown.gcsEgressCostInr,
        infraCostInr: breakdown.infraCostInr,
        baseCostInr: breakdown.baseCostInr,
        profitInr: breakdown.profitInr,
        finalChargeInr: breakdown.finalChargeInr,
      },
    });

    return res.status(201).json({
      message: 'Razorpay order created.',
      keyId: process.env.RAZORPAY_KEY_ID,
      order: {
        orderId: razorpayOrder.id,
        amountPaise: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt,
        status: razorpayOrder.status,
      },
      localOrderId: paymentOrder.id,
      breakdown,
      idempotent: false,
      orderType: isWalletRecharge ? 'wallet_recharge' : 'usage',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logEvent('error', 'Failed to create Razorpay order.', undefined, error);
    await emitAlert('Razorpay Order Creation Failed', {
      error: errorMessage,
    });
    return res.status(500).json({
      message: 'Failed to create Razorpay order.',
    });
  }
});

router.post('/razorpay/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.header('x-razorpay-signature');
    if (!signature) {
      return res.status(400).json({ message: 'Missing x-razorpay-signature header.' });
    }

    const eventId = resolveWebhookEventId(req.header('x-razorpay-event-id'));

    const duplicateEvent = await paymentWebhookEventModel.findOne({ eventId }).lean();
    if (shouldIgnoreDuplicateWebhookEvent(duplicateEvent)) {
      logEvent('warn', 'Duplicate Razorpay webhook event ignored.', {
        eventId,
        eventType: duplicateEvent?.eventType || 'unknown',
      });
      return res.status(200).json({ message: 'Duplicate webhook ignored.' });
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const isValid = verifyRazorpayWebhookSignature(rawBody, signature);
    if (!isValid) {
      logEvent('warn', 'Razorpay webhook signature verification failed.', { eventId });
      return res.status(401).json({ message: 'Invalid Razorpay webhook signature.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as any;
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const event = payload?.event as string | undefined;
    const orderId = payload?.payload?.payment?.entity?.order_id as string | undefined;
    const paymentId = payload?.payload?.payment?.entity?.id as string | undefined;

    if (!orderId) {
      return res.status(200).json({ message: 'Webhook received without order_id, ignored.' });
    }

    if (event === 'payment.captured') {
      const existingOrder = await paymentOrderModel.findOne({ razorpayOrderId: orderId }).lean();
      if (!existingOrder) {
        return res.status(404).json({ message: 'Payment order not found for webhook order_id.' });
      }

      // Check for duplicate capture FIRST — before any mutation
      if (shouldIgnoreDuplicateCapture(event, existingOrder.status as any)) {
        await paymentWebhookEventModel.create({
          eventId,
          signature,
          eventType: event,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          payloadHash,
          processedAt: new Date(),
          status: 'ignored',
        });
        return res.status(200).json({ message: 'Order already paid. Duplicate capture ignored.' });
      }

      // Credit the wallet BEFORE marking the order as paid.
      // If creditWallet fails, the order stays in 'created' status so that
      // Razorpay's webhook retry will re-attempt the credit. The idempotent
      // creditWallet (via unique referenceId on walletTransaction) ensures
      // double-credits cannot happen even if the webhook fires twice.
      const creditAmountInr = Number(existingOrder.amountInr || 0);
      const creditReason =
        existingOrder.orderType === 'wallet_recharge' ? 'wallet_recharge' : 'usage_payment';

      if (creditAmountInr > 0) {
        await creditWallet({
          userId: String(existingOrder.userId),
          amountInr: creditAmountInr,
          reason: creditReason,
          referenceId: orderId,
          metadata: {
            paymentId,
            orderType: existingOrder.orderType,
          },
        });
      }

      // Mark order as paid AFTER the wallet has been credited successfully.
      await paymentOrderModel.updateOne(
        { razorpayOrderId: orderId },
        {
          $set: {
            status: 'paid',
            paymentId: paymentId || undefined,
            lastWebhookEventId: eventId,
            paidAt: new Date(),
          },
        }
      );
    } else if (event === 'payment.failed') {
      await paymentOrderModel.updateOne(
        { razorpayOrderId: orderId },
        {
          $set: {
            status: 'failed',
            paymentId: paymentId || undefined,
            lastWebhookEventId: eventId,
          },
        }
      );

      await emitAlert('Razorpay Payment Failed', {
        orderId,
        paymentId,
        eventId,
      });
    }

    await paymentWebhookEventModel.create({
      eventId,
      signature,
      eventType: event || 'unknown',
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      payloadHash,
      processedAt: new Date(),
      status: 'processed',
    });

    logEvent('info', 'Razorpay webhook processed.', {
      eventId,
      event,
      orderId,
      paymentId,
    });

    return res.status(200).json({ message: 'Webhook processed.' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logEvent('error', 'Failed to process Razorpay webhook.', undefined, error);
    await emitAlert('Razorpay Webhook Processing Failed', {
      error: errorMessage,
    });
    return res.status(500).json({
      message: 'Failed to process Razorpay webhook.',
    });
  }
});

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

router.post('/razorpay/verify', requireJwt, validate(verifyPaymentSchema), async (req: Request, res: Response) => {
  try {
    const user = req.user as User;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body as z.infer<typeof verifyPaymentSchema>;

    // 1. Verify the Razorpay payment signature
    const isValid = verifyRazorpayPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      logEvent('warn', 'Payment signature verification failed.', {
        userId: String(user.id),
        razorpay_order_id,
        razorpay_payment_id,
      });
      return res.status(400).json({ message: 'Invalid payment signature.' });
    }

    // 2. Find the local payment order
    const existingOrder = await paymentOrderModel.findOne({
      razorpayOrderId: razorpay_order_id,
      userId: String(user.id),
    }).lean();

    if (!existingOrder) {
      return res.status(404).json({ message: 'Payment order not found.' });
    }

    // 3. If already paid, return current status (idempotent)
    if (existingOrder.status === 'paid') {
      logEvent('info', 'Payment already verified and wallet credited.', {
        userId: String(user.id),
        razorpay_order_id,
      });
      return res.status(200).json({
        message: 'Payment already verified.',
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        status: 'paid',
        amountInr: existingOrder.amountInr,
      });
    }

    // 4. Credit the wallet BEFORE marking paid (same logic as webhook)
    const creditAmountInr = Number(existingOrder.amountInr || 0);
    const creditReason =
      existingOrder.orderType === 'wallet_recharge' ? 'wallet_recharge' : 'usage_payment';

    let newBalance = 0;
    if (creditAmountInr > 0) {
      newBalance = await creditWallet({
        userId: String(existingOrder.userId),
        amountInr: creditAmountInr,
        reason: creditReason,
        referenceId: razorpay_order_id,
        metadata: {
          paymentId: razorpay_payment_id,
          orderType: existingOrder.orderType,
          verifiedBy: 'client',
        },
      });
    }

    // 5. Mark order as paid
    await paymentOrderModel.updateOne(
      { razorpayOrderId: razorpay_order_id },
      {
        $set: {
          status: 'paid',
          paymentId: razorpay_payment_id,
          paidAt: new Date(),
        },
      }
    );

    logEvent('info', 'Payment verified and wallet credited.', {
      userId: String(user.id),
      razorpay_order_id,
      razorpay_payment_id,
      creditAmountInr,
      newBalance,
    });

    return res.status(200).json({
      message: 'Payment verified and wallet updated.',
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      status: 'paid',
      amountInr: existingOrder.amountInr,
      walletBalanceInr: newBalance,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logEvent('error', 'Payment verification failed.', undefined, error);
    await emitAlert('Payment Verification Failed', {
      error: errorMessage,
    });
    return res.status(500).json({
      message: 'Payment verification failed.',
    });
  }
});

export default router;
