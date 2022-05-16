const LocalStrategy = require('passport-local').Strategy
const { User } = require('@server/models')

module.exports = function(passport) {

    /**
     * Passport session setup.
     *
     * required for persistent login sessions
     * passport needs ability to serialize and unserialize users out of session
     */

	passport.serializeUser((user, done) => {
		done(null, user)
	})

	passport.deserializeUser((obj, done) => {
		done(null, obj)
	})

    /**
     * Local login.
     */

	passport.use('local-login', new LocalStrategy({
		usernameField : 'idUser',
		passwordField : 'password'
	},
	(idUser, password, done) => {
		process.nextTick(() => {
            User.authenticate(idUser, password, (error, user) => {
                if(error && error.code < 0) {
                    return done(error)
    			}
                else if(error) {
                    return done(null, null)
                }
                else {
                    return done(null, user)
                }
            })
		})
    }))
}
