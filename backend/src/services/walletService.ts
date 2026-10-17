import User from '../database/models/userModel';
import walletTransactionModel from '../database/models/walletTransactionModel';

export class WalletError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

type WalletMutationInput = {
  userId: string;
  amountInr: number;
  reason: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

function normalizeAmount(value: number): number {
  const safe = Number(value);
  if (!Number.isFinite(safe) || safe <= 0) {
    return 0;
  }
  return Math.round(safe * 100) / 100;
}

export async function getWalletBalance(userId: string): Promise<number> {
  const user = await User.findById(userId).lean();
  if (!user) {
    throw new WalletError(404, 'User not found for wallet access.');
  }

  const balance = Number((user as any).walletBalanceInr || 0);
  return Number.isFinite(balance) ? balance : 0;
}

export async function creditWallet(input: WalletMutationInput): Promise<number> {
  const amount = normalizeAmount(input.amountInr);
  if (amount <= 0) {
    throw new WalletError(400, 'Credit amount must be greater than zero.');
  }

  // For idempotent credits (for example payment order callbacks), create
  // the ledger row first so concurrent retries cannot double-increment balance.
  if (input.referenceId) {
    let createdTx: any;
    try {
      createdTx = await walletTransactionModel.create({
        userId: input.userId,
        type: 'credit',
        amountInr: amount,
        reason: input.reason,
        referenceId: input.referenceId,
        metadata: input.metadata,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        return getWalletBalance(input.userId);
      }
      throw error;
    }

    const updatedUser = await User.findByIdAndUpdate(
      input.userId,
      {
        $inc: { walletBalanceInr: amount },
      },
      { new: true }
    );

    if (!updatedUser) {
      if (createdTx?._id) {
        await walletTransactionModel.deleteOne({ _id: createdTx._id });
      }
      throw new WalletError(404, 'User not found for wallet credit.');
    }

    return Number((updatedUser as any).walletBalanceInr || 0);
  }

  const updatedUser = await User.findByIdAndUpdate(
    input.userId,
    {
      $inc: { walletBalanceInr: amount },
    },
    { new: true }
  );

  if (!updatedUser) {
    throw new WalletError(404, 'User not found for wallet credit.');
  }

  await walletTransactionModel.create({
    userId: input.userId,
    type: 'credit',
    amountInr: amount,
    reason: input.reason,
    referenceId: input.referenceId,
    metadata: input.metadata,
  });

  return Number((updatedUser as any).walletBalanceInr || 0);
}

export async function debitWallet(input: WalletMutationInput): Promise<number> {
  const amount = normalizeAmount(input.amountInr);
  if (amount <= 0) {
    throw new WalletError(400, 'Debit amount must be greater than zero.');
  }

  if (input.referenceId) {
    const existing = await walletTransactionModel.findOne({
      userId: input.userId,
      type: 'debit',
      reason: input.reason,
      referenceId: input.referenceId,
    }).lean();

    if (existing) {
      return getWalletBalance(input.userId);
    }
  }

  const updatedUser = await User.findOneAndUpdate(
    { _id: input.userId, walletBalanceInr: { $gte: amount } },
    { $inc: { walletBalanceInr: -amount } },
    { new: true }
  );

  if (!updatedUser) {
    // Determine if it was a user not found or insufficient balance
    const userExists = await User.findById(input.userId);
    if (!userExists) {
      throw new WalletError(404, 'User not found for wallet debit.');
    }
    throw new WalletError(402, 'Insufficient wallet balance.');
  }

  await walletTransactionModel.create({
    userId: input.userId,
    type: 'debit',
    amountInr: amount,
    reason: input.reason,
    referenceId: input.referenceId,
    metadata: input.metadata,
  });

  return Number((updatedUser as any).walletBalanceInr || 0);
}
