import mongoose, { Schema, Document } from 'mongoose';
export interface PaymentOrder extends Document {
  id: string;
  userId: string;
  idempotencyKey?: string;
  orderType: 'usage' | 'wallet_recharge';
  razorpayOrderId: string;
  receipt: string;
  amountPaise: number;
  amountInr: number;
  currency: string;
  status: 'created' | 'paid' | 'failed';
  spendInput: {
    geminiInputTokens: number;
    geminiOutputTokens: number;
    ocrPages: number;
    gcsStorageGb: number;
    gcsEgressGb: number;
    profitMarginPercent: number;
  };
  spendBreakdown: {
    geminiInputCostInr: number;
    geminiOutputCostInr: number;
    geminiTotalCostInr: number;
    ocrCostInr: number;
    gcsStorageCostInr: number;
    gcsEgressCostInr: number;
    infraCostInr: number;
    baseCostInr: number;
    profitInr: number;
    finalChargeInr: number;
  };
  paymentId?: string;
  lastWebhookEventId?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentOrderSchema = new Schema<PaymentOrder>(
  {
    userId: { type: String, required: true, index: true },
    idempotencyKey: { type: String, index: true },
    orderType: { type: String, required: true, enum: ['usage', 'wallet_recharge'], default: 'usage' },
    razorpayOrderId: { type: String, required: true, unique: true, index: true },
    receipt: { type: String, required: true },
    amountPaise: { type: Number, required: true },
    amountInr: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
    status: { type: String, required: true, enum: ['created', 'paid', 'failed'], default: 'created' },
    spendInput: {
      geminiInputTokens: { type: Number, required: true },
      geminiOutputTokens: { type: Number, required: true },
      ocrPages: { type: Number, required: true },
      gcsStorageGb: { type: Number, required: true },
      gcsEgressGb: { type: Number, required: true },
      profitMarginPercent: { type: Number, required: true },
    },
    spendBreakdown: {
      geminiInputCostInr: { type: Number, required: true },
      geminiOutputCostInr: { type: Number, required: true },
      geminiTotalCostInr: { type: Number, required: true },
      ocrCostInr: { type: Number, required: true },
      gcsStorageCostInr: { type: Number, required: true },
      gcsEgressCostInr: { type: Number, required: true },
      infraCostInr: { type: Number, required: true },
      baseCostInr: { type: Number, required: true },
      profitInr: { type: Number, required: true },
      finalChargeInr: { type: Number, required: true },
    },
    paymentId: { type: String },
    lastWebhookEventId: { type: String },
    paidAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<PaymentOrder>('PaymentOrder', paymentOrderSchema);
