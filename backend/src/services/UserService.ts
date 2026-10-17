import User, { type User as UserType } from '../database/models/userModel';

export interface GetUserParams {
  userId: string;
}

export interface UserInfo {
  id: string;
  email: string;
  fullName: string;
  walletBalanceInr: number;
}

/**
 * Retrieves user information by user ID
 * @param params - Object containing userId
 * @returns User info (id, email, fullName)
 */
async function getUser(params: GetUserParams): Promise<UserInfo> {
  const { userId } = params;

  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    walletBalanceInr: Number((user as any).walletBalanceInr || 0),
  };
}

export default {
  getUser,
};
