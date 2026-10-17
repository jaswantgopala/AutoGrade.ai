import mongoose, { Document, Schema } from 'mongoose';

export interface PaymentWebhookEvent extends Document {
  id: string;
  eventId: string;
  signature: string;
  eventType: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  payloadHash: string;
  processedAt: Date;
  status: 'processed' | 'ignored' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

const paymentWebhookEventSchema = new Schema<PaymentWebhookEvent>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    signature: { type: String, required: true },
    eventType: { type: String, required: true },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    payloadHash: { type: String, required: true },
    processedAt: { type: Date, required: true },
    status: { type: String, required: true, enum: ['processed', 'ignored', 'failed'], default: 'processed' },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<PaymentWebhookEvent>('PaymentWebhookEvent', paymentWebhookEventSchema);
