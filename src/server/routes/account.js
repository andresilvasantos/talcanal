const bcrypt = require('bcryptjs')
const channelsm = require('@server/channels-manager')
const config = require('~/../config')
const randToken = require('rand-token').generator({ chars: '0-9' })
const sanitizeHtml = require('sanitize-html')
const serverm = require('@server/server-manager')
const template = require('@client/components/root/index.marko')
const {
    authRequired,
    compileEmail,
    currentLanguage,
    deleteFromSpaces,
    processAnalytics,
    sendEmail,
    setupHeadersEventSource
} = require('@server/utils')
const { sizesMedia, timers } = require('@server/default-vars')
const { urls } = require('@client/js/default-vars')
const { User } = require('@server/models')
const { validateEmail } = require('@client/js/utils')

module.exports = function(router, locales) {
    router.route('/conta')
	.get(authRequired, (req, res) => {
        this.render(template, { page: 'settings' })
	})
    .patch(authRequired, (req, res) => {
        const idUser = req.user._id
        const patch = req.body.data
        let userTarget

        User
            .findOne({ _id: idUser })
            .select('+password')
            .populate('chats.chat')
            .exec()
        .then((user) => {
            if(!user) {
                throw { code: -1 }
            }

            userTarget = user
            userTarget.emailTemp = ''
            userTarget.activationCode = ''
        })
        .then(() => {
            if(patch.hasOwnProperty('email') && userTarget.email != patch.email) {
                if(!validateEmail(patch.email)) {
                    throw { code: 1 }
                }

                // Check if email is already linked.
                return User.findOne({ email: patch.email }).exec()
                .then((userOther) => {
                    if(userOther) {
                        throw { code: 2 }
                    }

                    userTarget.emailTemp = patch.email
                    userTarget.activationCode = randToken.generate(6)
                })
                .catch(error => {
                    throw error
                })
            }
        })
        .then(() => {
            if(patch.hasOwnProperty('password')) {
                userTarget.password = patch.password
            }

            if(patch.hasOwnProperty('image')) {
                if(userTarget.image && userTarget.image.length) {
                    const nameFiles = []

                    sizesMedia.square.map((size) => {
                        nameFiles.push(`${userTarget.image}${size.tag ? '-' + size.tag : ''}.jpg`)
                    })

                    deleteFromSpaces(nameFiles)
                }

                userTarget.image = patch.image

                if(userTarget.image.length) {
                    serverm.claimMedia([userTarget.image])
                }
            }

            if(patch.bio) {
                userTarget.bio = sanitizeHtml(
                    patch.bio,
                    { allowedTags: ['br']}
                ).replace(/(<br\s*\/?>){3,}/gi, '<br><br>').substring(0, 320)
            }

            if(patch.hasOwnProperty('preferences')) {
                userTarget.preferences = Object.assign(userTarget.preferences, patch.preferences)
            }

            if(patch.hasOwnProperty('usersBlocked')) {
                userTarget.usersBlocked = []

                for(const user of patch.usersBlocked) {
                    userTarget.usersBlocked.push(user._id)
                }
            }

            if(patch.hasOwnProperty('superActive')) {
                if(!userTarget.super) {
                    throw { code: 3 }
                }

                userTarget.superActive = patch.superActive
            }

            if(patch.hasOwnProperty('chat')) {
                const chatToPatch = patch.chat || {}
                const id = chatToPatch.id
                const notificationsDisabled = chatToPatch.notificationsDisabled

                let found = false

                for(const chatObj of userTarget.chats) {
                    if(chatObj.chat.id == id) {
                        found = true
                        chatObj.notificationsDisabled = notificationsDisabled

                        break
                    }
                }

                if(!found) {
                    throw { code: 4 }
                }
            }

            return userTarget.save()
        })
        .then(async(userTarget) => {
            userTarget = await userTarget
                .populate('usersBlocked', 'image username')
                .execPopulate()

            return req.logIn(userTarget.toJSON(true), (error) => {
                req.session.cookie.maxAge = config.cookies.maxAge
            })
        })
        .then(() => {
            if(patch.hasOwnProperty('email') && userTarget.email != patch.email) {
                const language = currentLanguage(req)
                const localesEmailConfirmation = locales[language].emails.emailConfirmation

                compileEmail('src/server/emails/template-singleaction.mjml', {
                    followLink: `${urls.domain}/ativar/${userTarget.activationCode}`,
                    tr: localesEmailConfirmation,
                    urls: urls,
                    year: (new Date()).getFullYear()
                })
                .then((emailHtml) => {
                    sendEmail({
                        from: `Tal Canal <${config.mailGun.sendFrom}>`,
                        to: userTarget.emailTemp,
                        subject: `${localesEmailConfirmation.subject}`,
                        html: emailHtml
                    }, (error) => {
                        if(error) {
                            console.log('Error sending email:', error)

                            throw { code: -2, message: 'Problem sending email.' }
                        }

                        res.json({ code: 0, user: userTarget, verifyEmail: true })
                    })
                })
                .catch((error) => {
                    if(typeof error !== 'object') {
                        error = { code: -1, message: error }
                    }

                    throw error
                })
            }
            else {
                const countNotificationsNew = userTarget.notificationsNew.length
                const messagesNew = userTarget.messagesNew

                userTarget = userTarget.toJSON(true)

                userTarget.countNotificationsNew = countNotificationsNew
                userTarget.messagesNew = messagesNew

                res.json({ code: 0, user: userTarget })
            }

            processAnalytics(req, 'event', {
                eventCategory: 'user',
                eventAction: 'patch',
                eventLabel: 'success'
            })
        })
        .catch((error) => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error updating account:', error.message)

            res.json({ code: error.code })
        })
    })
	.delete(authRequired, (req, res) => {
        const idUser = req.user._id
        const password = req.query.password

        let userToDelete

        User.findOne({ _id: idUser }).select('+password').exec()
        .then((user) => {
            if(!user) {
				throw { code: -1, message: 'User not found.' }
			}

            userToDelete = user

            return bcrypt.compare(password, user.password)
        })
        .then((result) => {
            if(!result) {
                throw { code: 1, message: 'Wrong password.' }
            }

            userToDelete.status = 'removed'

            // So the same email can be used for future accounts.
            userToDelete.emailTemp = userToDelete.email
            userToDelete.email = `${userToDelete.username}+${userToDelete.email}`

            return userToDelete.save()
        })
        .then(() => {
            req.logOut()
            req.session.destroy()

            res.json({ code: 0 })
            processAnalytics(req, 'event', {
                eventCategory: 'user',
                eventAction: 'delete',
                eventLabel: 'success'
            })
        })
        .catch((error) => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error deleting account:', error.message)

            res.json({ code: error.code })
        })
	})

    router.route('/conta/ping')
	.get(authRequired, (req, res) => {
        setupHeadersEventSource(res)

        let closed = false

        const pingAccount = () => {
            User.findOne({ _id: req.user._id })
            .populate('channelsModerator', 'id')
            .exec()
            .then((user) => {
                if(!user) {
                    throw { code: 1, message: 'User not found.' }
                }

                if(closed) {
                    return
                }

                const data = {
                    countNotificationsNew: user.notificationsNew ? user.notificationsNew.length : 0,
                    karma: user.karma,
                    messagesNew: user.messagesNew,
                    status: user.status
                }

                if(user.channelsModerator.length) {
                    const infoChannelsMod = {}

                    for(const channel of user.channelsModerator) {
                        const info = channelsm.getChannelInfo(channel.id)

                        if(Object.keys(info).length) {
                            infoChannelsMod[channel.id] = info
                        }
                    }

                    data.infoChannelsMod = infoChannelsMod
                }

                res.write(`data: ${JSON.stringify(data)}\n\n`)
            })
            .catch((error) => {})
        }

        const clearedMessagesNew = (user) => {
            if(user._id != req.user._id) {
                return
            }

            pingAccount()
        }

        const clearedNotificationsNew = (user) => {
            if(user._id != req.user._id) {
                return
            }

            pingAccount()
        }

        pingAccount()

        const intervalPing = setInterval(() => {
            pingAccount()
        }, timers.pingAccount)

        serverm.on('clearedMessagesNew', clearedMessagesNew)
        serverm.on('clearedNotificationsNew', clearedNotificationsNew)

        res.on('close', () => {
            closed = true

            clearInterval(intervalPing)
            serverm.off('clearedMessagesNew', clearedMessagesNew)
            serverm.off('clearedNotificationsNew', clearedNotificationsNew)
            res.end()
        })
	})

    router.route('/notificacoes')
	.get(authRequired, (req, res) => {
        this.render(template, { page: 'notifications' })
	})

    // Not used but it might be useful.
    /* router.route('/notificacoes/visto')
    .post(authRequired, (req, res) => {
        models.User.findOne({ _id: req.user._id, status: 'active'})
        .exec()
        .then((user) => {
            if(!user) {
                throw { code: -2, message: 'No user found' }
            }

            user.notificationsNew = []

            user.save()
        })
        .then((user) => {
            res.json({ code: 0 })
        })
        .catch((error) => {
            if(!error.code) {
				error = { code: -1, message: error }
            }

            console.log('Error clearing new notifications', error.code, error.message)

            res.json({ code: error.code })
        })
    }) */
}
