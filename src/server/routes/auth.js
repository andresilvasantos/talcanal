const config = require('~/../config')
const randToken = require('rand-token').generator({ chars: '0-9' })
const template = require('@client/components/root/index.marko')
const { authRequired, compileEmail, currentLanguage, processAnalytics, sendEmail } = require('@server/utils')
const { Channel, User } = require('@server/models')
const { urls } = require('@client/js/default-vars')
const { validateUsername, validateEmail } = require('@client/js/utils')

const usernamesBlackList = [
    'admin', 'talcanal', 'home', 'auth', 'sobre', 'privacidade', 'privacy', 'condicoes', 'termos',
    'data', 'dados', 'settings', 'configuracoes', 'lojas', 'loja', 'stores', 'jogos', 'jogo',
    'games', 'talents', 'talentos', 'chuvadestrelas', 'chuvadeestrelas', 'eventos', 'emprego',
    'jobs', 'pages', 'ads', 'publicidade', 'pub', 'splash', 'delete', 'chatdatreta', 'canais',
    'canal', 'otalcanal', 'signup', 'signin', 'login', 'signout', 'entrar', 'sair', 'post', 'link',
    'iframe', 'contacto', 'contact', 'contacts', 'message', 'dashboard', 'signin', 'signout',
    'login', 'logout', 'delete', 'random', 'shuffle', 'press', 'profile', 'perfil', 'user',
    'utilizador', 'media', 'robots.txt', 'robots', 'robot', 'sitemap.xml', 'sitemap', 'analytics',
    'email', 'senha', 'server', 'console', 'recover', 'recuperar', 'theonepixel', 'colorcine',
    'curacine', 'sizemyimg', 'sizemyimage', 'simplista', 'nodebond', 'bitprophet', 'andresantos',
    'ein', 'eindouble', 'figuradestilo', 'almadupla', 'media', 'username', 'key', 'chave', 'file',
    'public', 'publico', 'private', 'privado', 'favorite', 'favorito', 'favorites', 'favoritos',
    'star', 'estrela', 'best', 'melhor', 'top', 'iconica', 'copy', 'copiar', 'listed', 'unlisted',
    'list', 'lista', 'view', 'ver', 'conta'
]

module.exports = function(router, locales, passport) {
    router.route('/entrar')
    .get((req, res) => {
        this.render(template, { page: 'channels', info: 'authRequired' })
	})
	.post((req, res, next) => {
		return passport.authenticate('local-login', (error, user) => {
			if(error) {
				res.json({ code: -1 })
			}
			else if(!user) {
				res.json({ code: 1 })
			}
			else if(user.status == 'pending') {
				res.json({ code: 2 })
			}
            else if(user.status == 'banned') {
				res.json({ code: 3 })
			}
			else {
				req.logIn(user, (error) => {
					if(error) {
						res.json({ code: -2 })
						return next(error)
					}

                    req.session.cookie.maxAge = config.cookies.maxAge
                    //res.cookie('XSRF-TOKEN', req.csrfToken())

                    res.json({ code: 0, user: user.toJSON(true) })
                    processAnalytics(req, 'event', {
                        eventCategory: 'user',
                        eventAction: 'signin',
                        eventLabel: 'success'
                    })
				})
			}
		}) (req, res, next)
	})

    router.route('/registar')
    .post((req, res) => {
        const email = req.body.email
        const password = req.body.password
        const theme = req.body.theme
        const username = req.body.username

        if(!validateUsername(username) || !validateEmail(email)) {
            return res.json({ code: 3 })
        }

        if(usernamesBlackList.includes(username.toLowerCase())) {
            return res.json({ code: 1 })
        }

        let userNew = null
        let channelsDefault = []

        User.findOne({ username : { $regex : new RegExp(username, 'i')}})
        .then((user) => {
            if(user && (user.status != 'pending' || user.email != email)) {
                throw { code: 1, message: 'This username is already linked to an account.' }
            }

            return User.findOne({ email: email })
		})
		.then(async(user) => {
            if(user) {
                if(user.status == 'pending') {
                    user.activationCode = randToken.generate(6)
                    user.password = password

                    return user.save()
                }

                throw { code: 2, message: 'This email is already linked to an account.' }
            }

            channelsDefault = await Channel.find({
                default: true,
                status: 'active',
                type: { $ne: 'private' }
            })

            user = new User({
                activationCode: randToken.generate(6),
                channelsSubscribed: channelsDefault,
                email: email,
                password: password,
                'preferences.theme':  theme,
                username: username,
                status: 'pending'
            })

            return user.save()
		})
		.then((user) => {
            userNew = user

			const language = currentLanguage(req)
			const localesSignUp = locales[language].emails.signUp

            compileEmail('src/server/emails/template-singleaction.mjml', {
                followLink: `${urls.domain}/ativar/${userNew.activationCode}`,
                tr: localesSignUp,
                urls: urls,
                year: (new Date()).getFullYear()
            })
            .then((emailHtml) => {
                sendEmail({
                    from: `Tal Canal <${config.mailGun.sendFrom}>`,
                    to: userNew.email,
                    subject: `${localesSignUp.subject}`,
                    html: emailHtml
                }, (error) => {
                    if(error) {
                        console.log('Error sending email:', error)

                        throw { code: -2, message: 'Problem sending email.' }
                    }

                    for(const channel of channelsDefault) {
                        channel.subscribers.push(userNew._id)
                        channel.save()
                    }

                    res.json({ code: 0 })
                    processAnalytics(req, 'event', {
                        eventCategory: 'user',
                        eventAction: 'signup',
                        eventLabel: 'success'
                    })
                })
            })
            .catch((error) => {
                if(typeof error !== 'object') {
                    error = { code: -1, message: error }
                }

                throw error
            })
		})
		.catch((error) => {
			if(typeof error !== 'object') {
				error = { code: -1, message: error }
			}

            if(userNew) {
                userNew.deleteOne()
            }

			console.log('Error signing up:', error.message)

			return res.json({ code: error.code })
		})
    })

	router.route('/sair')
	.get(authRequired, (req, res, next) => {
		req.logOut()
        req.session.destroy()
		res.redirect('/')
        processAnalytics(req, 'event', {
            eventCategory: 'user',
            eventAction: 'signout',
            eventLabel: 'success'
        })
    })
    .post(authRequired, (req, res, next) => {
		req.logOut()
        req.session.destroy(() => {
            res.clearCookie('XSRF-TOKEN')
            res.clearCookie('connect.sid')
            res.cookie('XSRF-TOKEN', req.csrfToken())

            res.json({ code: 0 })

            processAnalytics(req, 'event', {
                eventCategory: 'user',
                eventAction: 'signout',
                eventLabel: 'success'
            })
        })
    })

    router.route('/ativar/:activationCode')
	.get((req, res) => {
		const activationCode = req.params.activationCode
        let idResult = 'recovered'

		User
        .findOne({
            activationCode: activationCode,
            status: { $in: ['pending', 'active']}
        })
		.then((user) => {
			if(!user) {
				throw { code: -1, message: 'User not found.' }
			}

			return user
		})
		.then((user) => {
			user.activationCode = ''

            if(user.emailTemp && user.emailTemp.length) {
                user.email = user.emailTemp
                user.emailTemp = ''

                idResult = 'newEmail'
            }
            else if(user.status == 'pending') {
                idResult = 'activated'

                user.status = 'active'
            }

			return user.save()
		})
		.then((user) => {
			req.logIn(user, (error) => {
				if(error) {
					throw { code: -2, message: 'Problem logging in.' }
				}

                processAnalytics(req, 'event', {
                    eventCategory: 'user',
                    eventAction: idResult,
                    eventLabel: 'success'
                })

                req.session.cookie.maxAge = config.cookies.maxAge
                this.global.loggedUser = user.toJSON(true)

                this.render(template, { page: 'channels', info: idResult })
			})
		})
		.catch((error) => {
			if(typeof error !== 'object') {
				error = { code: -1, message: error }
			}

			console.log('Error activating account:', error.message)

			this.render(template, { page: 'error' })
		})
	})

    router.route('/recuperar')
	.post((req, res) => {
		const idUser = req.body.idUser

        User
        .findOne({ status: 'active' }).or([{ email: idUser }, { username: idUser }])
        .then((user) => {
            if(!user) {
                throw { code: 1, message: 'No user is linked to this email / username.' }
            }

            user.activationCode = randToken.generate(6)

            return user.save()
		})
        .then(user => {
            const language = currentLanguage(req)
			const localesRecover = locales[language].emails.recover

            compileEmail('src/server/emails/template-singleaction.mjml', {
                followLink: `${urls.domain}/recuperar/${user.activationCode}`,
                tr: localesRecover,
                urls: urls,
                year: (new Date()).getFullYear()
            })
            .then((emailHtml) => {
                sendEmail({
                    from: `Tal Canal <${config.mailGun.sendFrom}>`,
                    to: user.email,
                    subject: `${localesRecover.subject}`,
                    html: emailHtml
                }, (error) => {
                    if(error) {
                        console.log('Error sending email:', error)

                        throw { code: -2, message: 'Problem sending email.' }
                    }

                    processAnalytics(req, 'event', {
                        eventCategory: 'user',
                        eventAction: 'recover',
                        eventLabel: 'success'
                    })

                    res.json({ code: 0 })
                })
            })
            .catch((error) => {
                if(typeof error !== 'object') {
                    error = { code: -1, message: error }
                }

                throw error
            })
        })
        .catch((error) => {
			if(typeof error !== 'object') {
				error = { code: -1, message: error }
			}

			console.log('Error setting account recovery:', error.message)

            res.json({ code: error.code })
		})
	})

    router.route('/recuperar/:recoverCode')
	.get((req, res) => {
		const recoverCode = req.params.recoverCode

		User
        .findOne({ activationCode: recoverCode, status: 'active' })
		.then(user => {
			if(!user) {
				throw { code: -1, message: 'User not found.' }
			}

			return user
		})
		.then(user => {
			user.activationCode = ''

			return user.save()
		})
		.then(user => {
			req.logIn(user, (error) => {
				if(error) {
					throw { code: -2, message: 'Problem logging in.' }
				}

                processAnalytics(req, 'event', {
                    eventCategory: 'user',
                    eventAction: 'recoverAccount',
                    eventLabel: 'success'
                })

                req.session.cookie.maxAge = config.cookies.maxAge
                this.global.loggedUser = user.toJSON(true)

                this.render(template, { page: 'channels', info: 'recovered' })
			})
		})
		.catch((error) => {
			if(typeof error !== 'object') {
				error = { code: -1, message: error }
			}

			console.log('Error recovering account:', error.message)

			this.render(template, { page: 'error' })
		})
	})
}
