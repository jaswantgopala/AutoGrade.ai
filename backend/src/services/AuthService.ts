import jwt from 'jsonwebtoken';

export interface GoogleCallbackPayload {
  id: string;
  jwtSecureCode: string;
}

export interface AuthResponse {
  authToken: string;
}

/**
 * Generates a JWT token for a user
 * @param payload - User data to encode in the token (id and jwtSecureCode)
 * @returns JWT token string
 */
export function generateToken(payload: GoogleCallbackPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required.');
  }
  const token = jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_EXPIRY || '7d') as string | number,
  } as any);
  return token;
}

/**
 * Handles the Google OAuth callback
 * Generates and returns an auth token for the user
 * @param payload - User data (id and jwtSecureCode)
 * @returns Object containing the authToken
 */
export function handleGoogleCallback(payload: GoogleCallbackPayload): AuthResponse {
  const authToken = generateToken(payload);
  return {
    authToken,
  };
}
