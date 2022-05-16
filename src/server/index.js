const compression = require('compression')
const config = require('../../config')
const cookieParser = require('cookie-parser')
const csrf = require('csurf')
const express = require('express')
const http = require('http')
const mongoose = require('mongoose')
const multer = require('multer')
const passport = require('passport')
const pjson = require('../../package.json')
const rateLimit = require('express-rate-limit')
const serverm = require('@server/server-manager')
const serveStatic = require('serve-static')
const session = require('express-session')
const MongoStore = require('connect-mongo')(session)
const ua = require('universal-analytics')
const { languages } = require('@client/js/default-vars')

let sessionStore = null
const devEnvironment = process.env.NODE_ENV === 'development'

const loadLocales = () => {
    const locales = {}

    for(let i = 0; i < languages.length; ++i) {
		const languageCode = languages[i].code
		const fileName = languageCode + '.js'

		locales[languageCode] = require('@client/locales/' + fileName)

		console.log('Locale file loaded', fileName)
	}

    return locales
}

const setupDB = () => {
    mongoose.Promise = global.Promise
	mongoose.connect('mongodb://' + config.db.username + ':' + config.db.password +
		'@' + config.db.host + ':' + config.db.port + '/' + config.db.name,
		{
            useCreateIndex: true,
			useFindAndModify: false,
			useNewUrlParser: true,
			useUnifiedTopology: true
        },
		function(error) {
			if(error) {
				console.log(error)
				process.exit(1)
			}
			else {
				console.log('Connection to the database successful.')
			}
		}
	)

	sessionStore = new MongoStore ({
		mongooseConnection: mongoose.connection,
		collection: 'sessions',
		touchAfter: 24 * 3600 // time period in seconds
	})

	sessionStore.on('error', function(error) {
		assert.ifError(error)
		assert.ok(false)
	})
}

const setupPassport = (app) => {
    app.use(passport.initialize())
	app.use(passport.session())

	require('./routes/passport')(passport)
}

const setupApp = async() => {
	const app = express()

	app.use(express.json())
	app.use(express.urlencoded({ extended: true }))
	app.use(cookieParser(config.cookies.secret))
	app.use(compression())
    app.use(session ({
        cookie: {
            secure: !devEnvironment,
            //expires: false,
            //maxAge: 9999999999999999999999999999999999999999
        },
        proxy: !devEnvironment,
		secret: config.cookies.secret,
		store: sessionStore,
		saveUninitialized: false, // don't create session until something stored
		resave: false // don't save session if unmodified
	}))
    app.use(csrf({ cookie: { secure: !devEnvironment }}))
    app.use('/', serveStatic('build/client'))
    app.use((req, res, next) => {
        if(req.csrfToken) {
            res.cookie('XSRF-TOKEN', req.csrfToken(), { secure: !devEnvironment })
        }

        next()
    })

    const storage = multer.memoryStorage()
	const upload = multer({
        storage : storage
	})

    // Trust proxy as server will be behing nginx. Don't forget to add
    // "proxy_set_header X-Forwarded-For $remote_addr" to the nginx conf.
    app.set('trust proxy', 1)
    const apiLimiter = rateLimit({
        windowMs: 2 * 60 * 1000, // 1 minute
        max: 100
    })
    app.use(apiLimiter)

    setupPassport(app)
    await serverm.init()

    const locales = loadLocales()
    const idAnalytics = config.analyticsTrackingId[devEnvironment ? 'test' : 'live']

    // Cookie connect.sid from analytics doesn't have the secure flag
    // and it's causing a warning in Firefox.
    app.use(ua.middleware(idAnalytics, { cookieName: '_ga' }))
	app.use(require('./routes')(express, locales, passport, upload))

    app.use((error, req, res, next) => {
        if(error && error.code == 'EBADCSRFTOKEN') {
            //console.log('Wrong csrf token.', req.url, req.body._csrf)
            res.clearCookie('XSRF-TOKEN')

            if(req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
                res.send({ redirect: '/entrar' })
            }
            else {
                res.redirect('/entrar')
            }
        }
        else if(error){
            next(error)
        }
        else {
            next(req, res)
        }
    })

    const server = http.createServer(app)

    server.listen(config.server.port, () => {
        console.log(
            'Tal Canal server v%s listening at https://%s:%s',
            pjson.version,
            config.server.address,
            config.server.port
        )
    })
}

console.log('Iconica\'s WebBootstrap v%s', pjson.webbootstrapVersion)

setupDB()
setupApp()