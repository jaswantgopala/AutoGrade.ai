import passport from 'passport';
import { googleStrategy } from './google';
import { jwtStrategy } from './jwt';

// initialize passport with Google and JWT strategies
if (googleStrategy) {
	passport.use('google', googleStrategy);
}
passport.use('jwtAuth', jwtStrategy);

export default passport;