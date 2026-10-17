import mongoose, { Document, Schema } from 'mongoose';

export interface WalletTransaction extends Document {
  id: string;
  userId: string;
  type: 'credit' | 'debit';
  amountInr: number;
  reason: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const walletTransactionSchema = new Schema<WalletTransaction>(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true, enum: ['credit', 'debit'], index: true },
    amountInr: { type: Number, required: true },
    reason: { type: String, required: true },
    referenceId: { type: String, index: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({ userId: 1, referenceId: 1, reason: 1, type: 1 }, { unique: true, sparse: true });

export default mongoose.model<WalletTransaction>('WalletTransaction', walletTransactionSchema);
