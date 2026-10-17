import { Strategy, ExtractJwt, VerifiedCallback } from 'passport-jwt';
import User from '../database/models/userModel'; // mock user class

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error(
    'JWT_SECRET environment variable is required. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
  );
}

const options = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: jwtSecret,
};

async function verify(payload: any, done: VerifiedCallback) {
  /* 
    a valid JWT in our system must have `id` and `jwtSecureCode`.
    you can create your JWT like the way you like.
  */
  // bad path: JWT is not valid
  if (!payload?.id || !payload?.jwtSecureCode) {
    return done(null, false);
  }

  // try to find a User with the `id` in the JWT payload.
  const user = await User.findById(payload.id);

  // bad path: User is not found.
  if (!user) {
    return done(null, false);
  }

  // compare User's jwtSecureCode with the JWT's `jwtSecureCode` that the 
  // request has.
  // bad path: bad JWT, it sucks.
  if (user.jwtSecureCode !== payload.jwtSecureCode) {
    return done(null, false);
  }

  // happy path: JWT is valid, we auth the User.
  return done(null, user);
}

export const jwtStrategy = new Strategy(options, verify);
export default jwtStrategy;