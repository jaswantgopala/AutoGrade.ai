import { Request, Response, Router } from 'express';
import passport from '../auth/passport';  // import passport from our custom passport file
import * as AuthService from '../services/AuthService';  // assuming you have a service
import type { User } from '../database/models/userModel';
import UserModel from '../database/models/userModel';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const GOOGLE_AUTH_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.addons.student',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
];

const GOOGLE_AUTH_OPTIONS = {
  scope: GOOGLE_AUTH_SCOPES,
  accessType: 'offline' as const,
  prompt: 'consent' as const,
  includeGrantedScopes: true,
};

// Local login and signup have been removed for security reasons.
// Users must authenticate via Google OAuth2.0.

/*
  This route triggers the Google sign-in/sign-up flow. 
  When the frontend calls it, the user will be redirected to the 
  Google accounts page to log in with their Google account.
*/
// Google OAuth2.0 route
router.get('/google', passport.authenticate('google', GOOGLE_AUTH_OPTIONS));

// Google signup route (same OAuth flow, explicit endpoint for frontend)
router.get('/google/signup', passport.authenticate('google', GOOGLE_AUTH_OPTIONS));


/*
  This route is the callback endpoint for Google OAuth2.0. 
  After the user logs in via Google's authentication flow, they are redirected here.
  Passport.js processes the callback, attaches the user to req.user, and we handle 
  the access token generation and redirect the user to the frontend.
*/
// Google OAuth2.0 callback route
router.get('/google/callback', passport.authenticate('google', { session: false }), (req: Request, res: Response) => {
  try {
    const user = req.user as User;

    // handle the google callback, generate auth token
    const { authToken } = AuthService.handleGoogleCallback({ id: user.id, jwtSecureCode: user.jwtSecureCode });

    // redirect to frontend with the accessToken as query param
    const baseFrontendUrl = process.env.FE_BASE_URL || `${process.env.BE_BASE_URL || 'http://localhost:3000'}/test`;
    const separator = baseFrontendUrl.includes('?') ? '&' : '?';
    const redirectUrl = `${baseFrontendUrl}${separator}accessToken=${encodeURIComponent(authToken)}`;
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Google callback error:', error);
    return res.status(500).json({ message: 'An error occurred during authentication' });
  }
});

export default router;