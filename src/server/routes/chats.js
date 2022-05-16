const randToken = require('rand-token').generator({ chars: 'a-z' })
const sanitizeHtml = require('sanitize-html')
const serverm = require('@server/server-manager')
const template = require('@client/components/root/index.marko')
const { authRequired, processAnalytics, setupHeadersEventSource } = require('@server/utils')
const { models } = require('mongoose')
const { optionsHtmlSanitize } = require('@client/js/default-vars')

module.exports = function(router) {
    const createMessage = async(chat, text, user, notificationsDisabled) => {
        dataMessage = {
            id: randToken.generate(6),
            chat: chat._id,
            sender: user._id,
            text: text,
            time: Date.now()
        }

        // Create message and update messageLast.
        const message = await models.Message.create(dataMessage)
        chat.messages.push(message._id)
        chat.messageLast = message._id

        await chat.save()

        // Update messagesNew for the other user.
        let userPair

        for(const userOfChat of chat.users) {
            if(userOfChat._id != user._id) {
                userPair = userOfChat
                break
            }
        }

        const usersBlocked = userPair.usersBlocked || []

        // Emit message if user is not blocked and notifications are enabled.
        if(!usersBlocked.includes(user._id) && !notificationsDisabled) {
            // Emit the message so other user can receive realtime.
            // If it receives, a sent flag will be added to the message.
            serverm.emit('chatMessageSent', chat.id, message)

            if(!message.sent && userPair) {
                let found = false

                for(const chatCounter of userPair.messagesNew) {
                    if(String(chatCounter.chat) == chat._id) {
                        ++chatCounter.count
                        found = true

                        break
                    }
                }

                if(!found) {
                    userPair.messagesNew.push({ chat: chat._id, count: 1 })
                }

                userPair.save()
            }
        }

        // Remove messagesNew, we don't need it that info anymore.
        for(const userOfChat of chat.users) {
            delete userOfChat.messagesNew
        }

        return message
    }

    router.route('/conversas')
	.get(authRequired, (req, res) => {
        this.render(template, { page: 'chats' })
	})
    .post(authRequired, async(req, res) => {
        const dataReq = req.body.data || {}
        let textMessage = dataReq.message || ''
        const username = dataReq.user

        if(textMessage.length) {
            textMessage = sanitizeHtml(textMessage, optionsHtmlSanitize).substring(0, 1000)

            if(!textMessage.length) {
                return res.json({ code: -4 })
            }
        }

        const user = await models.User
            .findOne({ _id: req.user._id, status: 'active' })
            .populate('chats.chat')

        if(!user || user.username == username) {
            return res.json({ code: -2 })
        }

        const userToChat = await models.User.findOne({ username: username, status: 'active' })

        if(!userToChat) {
            return res.json({ code: -3 })
        }

        // Check if chat already exists.
        const chatCreated = await models.Chat
            .findOne({ users: { $all: [req.user._id, userToChat._id]}})
            .populate('users', 'image messagesNew username usersBlocked')
            .populate('messageLast')
            .exec()

        if(chatCreated) {
            let notificationsDisabled = false

            for(const chatObj of user.chats) {
                if(chatObj.chat.id == chatCreated.id) {
                    notificationsDisabled = chatObj.notificationsDisabled

                    if(chatObj.status == 'removed') {
                        chatObj.status = 'active'
                        user.save()
                    }

                    break
                }
            }

            if(textMessage.length) {
                createMessage(chatCreated, textMessage, req.user, notificationsDisabled)
            }

            return res.json({ code: 1, chat: chatCreated })
        }

        const data = {
            id: randToken.generate(6),
            creator: user._id,
            users: [user._id, userToChat._id]
        }

        models.Chat.create(data)
        .then(async(chat) => {
            chat = await chat
                .populate('users', 'image messagesNew username usersBlocked')
                .execPopulate()

            user.chats.push({ chat: chat._id, status: 'active' })

            let status = 'active'

            if(userToChat.usersBlocked.includes(user._id)) {
                status = 'removed'
            }

            userToChat.chats.push({ chat: chat._id, status })

            user.save()
            userToChat.save()

            if(textMessage.length) {
                createMessage(chat, textMessage, req.user, false)
            }

            chat = chat.toJSON()

            res.json({ code: 0, chat: chat })

            processAnalytics(req, 'event', {
                eventCategory: 'chat',
                eventAction: 'create',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(!error.code) {
				error = { code: -1, message: error }
            }

            console.log('Error creating chat', error.code)

            res.json({ code: error.code })
        })
    })
    .delete(authRequired, async(req, res) => {
        const ids = req.query.ids || []

        const user = await models.User
            .findOne({ _id: req.user._id, status: 'active' })
            .populate('chats.chat')

        if(!user) {
            return res.json({ code: -2 })
        }

        for(const chatObj of user.chats) {
            if(ids.includes(chatObj.chat.id)) {
                chatObj.status = 'removed'

                foundChat = true
            }
        }

        if(!foundChat) {
            return res.json({ code: 1 })
        }

        user.save()
        res.json({ code: 0 })
        processAnalytics(req, 'event', {
            eventCategory: 'chat',
            eventAction: 'delete',
            eventLabel: 'success'
        })
    })

    router.route('/conversas/:id')
	.get(authRequired, async(req, res) => {
        const idChat = req.params.id

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return this.render(template, { page: 'error' })
        }

        let chat = await models.Chat
            .findOne({ id: idChat, users: req.user._id })
            .populate('users', 'username image')
            .exec()

        if(!chat) {
            return this.render(template, { page: 'error' })
        }

        chat = chat.toJSON()

        for(const chatObj of user.chats) {
            if(String(chatObj.chat) == String(chat._id)) {
                chat.notificationsDisabled = chatObj.notificationsDisabled
                break
            }
        }

        this.render(template, { page: 'chats', pane: 'chat', data: chat })
	})
    .post(authRequired, (req, res) => {
        const idChat = req.params.id
        let textMessage = req.body.message

        textMessage = sanitizeHtml(textMessage, optionsHtmlSanitize).substring(0, 1000)

        if(!textMessage.length) {
            throw { code: 2, message: 'Message is empty.' }
        }

        models.Chat.findOne({ id: idChat, users: req.user._id })
        .populate('users')
        .exec()
        .then(async(chat) => {
            if(!chat) {
                throw { code: 1, message: 'Chat not found.' }
            }

            // Find user pair and check if it has notifications disabled.
            let notificationsDisabled = false
            let userPair

            for(const userOfChat of chat.users) {
                if(userOfChat._id != req.user._id) {
                    userPair = userOfChat
                    break
                }
            }

            for(const chatObj of userPair.chats) {
                if(chatObj.chat == String(chat._id)) {
                    notificationsDisabled = chatObj.notificationsDisabled
                }
            }

            const message = await createMessage(chat, textMessage, req.user, notificationsDisabled)

            res.json({ code: 0, message: message })
            processAnalytics(req, 'event', {
                eventCategory: 'chat',
                eventAction: 'sendMessage',
                eventLabel: 'success'
            })
        })
        .catch((error) => {
            if(!error.code) {
				error = { code: -1, message: error }
            }

            console.log('Error sending message chat', error.code, error.message)

            res.json({ code: error.code })
        })
    })

    router.route('/conversas/:id/ping')
	.get(authRequired, async(req, res) => {
        setupHeadersEventSource(res)

        const idChat = req.params.id
        const idUser = req.user._id
        const chat = await models.Chat.findOne({ id: idChat, users: idUser })

        if(!chat) {
            return res.end()
        }

        const chatMessageSent = (idChat, message) => {
            if(idChat != chat.id || message.sender == idUser) {
                return
            }

            message.sent = true

            res.write(`data: ${JSON.stringify({
                idChat,
                message
            })}\n\n`)
        }

        serverm.on('chatMessageSent', chatMessageSent)

        res.on('close', () => {
            serverm.off('chatMessageSent', chatMessageSent)

            res.end()
        })
	})
}