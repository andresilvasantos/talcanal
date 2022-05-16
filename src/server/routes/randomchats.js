const randToken = require('rand-token').generator({ chars: 'a-z' })
const sanitizeHtml = require('sanitize-html')
const serverm = require('@server/server-manager')
const template = require('@client/components/root/index.marko')
const { authRequired, processAnalytics, setupHeadersEventSource } = require('@server/utils')
const { models } = require('mongoose')
const { optionsHtmlSanitize } = require('@client/js/default-vars')

const listUsersWaiting = []

module.exports = function(router) {
    router.route('/chatdatreta')
    .get((req, res) => {
        this.render(template, { page: 'randomChat' })
    })

    router.route('/chatdatreta/ping')
	.get(authRequired, async(req, res) => {
        setupHeadersEventSource(res)

        const idUser = req.user._id
        let randomChatTarget

        const randomChatMessageSent = (idChat, message) => {
            if(idChat != randomChatTarget.id || message.user == idUser) {
                return
            }

            // Remove user from message so it can remain completely anonymous.
            const messageClone = {...message}
            delete messageClone.user

            res.write(`data: ${JSON.stringify({
                idChat: randomChatTarget.id,
                message: messageClone
            })}\n\n`)
        }

        const randomChatStarted = (randomChat, idUserPair) => {
            if(idUserPair != idUser) {
                return
            }

            randomChatTarget = randomChat

            res.write(`data: ${JSON.stringify({
                idChat: randomChatTarget.id,
                status: 'started'
            })}\n\n`)

            serverm.off('randomChatStarted', randomChatStarted)
            serverm.on('randomChatMessageSent', randomChatMessageSent)
            serverm.on('randomChatStopped', randomChatStopped)
        }

        const randomChatStopped = (idChat) => {
            if(idChat != randomChatTarget.id) {
                return
            }

            randomChatTarget.status = 1
            randomChatTarget.save()

            res.write(`data: ${JSON.stringify({
                idChat: randomChatTarget.id,
                status: 'stopped'
            })}\n\n`)

            serverm.off('randomChatStopped', randomChatStopped)
            serverm.off('randomChatMessageSent', randomChatMessageSent)
        }

        let pair

        if(listUsersWaiting.includes(idUser)) {
            return res.end()
        }

        for(const [index, idUserPair] of listUsersWaiting.entries()) {
            if(idUser == idUserPair) {
                continue
            }

            // We have a valid pair, remove it from the waiting list.
            pair = idUserPair
            listUsersWaiting.splice(index, 1)
            break
        }

        if(pair) {
            const data = {
                id: randToken.generate(6),
                users: [idUser, pair]
            }
            randomChatTarget = await models.RandomChat.create(data)

            res.write(`data: ${JSON.stringify({
                idChat: randomChatTarget.id,
                status: 'started'
            })}\n\n`)

            serverm.emit('randomChatStarted', randomChatTarget, pair)
            serverm.on('randomChatMessageSent', randomChatMessageSent)
            serverm.on('randomChatStopped', randomChatStopped)
        }
        else {
            listUsersWaiting.push(idUser)

            serverm.on('randomChatStarted', randomChatStarted)
        }

        res.on('close', () => {
            if(listUsersWaiting.includes(idUser)) {
                listUsersWaiting.splice(listUsersWaiting.indexOf(idUser), 1)
            }

            serverm.off('randomChatMessageSent', randomChatMessageSent)
            serverm.off('randomChatStopped', randomChatStopped)
            serverm.off('randomChatStarted', randomChatStarted)

            if(randomChatTarget) {
                serverm.emit('randomChatStopped', randomChatTarget.id)
            }

            res.end()
        })
	})

    router.route('/chatdatreta/:id')
    .post(authRequired, (req, res) => {
        const idChat = req.params.id
        const message = req.body.message

        let userTarget
        let dataMessage

        models.User.findOne({ _id: req.user._id, status: 'active'})
        .exec()
        .then(async(userFound) => {
            if(!userFound) {
                throw { code: 1, message: 'User not found.' }
            }

            userTarget = userFound

            return models.RandomChat.findOne({ id: idChat, users: userTarget })
        })
        .then(randomChat => {
            if(!randomChat) {
                throw { code: 2, message: 'Random chat not found.' }
            }

            dataMessage = {
                id: randToken.generate(6),
                text: sanitizeHtml(message, optionsHtmlSanitize).substring(0, 1000),
                time: Date.now(),
                user: userTarget._id
            }

            randomChat.messages.push(dataMessage)

            return randomChat.save()
        })
        .then(randomChat => {
            serverm.emit('randomChatMessageSent', randomChat.id, dataMessage)
            res.json({ code: 0, id: dataMessage.id })

            processAnalytics(req, 'event', {
                eventCategory: 'randomChat',
                eventAction: 'sendMessage',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(!error.code) {
				error = { code: -1, message: error }
            }

            console.log('Error sending message random chat', error.code, error.message)

            res.json({ code: error.code })
        })
    })
}