import { Strategy as GoogleStrategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import User from '../database/models/userModel'; // mock user class
import { v4 as uuidv4 } from 'uuid';
import { encryptToken } from '../utils/encryption';

export const isGoogleOAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

const options = {
  clientID: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  callbackURL: process.env.GOOGLE_CALLBACK_URL || `https://autograde-ai-9zve.onrender.com/api/auth/google/callback`,
  accessType: 'offline',
  prompt: 'consent',
};

async function verify(accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) {
  try {
    // we check for if the user is present in our system/database.
    // which states that; is that a sign-up or sign-in?
    let user = await User.findOne({ googleId: profile.id });
    if (!user) {
      const email = profile.emails?.[0]?.value;
      if (email) {
        const existingByEmail = await User.findOne({ email });
        if (existingByEmail) {
          existingByEmail.googleId = profile.id;
          user = await existingByEmail.save();
        }
      }

      // create new user if still doesn't exist
      if (!user) {
        user = await User.create({
          googleId: profile.id,
          email,
          fullName: profile.displayName,
          jwtSecureCode: uuidv4(),
        });
      }
    }

    // Persist Google OAuth tokens encrypted so protected Google APIs can be called later.
    user.googleAccessToken = encryptToken(accessToken);
    if (refreshToken) {
      user.googleRefreshToken = encryptToken(refreshToken);
    }
    await user.save();

    // auth the User
    return done(null, user);
  } catch (error) {
    return done(error as Error);
  }
}

if (!isGoogleOAuthConfigured) {
  console.warn(
    'Google OAuth is disabled. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.'
  );
}

export const googleStrategy = isGoogleOAuthConfigured
  ? new GoogleStrategy(options, verify)
  : undefined;
export default googleStrategy;
