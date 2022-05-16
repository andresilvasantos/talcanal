const channelsm = require('@server/channels-manager')
const mongoose = require('mongoose')
const randToken = require('rand-token').generator({ chars: 'a-z' })
const sanitizeHtml = require('sanitize-html')
const serverm = require('@server/server-manager')
const template = require('@client/components/root/index.marko')
const { authRequired, deleteFromSpaces, prepareLink, processAnalytics, removeAccents, setupHeadersEventSource } = require('@server/utils')
const { models } = require('mongoose')
const { maxChannelAdmins, maxChannelMods, maxChannelSubscriptions, maxImages, maxOptionsPoll, maxRules, maxTags, maxTriggersAutoMod, optionsHtmlSanitize } = require('@client/js/default-vars')
const { sizesMedia, timers } = require('@server/default-vars')
const { extractHostName, prepareUrl, validateChannelId, validateChannelName, validatePostTitle, validateUrl } = require('@client/js/utils')

const channelIdsBlackList = [
    'populares', 'canais', 'canal', 'todos', 'moderados', 'moderacao',
    'moderador', 'subscrito', 'subscritos', 'subscritor', 'definicoes', 'configuracoes',
    'omelhordeportugal', 'all', 'popular', 'myChannels', 'sub', 'mod', 'melhor', 'admin', 'post',
    'comentario', 'comentarios', 'procura', 'procurar', 'sondagem', 'votar', 'favoritar',
    'favoritos', 'denunciar', 'membro', 'clube', 'grupo', 'banir', 'utilizador', 'super'
]

const actionToStatus = (action) => {
    switch(action) {
        case 'queue':
            return 'submitted'
        case 'publish':
            return 'published'
        case 'approve':
            return 'approved'
        case 'reject':
            return 'autorejected'
    }
}

const modKarma = (trigger, user, data) => {
    const compareType = trigger.value.slice(0, 1)
    const value = trigger.value.slice(1)

    switch(compareType) {
        case '<':
            if(user.karma < value) {
                data.status = actionToStatus(trigger.action)
            }
            break
        case '>':
            if(user.karma > value) {
                data.status = actionToStatus(trigger.action)
            }
            break
    }
}

const modAge = (trigger, user, data) => {
    const compareType = trigger.value.slice(0, 1)
    const value = trigger.value.slice(1)
    const now = new Date()
    const createdAt = new Date(user.createdAt)
    const oneDay = 24 * 60 * 60 * 1000
    const countDays = Math.round(Math.abs((now - createdAt) / oneDay))

    switch(compareType) {
        case '<':
            if(countDays < value) {
                data.status = actionToStatus(trigger.action)
            }
            break
        case '>':
            if(countDays > value) {
                data.status = actionToStatus(trigger.action)
            }
            break
    }
}

const sendNotification = async(data) => {
    const notification = await models.Notification.create(data)
    await models.User.updateOne({ _id: data.receiver }, {
        $push: { notifications: notification._id, notificationsNew: notification._id }
    })
}

const testNotificationUpvotes = async(item, idUser) => {
    let type

    if(item instanceof models.Post) {
        type = 'postUpvotes'
    }
    else if(item instanceof models.Comment) {
        type = 'commentUpvotes'
    }

    if(!type) {
        return
    }

    const countVotes = item.votes.up.length - item.votes.down.length - 1

    // Minimum for notification.
    if(countVotes < 10) {
        return
    }

    const steps = [10, 50, 100, 500, 1000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]
    let stepToNotify = 0

    for(const step of steps) {
        if(countVotes < step) {
            break
        }

        stepToNotify = step
    }

    const match = {
        countVotes: stepToNotify,
        receiver: idUser,
        type
    }

    if(type == 'postUpvotes') {
        match.post = item._id
    }
    else if(type == 'commentUpvotes') {
        match.comment = item._id
    }

    const notification = await models.Notification.findOne(match)

    if(notification) {
        return
    }

    const data = {
        countVotes: stepToNotify,
        receiver: idUser,
        type
    }

    if(type == 'postUpvotes') {
        data.channel = item.channel._id
        data.post = item._id
    }
    else if(type == 'commentUpvotes') {
        data.channel = item.post.channel._id
        data.comment = item._id
        data.post = item.post._id
    }

    sendNotification(data)
}

module.exports = function(router) {
    /*
        CHANNELS.
    */

    router.route('/canais')
	.get((req, res) => {
        this.render(template, { page: 'channels' })
	})

    router.route('/explorar')
	.get((req, res) => {
        this.render(template, { page: 'channels', pane: 'explore' })
	})

    router.route('/c/canal')
    .post(authRequired, (req, res) => {
        const dataReq = req.body.data || {}
        const id = dataReq.id
        const adultContent = dataReq.adultContent
        const name = dataReq.name || ''
        const type = dataReq.type

        let channelTarget
        let userTarget

        models.User.findOne({ _id: req.user._id, status: 'active'})
        .exec()
        .then(async(userFound) => {
            if(!userFound) {
                throw { code: -2 }
            }

            userTarget = userFound

            // Check if user is creating channels too much.
            const countChannelsLast24h = await models.Channel.countDocuments({
                createdAt: { $gt: Date.now() - 1000 * 60 * 60 * 24 },
                creator: userTarget._id
            })

            if(countChannelsLast24h >= 2 && (!userTarget.super || !userTarget.superActive)) {
                throw { code: 21, message: 'Too much channel creation' }
            }

            if(!validateChannelId(id) || channelIdsBlackList.includes(id)) {
                throw { code: 1 }
            }

            if(name && !validateChannelName(name)) {
                throw { code: -3 }
            }

            const data = {
                id,
                admins: [userTarget._id],
                adultContent,
                creator: userTarget._id,
                name,
                status: 'active',
                subscribers: [userTarget._id],
                type
            }

            return models.Channel.create(data)
        })
        .then(channel => {
            channelTarget = channel

            userTarget.channelsModerator.push(channel._id)
            userTarget.channelsSubscribed.push(channel._id)

            return userTarget.save()
        })
        .then(async(user) => {
            channelTarget = await channelTarget.populate('admins', 'image username').execPopulate()

            channelTarget = channelTarget.toJSON()

            channelTarget.isUserAdmin = true
            channelTarget.isUserModerator = true
            channelTarget.isUserSubscribed = true

            channelsm.channelCreated(channelTarget.id)

            res.json({ code: 0, channel: channelTarget })
            processAnalytics(req, 'event', {
                eventCategory: 'channel',
                eventAction: 'create',
                eventLabel: channelTarget.id
            })
        })
        .catch(error => {
            if(!error.code) {
				error = { code: -1, message: error }
            }
            else if(error.code === 11000) {
                error = { code: 1 }
            }

            console.log('Error creating channel', error.code, error.message)

            res.json({ code: error.code })
        })
    })
    .patch(authRequired, async(req, res) => {
        const idChannel = req.body.id
        const patch = req.body.data

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            res.json({ code: -1 })
        }

        const findObj = { id: idChannel }

        if(!user.super || !user.superActive) {
            findObj.admins = req.user._id
        }

        models.Channel.findOne(findObj).exec()
        .then(channel => {
            if(!channel) {
                throw { code: -2, message: 'Channel not found.' }
            }

            if(patch.hasOwnProperty('type')) {
                const wasPublic = channel.type != 'private'
                const wasPrivate = channel.type == 'private'

                switch(patch.type) {
                    case 'public':
                    case 'restricted':
                    case 'private':
                        channel.type = patch.type
                        break
                }

                // Clear member requests if no longer private.
                if(wasPrivate) {
                    for(const memberRequest of channel.memberRequests) {
                        channelsm.removedUserChannelRequest(channel.id)
                    }

                    channel.memberRequests = []
                }

                // Update posts if channel visibility has changed.
                if((wasPublic && channel.type == 'private') ||
                    (wasPrivate && channel.type != 'private')) {

                    models.Post.updateMany(
                        { channel: channel._id },
                        { $set: { public: !wasPublic }},
                        { upsert: false, multi: true }
                    ).exec()
                }
            }

            if(patch.hasOwnProperty('name')) {
                if(!validateChannelName(patch.name)) {
                    throw { code: -3, message: 'Invalid name.' }
                }

                channel.name = patch.name
            }

            if(patch.hasOwnProperty('description')) {
                channel.description = sanitizeHtml(
                    patch.description,
                    { allowedTags: ['br']}
                ).replace(/(<br\s*\/?>){3,}/gi, '<br><br>').substring(0, 320)
            }

            if(patch.hasOwnProperty('image')) {
                if(channel.image && channel.image.length) {
                    const nameFiles = []

                    sizesMedia.square.map((size) => {
                        nameFiles.push(`${channel.image}${size.tag ? '-' + size.tag : ''}.jpg`)
                    })

                    deleteFromSpaces(nameFiles)
                }

                channel.image = patch.image

                if(channel.image.length) {
                    serverm.claimMedia([channel.image])
                }
            }

            if(patch.hasOwnProperty('adultContent')) {
                channel.adultContent = patch.adultContent
            }

            if(patch.hasOwnProperty('preferences')) {
                channel.preferences = patch.preferences

                if(channel.type == 'private' && !channel.preferences.acceptRequests) {
                    for(const memberRequest of channel.memberRequests) {
                        channelsm.removedUserChannelRequest(channel.id)
                    }

                    channel.memberRequests = []
                }
            }

            if(patch.hasOwnProperty('admins') && patch.hasOwnProperty('moderators')) {
                // Update admins.
                const adminsOld = channel.admins
                const adminsAdded = []
                channel.admins = []

                if(patch.admins.length > maxChannelAdmins) {
                    throw { code: -16, message: 'Admins limit reached.' }
                }

                for(const admin of patch.admins) {
                    if(!adminsOld.includes(admin._id)) {
                        adminsAdded.push(admin._id)
                    }
                    else {
                        adminsOld.splice(adminsOld.indexOf(admin._id), 1)
                    }

                    channel.admins.push(admin._id)
                }

                // Update mods.
                const modsOld = channel.moderators
                const modsAdded = []
                channel.moderators = []

                if(patch.moderators.length > maxChannelMods) {
                    throw { code: -17, message: 'Mods limit reached.' }
                }

                for(const mod of patch.moderators) {
                    if(!modsOld.includes(mod._id)) {
                        modsAdded.push(mod._id)
                    }
                    else {
                        modsOld.splice(modsOld.indexOf(mod._id), 1)
                    }

                    channel.moderators.push(mod._id)
                }

                // In user schema we only have moderators array,
                // so we need to take care of the overlaps.
                const usersModsAdded = []
                const usersModsOld = []

                // Added.
                for(let idUser of adminsAdded) {
                    idUser = String(idUser)

                    if(!modsAdded.includes(idUser) && !adminsOld.includes(idUser)) {
                        usersModsAdded.push(idUser)

                        if(channel.usersBanned.includes(idUser)) {
                            channel.usersBanned.splice(channel.usersBanned.indexOf(idUser), 1)
                        }

                        if(user._id != idUser) {
                            sendNotification({
                                channel: channel._id,
                                receiver: idUser,
                                type: 'channelAdmin'
                            })
                        }
                    }
                }

                for(let idUser of modsAdded) {
                    idUser = String(idUser)

                    if(!adminsAdded.includes(idUser) && !modsOld.includes(idUser)) {
                        usersModsAdded.push(idUser)

                        if(channel.usersBanned.includes(idUser)) {
                            channel.usersBanned.splice(channel.usersBanned.indexOf(idUser), 1)
                        }

                        if(user._id != idUser) {
                            sendNotification({
                                channel: channel._id,
                                receiver: idUser,
                                type: 'channelModerator'
                            })
                        }
                    }
                }

                // Removed.
                for(let idUser of adminsOld) {
                    idUser = String(idUser)

                    if(!modsOld.includes(idUser) && !adminsAdded.includes(idUser)) {
                        usersModsOld.push(idUser)

                        if(!modsAdded.includes(idUser)) {
                            sendNotification({
                                channel: channel._id,
                                receiver: idUser,
                                type: 'channelAdminRemove'
                            })
                        }
                    }
                }

                for(let idUser of modsOld) {
                    idUser = String(idUser)

                    if(!adminsOld.includes(idUser) && !modsAdded.includes(idUser)) {
                        usersModsOld.push(idUser)

                        if(!adminsAdded.includes(idUser)) {
                            sendNotification({
                                channel: channel._id,
                                receiver: idUser,
                                type: 'channelModeratorRemove'
                            })
                        }
                    }
                }

                // Users no longer admins or mods, remove from user schema.
                models.User.updateMany(
                    { _id: { $in: usersModsOld }},
                    { $pull: { channelsModerator: channel._id }}
                ).exec()

                // TODO We shouldn't be adding now, only when they accept the invitation?
                // Users new mods or admins, add to user schema.
                models.User.updateMany(
                    { _id: { $in: usersModsAdded }},
                    { $push: { channelsModerator: channel._id }}
                ).exec()
            }

            if(patch.hasOwnProperty('moderation')) {
                const moderation = channel.moderation

                if(patch.moderation.hasOwnProperty('automatic') && patch.moderation.automatic.hasOwnProperty('triggers')) {
                    const automatic = moderation.automatic
                    const triggers = (patch.moderation.automatic.triggers || []).slice(0, maxTriggersAutoMod)

                    automatic.triggers = []

                    // https://stackoverflow.com/questions/26246601/wildcard-string-comparison-in-javascript
                    for(const trigger of triggers) {
                        switch(trigger.type) {
                            case 'words': {
                                if(!trigger.value || !String(trigger.value).trim().length) {
                                    continue
                                }

                                const words = trigger.value
                                                .split(',')
                                                .map(word => word.trim())

                                const rule = words.map(
                                    word => {
                                        return `\\b${
                                            word
                                            .split('*')
                                            .map(string => {
                                                return string.replace(
                                                    /([.*+?^=!:${}()|\[\]\/\\])/g,
                                                    '\\$1'
                                                )
                                            })
                                            .join('.*')
                                        }\\b`
                                    })
                                    .join('|')

                                trigger.rule = rule
                                break
                            }
                            case 'links': {
                                // Remove empty link field.
                                if(!trigger.value || !String(trigger.value).trim().length) {
                                    continue
                                }

                                const links = trigger.value
                                                .split(',')
                                                .map(link => prepareUrl(link.trim()))
                                                .filter(link => validateUrl(link))
                                                .map(link => `*${extractHostName(link.trim())}*`)

                                const rule = links.map(
                                    link => {
                                        return `\\b${
                                            link
                                            .split('*')
                                            .map(string => {
                                                return string.replace(
                                                    /([.*+?^=!:${}()|\[\]\/\\])/g,
                                                    '\\$1'
                                                )
                                            })
                                            .join('.*')
                                        }\\b`
                                    })
                                    .join('|')

                                trigger.rule = rule
                                break
                            }
                            default: {
                                // Remove empty carma or account age.
                                if(!trigger.value || trigger.value.length == 1) {
                                    continue
                                }
                            }
                        }

                        automatic.triggers.push(trigger)
                    }
                }

                moderation.autoPublish = patch.moderation.autoPublish
            }

            if(patch.hasOwnProperty('rules')) {
                if(!Array.isArray(patch.rules)) {
                    throw { code: -3, message: 'Invalid rules.' }
                }

                channel.rules = []

                for(const rule of patch.rules.slice(0, maxRules)) {
                    let title = rule.title.substring(0, 100).trim()
                    let text = sanitizeHtml(rule.text, optionsHtmlSanitize)
                    .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
                    .substring(0, 500).trim()

                    if(!title.length) {
                        continue
                    }

                    channel.rules.push({ title, text })
                }
            }

            if(patch.hasOwnProperty('tags')) {
                if(!Array.isArray(patch.tags)) {
                    throw { code: -4, message: 'Invalid tags.' }
                }

                channel.tags = []

                for(const tag of patch.tags.slice(0, maxTags)) {
                    let name = tag.name.substring(0, 30).trim()

                    if(!name.length) {
                        continue
                    }

                    if(!tag.id) {
                        tag.id = randToken.generate(6)
                    }

                    channel.tags.push({ id: tag.id, color: tag.color, name })
                }
            }

            if(patch.hasOwnProperty('default')) {
                if(!user.super || !user.superActive) {
                    throw { code: -5, message: 'Not permitted.' }
                }

                if(channel.type == 'private') {
                    throw { code: -6, message: `Channel can't be default. It's private.` }
                }

                channel.default = patch.default
            }

            return channel.save()
        })
        .then(async(channel) => {
            const idUser = mongoose.Types.ObjectId(req.user._id)
            const isUserAdmin = channel.admins.includes(idUser)
            const isUserModerator = isUserAdmin || channel.moderators.includes(idUser)
            const isUserMember = channel.members.includes(idUser)
            const isUserSubscribed = channel.subscribers.includes(idUser)
            const isUserBanned = channel.usersBanned.includes(idUser)

            channelsm.channelUpdated(channel)

            channel = await channel
                .populate('admins', 'image username')
                .populate('moderators', 'image username')
                .execPopulate()

            channel = channel.toJSON()

            channel.isUserAdmin = isUserAdmin
            channel.isUserMember = isUserMember
            channel.isUserModerator = isUserModerator
            channel.isUserSubscribed = isUserSubscribed
            channel.isUserBanned = isUserBanned

            res.json({ code: 0, channel: channel })
            processAnalytics(req, 'event', {
                eventCategory: 'channel',
                eventAction: 'patch',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error patching channel:', error.message)

            res.json({ code: error.code })
        })
    })
    .delete(authRequired, async(req, res) => {
        const ids = req.query.ids || []
        const user = await models.User.findOne({ _id: req.user._id })

        if(!user) {
            return res.json({ code: -2 })
        }

        const match = { id: { $in: ids }}

        if(!user.super && !user.superActive) {
            match.admins = req.user._id
        }

        models.Channel.updateMany(match, { status: 'removed' }).exec()
        .then(() => {
            res.json({ code: 0 })
            processAnalytics(req, 'event', {
                eventCategory: 'channel',
                eventAction: 'delete',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error deleting channels:', error.message)

            res.json({ code: error.code })
        })
    })

    const getChannel = async(id, user, filtersExtra) => {
        let filter = { id: id }

        if(filtersExtra) {
            filter = Object.assign(filter, filtersExtra)
        }

        let channel = await models.Channel
            .findOne(filter)
            .populate('admins', 'image username')
            .populate('moderators', 'image username')
            .exec()

        if(!channel) {
            return null
        }

        if(user) {
            const idUser = mongoose.Types.ObjectId(user._id)
            const isUserAdmin = channel.admins.map(admin => admin._id).includes(idUser)
            const isUserModerator = (
                isUserAdmin || channel.moderators.map(mod => mod._id).includes(idUser)
            )
            const isUserMember = channel.members.includes(idUser)
            const isUserSubscribed = channel.subscribers.includes(idUser)
            const isUserBanned = channel.usersBanned.includes(idUser)

            channel = channel.toJSON()

            channel.isUserAdmin = isUserAdmin
            channel.isUserMember = isUserMember
            channel.isUserModerator = isUserModerator
            channel.isUserSubscribed = isUserSubscribed
            channel.isUserBanned = isUserBanned
        }

        return channel
    }

    router.route('/c/:id')
	.get(async(req, res) => {
        const idChannel = req.params.id

        if(idChannel == 'todos') {
            return this.render(template, { page: 'channels', pane: 'channels', data: 'all' })
        }

        if(idChannel == 'moderados') {
            if(!req.user) {
                return this.render(template, { page: 'channels', info: 'authRequired' })
            }

            return this.render(template, { page: 'channels', pane: 'channels', data: 'mod' })
        }

        if(idChannel == 'populares') {
            return this.render(template, { page: 'channels', pane: 'channels', data: 'popular' })
        }

        if(idChannel == 'favoritos') {
            return this.render(template, { page: 'channels', pane: 'channels', data: 'favorites' })
        }

        const channel = await getChannel(idChannel, req.user)

        if(!channel) {
            return this.render(template, { page: 'error' })
        }

        this.render(template, { page: 'channels', pane: 'channel', data: channel })
	})

    // Mod and admins.

    router.route('/c/:id/moderacao')
	.get(authRequired, async(req, res) => {
        const user = await models.User.findOne({ _id: req.user._id }).exec()

        if(!user) {
            return this.render(template, { page: 'error' })
        }

        const idChannel = req.params.id
        const filtersExtra = (
            !user.super || !user.superActive ?
            { $or: [{ admins: req.user._id }, { moderators: req.user._id }] } :
            null
        )
        const channel = await getChannel(idChannel, req.user, filtersExtra)

        if(!channel) {
            return this.render(template, { page: 'error' })
        }

        this.render(template, { page: 'channels', pane: 'channelMod', data: channel })
	})

    router.route('/c/:id/configuracoes')
	.get(authRequired, async(req, res) => {
        const user = await models.User.findOne({ _id: req.user._id }).exec()

        if(!user) {
            return this.render(template, { page: 'error' })
        }

        const idChannel = req.params.id
        const filtersExtra = (
            !user.super || !user.superActive ?
            { admins: req.user._id } :
            null
        )
        const channel = await getChannel(idChannel, req.user, filtersExtra)

        if(!channel) {
            return this.render(template, { page: 'error' })
        }

        this.render(template, { page: 'channels', pane: 'channelSettings', data: channel })
	})

    // Invite user.

    router.route('/c/:id/convidar')
	.post(authRequired, async(req, res) => {
        const idChannel = req.params.id
        const username = req.body.username

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return res.json({ code: -2 })
        }

        const filtersChannel = { id: idChannel, status: 'active', type: { $ne: 'public' }}

        if(!user.super || !user.superActive) {
            filtersChannel['$or'] = [
                { admins: user._id },
                { moderators: user._id }
            ]
        }

        const channel = await models.Channel.findOne(filtersChannel)

        if(!channel) {
            return res.json({ code: 1 })
        }

        const userTarget = await models.User.findOne({ username, status: 'active' })

        if(!userTarget) {
            return res.json({ code: 2 })
        }

        let invited = true
        const members = channel.members

        if(members.includes(userTarget._id)) {
            invited = false

            members.splice(members.indexOf(userTarget._id), 1)

            if(channel.type == 'private') {
                channel.subscribers.splice(channel.subscribers.indexOf(userTarget._id), 1)
                userTarget.channelsSubscribed.splice(userTarget.channelsSubscribed.indexOf(channel._id), 1)
            }

            sendNotification({
                channel: channel._id,
                receiver: userTarget._id,
                type: 'channelMemberRemove'
            })
        }
        else {
            channel.subscribers.push(userTarget._id)
            members.push(userTarget._id)
            userTarget.channelsSubscribed.push(channel._id)

            sendNotification({
                channel: channel._id,
                receiver: userTarget._id,
                type: 'channelMember'
            })

            if(channel.usersBanned.includes(userTarget._id)) {
                channel.usersBanned.splice(channel.usersBanned.indexOf(userTarget._id), 1)
            }
        }

        channel.save()
        userTarget.save()

        res.json({ code: 0, invited })
        processAnalytics(req, 'event', {
            eventCategory: 'member',
            eventAction: invited ? 'invite' : 'removal',
            eventLabel: channel.id
        })
    })

    router.route('/c/:id/abandonar')
	.post(authRequired, async(req, res) => {
        const idChannel = req.params.id

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return res.json({ code: -2 })
        }

        const filtersChannel = { id: idChannel, status: 'active', moderators: user._id }
        const channel = await models.Channel.findOne(filtersChannel)

        if(!channel) {
            return res.json({ code: 1 })
        }

        channel.moderators.splice(channel.moderators.indexOf(user._id), 1)
        user.channelsModerator.splice(user.channelsModerator.indexOf(channel._id), 1)

        channel.save()
        user.save()

        sendNotification({
            channel: channel._id,
            receiver: user._id,
            type: 'channelModeratorRemove'
        })

        res.json({ code: 0 })
        processAnalytics(req, 'event', {
            eventCategory: 'moderator',
            eventAction: 'removeSelf',
            eventLabel: channel.id
        })
    })

    // Request access to private channel.

    router.route('/c/:id/pediracesso')
	.post(authRequired, async(req, res) => {
        const idChannel = req.params.id
        const text = String(req.body.text) || ''

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return res.json({ code: -2 })
        }

        const channel = await models.Channel.findOne({
            id: idChannel, status: 'active', type: 'private',
            'preferences.acceptRequests': true,
            admins: { $ne: req.user._id }, moderators: { $ne: req.user._id },
            members: { $ne: req.user._id }
        })

        if(!channel) {
            return res.json({ code: 1 })
        }

        if(!text.length) {
            return res.json({ code: 2 })
        }

        let alreadyRequested = false

        for(const memberRequest of channel.memberRequests) {
            if(String(memberRequest.user) == String(user._id)) {
                memberRequest.text = text

                alreadyRequested = true

                break
            }
        }

        if(!alreadyRequested) {
            channelsm.addedUserChannelRequest(idChannel)
            channel.memberRequests.push({ text, user: user._id })
        }

        channel.save()

        res.json({ code: 0 })
        processAnalytics(req, 'event', {
            eventCategory: 'channel',
            eventAction: 'requestAccess',
            eventLabel: channel.id
        })
    })

    // Reply to request for access to private channel.

    router.route('/c/:id/responderpedido')
	.post(authRequired, async(req, res) => {
        const idChannel = req.params.id
        const username = req.body.username
        const accept = req.body.accept

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return res.json({ code: -2 })
        }

        const filtersChannel = { id: idChannel, type: 'private' }

        if(!user.super || !user.superActive) {
            filtersChannel.status = 'active'
            filtersChannel['$or'] = [
                { admins: user._id },
                { moderators: user._id }
            ]
        }

        const channel = await models.Channel
            .findOne(filtersChannel)
            .populate('memberRequests.user')

        if(!channel) {
            return res.json({ code: 1 })
        }

        let newMember

        for(const [index, memberRequest] of channel.memberRequests.entries()) {
            if(memberRequest.user.username == username) {
                newMember = await models.User.findOne({ username })

                channel.memberRequests.splice(index, 1)
                break
            }
        }

        if(!newMember) {
            return res.json({ code: 2 })
        }

        if(accept) {
            if(!channel.subscribers.includes(newMember._id)) {
                channel.subscribers.push(newMember._id)
            }

            if(!newMember.channelsSubscribed.includes(channel._id)) {
                newMember.channelsSubscribed.push(channel._id)
            }

            channel.members.push(newMember._id)

            sendNotification({
                channel: channel._id,
                receiver: newMember._id,
                type: 'channelMember'
            })

            newMember.save()
        }

        channel.save()
        channelsm.removedUserChannelRequest(idChannel)

        res.json({ code: 0 })
        processAnalytics(req, 'event', {
            eventCategory: 'member',
            eventAction: accept ? 'accept' : 'reject',
            eventLabel: channel.id
        })
    })

    // Revive channel (only super).

    router.route('/c/reavivar')
	.post(authRequired, async(req, res) => {
        const idChannel = req.body.id

        const user = await models.User.findOne({
            _id: req.user._id,
            super: true,
            superActive: true,
            status: 'active'
        })

        if(!user) {
            return res.json({ code: -2 })
        }

        const channel = await models.Channel.findOne({ id: idChannel, status: 'removed' })

        if(!channel) {
            return res.json({ code: 1 })
        }

        channel.status = 'active'

        channel.save()

        res.json({ code: 0 })
    })

    // Ban channel (only super).

    router.route('/c/banir')
	.post(authRequired, async(req, res) => {
        const idChannel = req.body.id

        const user = await models.User.findOne({
            _id: req.user._id,
            super: true,
            superActive: true,
            status: 'active'
        })

        if(!user) {
            return res.json({ code: -2 })
        }

        const channel = await models.Channel
            .findOne({ id: idChannel, status: { $ne: 'removed' }})

        if(!channel) {
            return res.json({ code: 1 })
        }

        const banned = channel.status != 'banned'

        channel.status = banned ? 'banned' : 'active'

        channel.save()

        if(banned) {
            for(const admin of channel.admins) {
                sendNotification({
                    channel: channel._id,
                    receiver: admin,
                    type: 'channelBan'
                })
            }

            for(const moderator of channel.moderators) {
                sendNotification({
                    channel: channel._id,
                    receiver: moderator,
                    type: 'channelBan'
                })
            }
        }

        res.json({ code: 0, banned })
    })


    // Ban user from channel.

    router.route('/c/:id/banir')
	.post(authRequired, async(req, res) => {
        const idChannel = req.params.id
        const username = req.body.username

        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -2 })
        }

        const filtersChannel = { id: idChannel }

        if(!user.super || !user.superActive) {
            filtersChannel.status = 'active'
            filtersChannel['$or'] = [
                { admins: user._id },
                { moderators: user._id }
            ]
        }

        const channel = await models.Channel.findOne(filtersChannel)

        if(!channel) {
            return res.json({ code: 1 })
        }

        const userTarget = await models.User.findOne({ username, status: 'active'})

        if(!userTarget) {
            return res.json({ code: 2 })
        }

        let banned = true
        const usersBanned = channel.usersBanned

        if(usersBanned.includes(userTarget._id)) {
            banned = false

            usersBanned.splice(usersBanned.indexOf(userTarget._id), 1)
        }
        else {
            usersBanned.push(userTarget._id)
        }

        channel.save()

        if(banned) {
            sendNotification({
                channel: channel._id,
                receiver: userTarget._id,
                type: 'channelUserBan'
            })
        }

        res.json({ code: 0, banned })
        processAnalytics(req, 'event', {
            eventCategory: 'channel',
            eventAction: banned ? 'userBann' : 'userUnban',
            eventLabel: channel.id
        })
    })

    /*
        POSTS.
    */

    const getPost = async(req, idChannel, idPost, idComment) => {
        let user

        if(req.user) {
            user = await models.User.findOne({ _id: req.user._id }).exec()
        }

        const matchChannel = { id: idChannel }

        if(!user || !user.super || !user.superActive) {
            matchChannel.status = { $ne: 'banned' }
        }

        models.Channel.findOne(matchChannel).exec()
        .then(channel => {
            if(!channel) {
                throw { code: 1 }
            }

            if(channel.type == 'private') {
                if(!user) {
                    return this.render(template, {
                        page: 'channels', pane: 'channel', data: channel
                    })
                }

                const isMember = channel.members.includes(user._id)
                const isMod = channel.moderators.concat(channel.admins).includes(user._id)

                if(!isMod && !isMember && (!user.super || !user.superActive)) {
                    return this.render(template, {
                        page: 'channels', pane: 'channel', data: channel
                    })
                }
            }

            return models.Post
                .findOne({ id: idPost, channel: channel._id })
                .populate('channel', 'id admins image description moderators name preferences subscribers tags')
                .populate('creator', 'image status super username')
                .populate('flags.user', 'image username')
                .exec()
        })
        .then((post) => {
            if(!post) {
                throw { code: 3 }
            }

            let hasUserDownvoted = false
            let hasUserUpvoted = false
            let hasUserFavorited = false
            const optionsVoted = []

            if(user) {
                hasUserUpvoted = post.votes.up.includes(user._id)
                hasUserDownvoted = post.votes.down.includes(user._id)
                hasUserFavorited = user.postsFavorited.includes(post._id)

                if(post.type == 'poll') {
                    for(const [index, option] of post.poll.options.entries()) {
                        if(option.votes.includes(user._id)) {
                            optionsVoted.push(index)

                            if(!post.poll.multipleChoice) {
                                break
                            }
                        }
                    }
                }

                if(!post.views.includes(user._id)) {
                    post.views.push(user._id)
                    post.save()
                }
            }

            const channel = post.channel.toJSON()
            post = post.toJSON()
            post.channel = channel

            if(req.user) {
                post.hasUserDownvoted = hasUserDownvoted
                post.hasUserUpvoted = hasUserUpvoted
                post.hasUserFavorited = hasUserFavorited
                post.hasUserSeen = true

                if(post.type == 'poll' && optionsVoted.length && post.poll.options) {
                    for(const indexOption of optionsVoted) {
                        post.poll.options[indexOption].hasUserVoted = true
                    }
                }
            }

            if(idComment) {
                post.idCommentHighlight = idComment
            }

            this.render(template, {
                page: 'channels', pane: idComment ? 'comment' : 'post', data: post
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
                error = { code: -1, message: error }
            }

            console.log('Error getPost', error)

            this.render(template, { page: 'error', data: { code: error.code } })
        })
    }

    router.route('/c/:idChannel/p/:id')
	.get((req, res) => {
        const idChannel = req.params.idChannel
        const idPost = req.params.id

        getPost(req, idChannel, idPost)
	})

    router.route('/c/post')
    .post(authRequired, (req, res) => {
        const dataReq = req.body.data || {}
        const adultContent = dataReq.adultContent
        const contents = dataReq.contents
        const idChannel = dataReq.idChannel
        const tag = dataReq.tag
        const title = dataReq.title
        const type = dataReq.type

        let channelTarget
        let userTarget

        models.User.findOne({ _id: req.user._id, status: 'active'})
        .populate('posts')
        .exec()
        .then(userFound => {
            if(!userFound) {
                throw { code: -2 }
            }

            userTarget = userFound

            return models.Channel.findOne({ id: idChannel, status: 'active' }).exec()
        })
        .then(async(channel) => {
            const isMember = channel.members.includes(userTarget._id)
            const isMod = channel.moderators.concat(channel.admins).includes(userTarget._id)
            const isBanned = channel.usersBanned.includes(userTarget._id)
            const isSuper = userTarget.super && userTarget.superActive

            if((!userTarget.super || !userTarget.superActive) && !isMod) {
                // Check if user is commenting too much.
                let countLast5Minutes = 0

                for(const post of userTarget.posts.reverse()) {
                    if(Date.now() - post.createdAt < 1000 * 60 * 5) {
                        ++countLast5Minutes
                        continue
                    }

                    break
                }

                if(
                    countLast5Minutes > 6 ||
                    (countLast5Minutes > 3 && userTarget.karma < 500) ||
                    (countLast5Minutes > 1 && userTarget.karma < 100)
                ) {
                    throw { code: 21, message: 'Too much posting' }
                }
            }

            if(!isSuper) {
                if(isBanned) {
                    throw { code: 5 }
                }

                switch(channel.type) {
                    case 'public':
                        break
                    case 'restricted':
                        if(!isMod && !isMember) {
                            throw { code: 1 }
                        }
                        break
                    case 'private':
                        if(!isMod && !isMember) {
                            throw { code: 1 }
                        }
                }
            }

            channelTarget = channel
            let statusPost = channel.moderation.autoPublish || isSuper ? 'published' : 'submitted'

            if(!validatePostTitle(title)) {
                throw { code: 2 }
            }

            const typesAllowed = channel.preferences.typePostsAllowed || []

            if(typesAllowed.length && !typesAllowed.includes(type)) {
                throw { code: 3 }
            }

            const data = {
                id: randToken.generate(6),
                adultContent,
                channel: channelTarget._id,
                creator: userTarget._id,
                public: channelTarget.type != 'private',
                status: statusPost,
                title,
                type,
                views: [userTarget._id],
                'votes.up': [userTarget._id]
            }

            const idsTags = channel.tags.map(tag => tag.id)

            if(tag && idsTags.includes(tag)) {
                data.tag = tag
            }

            if(contents.text) {
                data.text = sanitizeHtml(contents.text, optionsHtmlSanitize)
                    .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
                    .substring(0, 10000)
            }

            switch(type) {
                case 'link':
                    if(!validateUrl(contents.link)) {
                        throw { code: 4 }
                    }

                    try {
                        const idImage = await prepareLink(contents.link)

                        data.images = [idImage]
                    }
                    catch(error) {
                        console.log('No image available for link', error)
                        //throw { code: -3, message: error }
                    }

                    data.link = contents.link

                    break
                case 'image':
                    if(
                        !contents.images ||
                        !contents.images.length ||
                        contents.images.length > maxImages
                    ) {
                        throw { code: 4 }
                    }

                    data.images = contents.images

                    serverm.claimMedia(data.images)
                    break
                case 'poll':
                    const poll = contents.poll

                    if(
                        !poll || !poll.options || !poll.duration ||
                        !poll.options.length || poll.options.length > maxOptionsPoll
                    ) {
                        throw { code: 4 }
                    }

                    data.poll = poll
                    break
            }

            if(isMod) {
                data.status = 'approved'
            }
            else {
                const moderation = channelTarget.moderation
                const autoMod = moderation.automatic
                const triggers = autoMod.triggers || []

                for(const trigger of triggers) {
                    if(!['all', 'posts'].includes(trigger.typeData)) {
                        continue
                    }

                    switch(trigger.type) {
                        case 'words': {
                            const titleTest = removeAccents(data.title)
                            const regex = new RegExp(trigger.rule, 'i')

                            // Analyse title.
                            if(regex.test(titleTest)) {
                                data.status = actionToStatus(trigger.action)
                            }

                            // Analyse text.
                            if(data.text && data.text.length) {
                                const textTest = removeAccents(data.text)

                                if(regex.test(textTest)) {
                                    data.status = actionToStatus(trigger.action)
                                }
                            }

                            break
                        }
                        case 'links': {
                            const regex = new RegExp(trigger.rule, 'i')

                            // Analyse link.
                            if(type == 'link') {
                                if(regex.test(data.link)) {
                                    data.status = actionToStatus(trigger.action)
                                }
                            }

                            // Analyse text.
                            if(data.text && data.text.length) {
                                if(regex.test(data.text)) {
                                    data.status = actionToStatus(trigger.action)
                                }
                            }

                            break
                        }
                        case 'karma': {
                            modKarma(trigger, userTarget, data)

                            break
                        }
                        case 'age': {
                            modAge(trigger, userTarget, data)

                            break
                        }
                    }
                }
            }

            return models.Post.create(data)
        })
        .then(post => {
            channelTarget.posts.push(post._id)
            userTarget.posts.push(post._id)
            userTarget.postsVoted.up.push(post._id)

            return Promise.all([
                channelTarget.save(),
                userTarget.save(),
                post
                .populate('channel', 'id admins image moderators name subscribers tags')
                .populate('creator', 'image username')
                .execPopulate()
            ])
        })
        .then(([channel, user, post]) => {
            const channelParsed = post.channel.toJSON()
            post = post.toJSON()
            post.channel = channelParsed

            post.hasUserDownvoted = false
            post.hasUserUpvoted = true

            if(post.status == 'submitted') {
                channelsm.addedPostToQueue(channel.id)
            }
            else if(post.status == 'autorejected') {
                sendNotification({
                    channel: channelTarget._id,
                    post: post._id,
                    receiver: userTarget._id,
                    type: 'postReject'
                })
            }

            res.json({ code: 0, post: post })

            processAnalytics(req, 'event', {
                eventCategory: 'post',
                eventAction: 'create',
                eventLabel: channelTarget.id
            })
        })
        .catch(error => {
            if(!error.code) {
				error = { code: -1, message: error }
            }

            console.log('Error creating post', error.code, error.message)

            res.json({ code: error.code })
        })
    })
    .patch(authRequired, async(req, res) => {
        const idPost = req.body.id
        const patch = req.body.data

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return res.json({ code: -1 })
        }

        const post = await models.Post
            .findOne({ id: idPost })
            .populate('channel', 'id admins image description moderators name preferences subscribers tags')
            .populate('creator', 'image status super username')

        if(!post) {
            return res.json({ code: 1 })
        }

        let channel = post.channel
        const isCreator = req.user._id == String(post.creator._id)
        const isMod = channel.moderators.concat(channel.admins).includes(user._id)
        const isSuper = user.super && user.superActive

        if(!isCreator && !isMod && !isSuper) {
            return res.json({ code: 2 })
        }

        if(patch.hasOwnProperty('adultContent')) {
            post.adultContent = Boolean(patch.adultContent)
        }

        if(patch.hasOwnProperty('tag')) {
            if(patch.tag == 'tagEmpty') {
                post.tag = ''
            }
            else {
                for(const tag of channel.tags) {
                    if(tag.id == patch.tag) {
                        post.tag = tag.id
                        break
                    }
                }
            }
        }

        if(patch.hasOwnProperty('text')) {
            if(!isCreator && !isSuper) {
                return res.json({ code: 2 })
            }

            const textNew = sanitizeHtml(patch.text, optionsHtmlSanitize)
            .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
            .substring(0, 10000)

            if(String(textNew) != String(post.text || '')) {
                const textPrevious = post.text

                post.text = textNew

                const ninjaEdit = Date.now() - post.createdAt < 1000 * 60 * 5 && !post.comments.length

                if(!ninjaEdit) {
                    if(!post.edited) {
                        post.textOriginal = textPrevious
                        post.edited = true
                    }

                    post.editedAt = Date.now()
                }
            }
        }

        if(patch.hasOwnProperty('title') && isSuper) {
            const title = patch.title

            if(!validatePostTitle(title)) {
                throw { code: 3 }
            }

            post.title = title
        }

        post.save()

        post.channel = channel.toJSON()

        res.json({ code: 0, post: post.toJSON() })
        processAnalytics(req, 'event', {
            eventCategory: 'post',
            eventAction: 'patch',
            eventLabel: channel.id
        })
    })
    .delete(authRequired, async(req, res) => {
        const ids = req.query.ids || []
        const user = req.user
        const match = { id: { $in: ids }, creator: user }

        const posts = await models.Post.find(match).populate('channel', 'id')

        for(const post of posts) {
            if(post.status == 'submitted' || (post.status == 'published' && post.flags.length)) {
                channelsm.removedPostFromQueue(post.channel.id)

                processAnalytics(req, 'event', {
                    eventCategory: 'post',
                    eventAction: 'delete',
                    eventLabel: post.channel.id
                })
            }
        }

        await models.Post.updateMany(match, { status: 'removed' })

        res.json({ code: 0 })
    })

    /*
        COMMENTS.
    */

    router.route('/c/:idChannel/p/:idPost/:id')
	.get((req, res) => {
        const idChannel = req.params.idChannel
        const idComment = req.params.id
        const idPost = req.params.idPost

        getPost(req, idChannel, idPost, idComment)
	})

    router.route('/c/comentario')
    .post(authRequired, (req, res) => {
        const dataReq = req.body.data || {}
        const idPost = dataReq.idPost
        const idReplyTo = dataReq.idReplyTo
        const text = sanitizeHtml(dataReq.text, optionsHtmlSanitize)
            .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
            .substring(0, 10000)

        let channelTarget
        let parentTarget
        let postTarget
        let userTarget

        models.User.findOne({ _id: req.user._id, status: 'active' })
        .populate('comments')
        .exec()
        .then(userFound => {
            if(!userFound) {
                throw { code: -2, message: 'No user found' }
            }

            userTarget = userFound

            return models.Post
            .findOne({
                id: idPost,
                locked: false,
                status: { $nin: ['archived', 'removed']}
            })
            .populate('channel')
            .populate('creator')
            .exec()
        })
        .then(async (post) => {
            if(!post) {
                throw { code: 1, message: 'No post found' }
            }

            postTarget = post

            channelTarget = postTarget.channel
            const isMod = channelTarget.moderators.concat(channelTarget.admins).includes(userTarget._id)
            const isMember = channelTarget.members.includes(userTarget._id)
            const isBanned = channelTarget.usersBanned.includes(userTarget._id)
            const isSuper = userTarget.super && userTarget.superActive

            // Check if user is commenting too much.
            let countLast5Minutes = 0

            for(const comment of userTarget.comments.reverse()) {
                if(Date.now() - comment.createdAt < 1000 * 60 * 5) {
                    ++countLast5Minutes
                    continue
                }

                break
            }

            if(
                (countLast5Minutes > 10 && (!userTarget.super || !userTarget.superActive) && !isMod) ||
                (countLast5Minutes > 5 && userTarget.karma < 500) ||
                (countLast5Minutes > 3 && userTarget.karma < 100)
            ) {
                throw { code: 21, message: 'Too much commenting' }
            }

            if(!isSuper) {
                if(isBanned) {
                    throw { code: 4, message: 'User banned.' }
                }

                if(channelTarget.type == 'private' && !isMod && !isMember) {
                    throw { code: 2, message: 'No access' }
                }
            }

            const data = {
                creator: userTarget._id,
                id: randToken.generate(6),
                post: post._id,
                status: 'published',
                text,
                'votes.up': [userTarget._id]
            }

            if(isMod) {
                data.status = 'approved'
            }
            else {
                const moderation = channelTarget.moderation
                const autoMod = moderation.automatic
                const triggers = autoMod.triggers || []

                for(const trigger of triggers) {
                    if(!['all', 'comments'].includes(trigger.typeData)) {
                        continue
                    }

                    switch(trigger.type) {
                        case 'words': {
                            const regex = new RegExp(trigger.rule, 'i')

                            // Analyse text.
                            if(data.text && data.text.length) {
                                const textTest = removeAccents(data.text)

                                if(regex.test(textTest)) {
                                    data.status = actionToStatus(trigger.action)
                                }
                            }

                            break
                        }
                        case 'links': {
                            const regex = new RegExp(trigger.rule, 'i')

                            // Analyse text.
                            if(data.text && data.text.length) {
                                if(regex.test(data.text)) {
                                    data.status = actionToStatus(trigger.action)
                                }
                            }

                            break
                        }
                        case 'karma': {
                            modKarma(trigger, userTarget, data)

                            break
                        }
                        case 'age': {
                            modAge(trigger, userTarget, data)

                            break
                        }
                    }
                }
            }

            if(idReplyTo) {
                parentTarget = await models.Comment
                    .findOne({ id: idReplyTo })
                    .populate('creator')

                if(!parentTarget) {
                    throw { code: 3, message: 'No parent comment' }
                }

                data.parent = parentTarget._id
            }

            return models.Comment.create(data)
        })
        .then(comment => {
            postTarget.comments.push(comment._id)
            userTarget.comments.push(comment._id)
            userTarget.commentsVoted.up.push(comment._id)

            const actions = [
                postTarget.save(),
                userTarget.save(),
                comment
                .populate('creator', 'image status super username')
                .populate('post', 'id')
                .execPopulate()
            ]

            if(parentTarget) {
                parentTarget.replies.push(comment._id)

                actions.push(parentTarget.save())
            }

            return Promise.all(actions)
        })
        .then(([post, user, comment, parent]) => {
            comment = comment.toJSON()

            comment.hasUserDownvoted = false
            comment.hasUserUpvoted = true

            if(parentTarget) {
                comment.parent = { _id: comment.parent, id: parentTarget.id }
            }

            if(comment.status == 'submitted') {
                channelsm.addedCommentToQueue(channelTarget.id)
            }
            else if(comment.status == 'published' || comment.status == 'approved') {
                if(parentTarget) {
                    const creator = parentTarget.creator

                    if(String(creator._id) != String(userTarget._id)) {
                        if(
                            creator.preferences.notifications.inApp.commentReplies &&
                            !creator.usersBlocked.includes(userTarget._id)
                        ) {
                            sendNotification({
                                channel: channelTarget._id,
                                comment: comment._id,
                                commentParent: parentTarget._id,
                                post: postTarget._id,
                                receiver: creator._id,
                                sender: userTarget._id,
                                type: 'commentReply'
                            })
                        }
                    }
                }
                else {
                    const creator = postTarget.creator

                    if(String(creator._id) != String(userTarget._id)) {
                        if(
                            creator.preferences.notifications.inApp.postComments &&
                            !creator.usersBlocked.includes(userTarget._id)
                        ) {
                            sendNotification({
                                channel: channelTarget._id,
                                comment: comment._id,
                                post: postTarget._id,
                                receiver: creator._id,
                                sender: userTarget._id,
                                type: 'postComment'
                            })
                        }
                    }
                }
            }
            else if(comment.status == 'autorejected') {
                sendNotification({
                    channel: channelTarget._id,
                    comment: comment._id,
                    post: postTarget._id,
                    receiver: userTarget._id,
                    type: 'commentReject'
                })
            }

            res.json({ code: 0, comment: comment })

            processAnalytics(req, 'event', {
                eventCategory: 'comment',
                eventAction: 'create',
                eventLabel: channelTarget.id
            })
        })
        .catch(error => {
            if(!error.code) {
				error = { code: -1, message: error }
            }

            console.log('Error commenting post', error.code, error.message)

            res.json({ code: error.code })
        })
    })
    .patch(authRequired, async(req, res) => {
        const idComment = req.body.id
        const patch = req.body.data

        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return res.json({ code: -1 })
        }

        const comment = await models.Comment
            .findOne({ id: idComment })
            .populate({
                path: 'post',
                populate: { path: 'channel', model: 'Channel', select: 'id admins image description moderators name preferences subscribers tags' }
            })
            .populate('creator', 'image status super username')

        if(!comment) {
            return res.json({ code: 1 })
        }

        const post = comment.post
        let channel = post.channel
        const isCreator = req.user._id == String(comment.creator._id)
        const isMod = channel.moderators.concat(channel.admins).includes(user._id)
        const isSuper = user.super && user.superActive

        if(!isCreator && !isMod && !isSuper) {
            return res.json({ code: 2 })
        }

        if(patch.hasOwnProperty('text')) {
            if(!isCreator) {
                return res.json({ code: 2 })
            }

            const textPrevious = comment.text

            comment.text = sanitizeHtml(patch.text, optionsHtmlSanitize)
                .replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
                .substring(0, 10000)

            const ninjaEdit = Date.now() - comment.createdAt < 1000 * 60 * 5 && !comment.replies.length

            if(!ninjaEdit) {
                if(!comment.edited) {
                    comment.textOriginal = textPrevious
                    comment.edited = true
                }

                comment.editedAt = Date.now()
            }
        }

        comment.save()

        //post.channel = channel.toJSON()

        res.json({ code: 0, comment: comment.toJSON() })
        processAnalytics(req, 'event', {
            eventCategory: 'comment',
            eventAction: 'patch',
            eventLabel: channel.id
        })
    })
    .delete(authRequired, async(req, res) => {
        const ids = req.query.ids || []
        const user = req.user
        const match = { id: { $in: ids }, creator: user }

        const comments = await models.Comment
            .find(match)
            .populate({
                path: 'post',
                populate: { path: 'channel', model: 'Channel', select: 'id' }
            })

        for(const comment of comments) {
            if(comment.status == 'submitted' || (comment.status == 'published' && comment.flags.length)) {
                channelsm.removedCommentFromQueue(comment.post.channel.id)

                processAnalytics(req, 'event', {
                    eventCategory: 'comment',
                    eventAction: 'delete',
                    eventLabel: comment.post.channel.id
                })
            }
        }

        await models.Comment.updateMany(match, { status: 'removed' })

        res.json({ code: 0 })
    })

    /*
        VOTES.
    */

    router.route('/c/post/votar')
	.post(authRequired, (req, res) => {
        const idPost = req.body.idPost
        const typeVote = req.body.vote

        let userTarget

        models.User.findOne({ _id: req.user._id, status: 'active'}).exec()
        .then(user => {
            if(!user) {
                throw { code: -1 }
            }

            userTarget = user

            return models.Post
                .findOne({ id: idPost, status: { $nin: ['archived', 'removed']}})
                .populate('creator')
                .populate('channel', 'usersBanned')
                .exec()
        })
        .then(post => {
            if(!post) {
                throw { code: -2, message: 'No post found.' }
            }

            if(post.channel.usersBanned.includes(userTarget._id)) {
                return res.json({ code: 1, message: 'User banned.' })
            }

            let votePrevious = 0
            let voteNow = 0

            // Remove previous votes from same user.
            if(post.votes.down.includes(userTarget._id)) {
                post.votes.down.splice(post.votes.down.indexOf(userTarget._id), 1)
                userTarget.postsVoted.down.splice(userTarget.postsVoted.down.indexOf(post._id), 1)

                votePrevious = -1
            }
            else if(post.votes.up.includes(userTarget._id)) {
                post.votes.up.splice(post.votes.up.indexOf(userTarget._id), 1)
                userTarget.postsVoted.up.splice(userTarget.postsVoted.up.indexOf(post._id), 1)

                votePrevious = 1
            }

            // Apply vote.
            if(typeVote) {
                if(votePrevious != 1) {
                    post.votes.up.push(req.user._id)
                    userTarget.postsVoted.up.push(post._id)

                    voteNow = 1
                }
            }
            else {
                if(votePrevious != -1) {
                    post.votes.down.push(req.user._id)
                    userTarget.postsVoted.down.push(post._id)

                    voteNow = -1
                }
            }

            userTarget.save()
            post.save()

            res.json({ code: 0, vote: voteNow, voteIncrement: voteNow - votePrevious })
            processAnalytics(req, 'event', {
                eventCategory: 'post',
                eventAction: voteNow == 1 ? 'voteUp' : (voteNow == -1 ? 'voteDown' : 'unvote'),
                eventLabel: post.channel.id
            })

            // Update creator karma.
            const creator = post.creator
            const isSelf = String(creator._id) == String(userTarget._id)

            if(creator && !isSelf && (voteNow == 1 || votePrevious == 1)) {
                const karma = Math.max(creator.karma + (voteNow == 1 ? 1 : -1), 0)

                models.User.findOneAndUpdate({ _id: creator._id }, { karma: karma }).exec()

                if(voteNow == 1 && creator.preferences.notifications.inApp.postUpvotes) {
                    testNotificationUpvotes(post, creator._id)
                }
            }
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error voting post:', error.message)

            res.json({ code: error.code })
        })
	})

    router.route('/c/comentario/votar')
	.post(authRequired, (req, res) => {
        const idComment = req.body.idComment
        const idPost = req.body.idPost
        const typeVote = req.body.vote

        let userTarget

        models.User.findOne({ _id: req.user._id, status: 'active'}).exec()
        .then(user => {
            if(!user) {
                throw { code: -1, message: 'No user found.' }
            }

            userTarget = user

            return models.Post.findOne({
                id: idPost,
                status: { $nin: ['archived', 'removed']}
            }).exec()
        })
        .then(post => {
            if(!post) {
                throw { code: -2, message: 'No post found.' }
            }

            return models.Comment.findOne({
                id: idComment,
                post: post._id,
                status: { $ne: 'removed' }
            })
            .populate('creator')
            .populate({
                path: 'post',
                populate: { path: 'channel', model: 'Channel', select: 'usersBanned' }
            })
            .exec()
        })
        .then(comment => {
            if(!comment) {
                throw { code: -3, message: 'No comment found.'}
            }

            if(comment.post.channel.usersBanned.includes(userTarget._id)) {
                return res.json({ code: 1, message: 'User banned.' })
            }

            let votePrevious = 0
            let voteNow = 0

            // Remove previous votes from same user.
            if(comment.votes.down.includes(userTarget._id)) {
                comment.votes.down.splice(comment.votes.down.indexOf(userTarget._id), 1)
                userTarget.commentsVoted.down.splice(userTarget.commentsVoted.down.indexOf(comment._id), 1)

                votePrevious = -1
            }
            else if(comment.votes.up.includes(userTarget._id)) {
                comment.votes.up.splice(comment.votes.up.indexOf(userTarget._id), 1)
                userTarget.commentsVoted.up.splice(userTarget.commentsVoted.up.indexOf(comment._id), 1)

                votePrevious = 1
            }

            // Apply vote.
            if(typeVote) {
                if(votePrevious != 1) {
                    comment.votes.up.push(userTarget._id)
                    userTarget.commentsVoted.up.push(comment._id)

                    voteNow = 1
                }
            }
            else {
                if(votePrevious != -1) {
                    comment.votes.down.push(userTarget._id)
                    userTarget.commentsVoted.down.push(comment._id)

                    voteNow = -1
                }
            }

            userTarget.save()
            comment.save()

            res.json({ code: 0, vote: voteNow, voteIncrement: voteNow - votePrevious })
            processAnalytics(req, 'event', {
                eventCategory: 'comment',
                eventAction: voteNow == 1 ? 'voteUp' : (voteNow == -1 ? 'voteDown' : 'unvote'),
                eventLabel: comment.post.channel.id
            })

            // Update creator karma.
            const creator = comment.creator
            const isSelf = String(creator._id) == String(userTarget._id)

            if(creator && !isSelf && (voteNow == 1 || votePrevious == 1)) {
                const karma = Math.max(creator.karma + (voteNow == 1 ? 1 : -1), 0)

                models.User.findOneAndUpdate({ _id: creator._id }, { karma: karma }).exec()

                if(voteNow == 1 && creator.preferences.notifications.inApp.commentUpvotes) {
                    testNotificationUpvotes(comment, creator._id)
                }
            }
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error voting comment:', error.code, error.message)

            res.json({ code: error.code })
        })
	})

    router.route('/c/sondagem/votar')
	.post(authRequired, (req, res) => {
        const idPost = req.body.idPost
        //const indexOption = req.body.indexOption
        const indexOptions = req.body.indexOptions || []

        let userTarget

        models.User.findOne({ _id: req.user._id, status: 'active'}).exec()
        .then(user => {
            if(!user) {
                throw { code: -1 }
            }

            userTarget = user

            return models.Post.findOne({
                id: idPost,
                status: { $nin: ['archived', 'removed']},
                type: 'poll'
            })
            .populate('channel', 'usersBanned')
            .exec()
        })
        .then(post => {
            if(!post) {
                throw { code: -2 }
            }

            if(post.channel.usersBanned.includes(userTarget._id)) {
                return res.json({ code: 3, message: 'User banned.' })
            }

            const dayMs = 1000 * 60 * 60 * 24

            if(Date.now() - new Date(post.createdAt).getTime() > post.poll.duration * dayMs) {
                throw { code: 1, message: 'Poll is closed.' }
            }

            const options = post.poll.options

            for(const option of options) {
                if(option.votes.includes(userTarget._id)) {
                    throw { code: 2, message: 'Already voted.' }
                }
            }

            if(!post.poll.multipleChoice && indexOptions.length > 1) {
                throw { code: -3 }
            }

            for(const index of indexOptions) {
                if(index < 0 || index >= options.length) {
                    throw { code: -4 }
                }

                options[index].votes.push(userTarget._id)
            }

            post.save()

            res.json({ code: 0 })
            processAnalytics(req, 'event', {
                eventCategory: 'poll',
                eventAction: 'vote',
                eventLabel: post.channel.id
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error voting poll:', error.message)

            res.json({ code: error.code })
        })
	})

    /*
        REPORTS.
    */

    router.route('/c/post/denunciar')
    .post(authRequired, async(req, res) => {
        const idPost = req.body.id
        const type = req.body.flag
        const text = req.body.text

        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -1 })
        }

        const post = await models.Post
            .findOne({ id: idPost, status: { $ne: 'removed' }})
            .populate('channel', 'id usersBanned')
            .populate('flags.user')

        if(!post) {
            return res.json({ code: -2 })
        }

        if(post.channel.usersBanned.includes(user._id)) {
            return res.json({ code: 1 })
        }

        let alreadyReportedByUser = false

        for(const flag of post.flags) {
            if(String(flag.user._id) == String(user._id)) {
                flag.text = text
                flag.type = type

                alreadyReportedByUser = true

                break
            }
        }

        if(!post.flags.length && post.status == 'published') {
            channelsm.addedPostToQueue(post.channel.id)
        }

        if(!alreadyReportedByUser) {
            post.flags.push({ text, type, user: user._id })
        }

        await post.save()

        res.json({ code: 0 })
        processAnalytics(req, 'event', {
            eventCategory: 'post',
            eventAction: 'report',
            eventLabel: post.channel.id
        })
    })

    router.route('/c/comentario/denunciar')
    .post(authRequired, async(req, res) => {
        const idComment = req.body.id
        const type = req.body.flag
        const text = req.body.text

        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -1 })
        }

        const comment = await models.Comment
            .findOne({ id: idComment, status: { $ne: 'removed' }})
            .populate({
                path: 'post',
                populate: { path: 'channel', model: 'Channel', select: 'id usersBanned' }
            })
            .populate('flags.user')

        if(!comment) {
            return res.json({ code: -2 })
        }

        if(comment.post.channel.usersBanned.includes(user._id)) {
            return res.json({ code: 1 })
        }

        let alreadyReportedByUser = false

        for(const flag of comment.flags) {
            if(String(flag.user._id) == String(user._id)) {
                flag.text = text
                flag.type = type

                alreadyReportedByUser = true

                break
            }
        }

        if(!comment.flags.length && comment.status == 'published') {
            channelsm.addedCommentToQueue(comment.post.channel.id)
        }

        if(!alreadyReportedByUser) {
            comment.flags.push({ text, type, user: user._id })
        }

        await comment.save()

        res.json({ code: 0 })
        processAnalytics(req, 'event', {
            eventCategory: 'comment',
            eventAction: 'report',
            eventLabel: comment.post.channel.id
        })
    })

    /*
        SUBSCRIPTIONS.
    */

    router.route('/c/subscrever')
	.post(authRequired, (req, res) => {
        const idChannel = req.body.idChannel

        let userTarget

        models.User.findOne({ _id: req.user._id }).exec()
        .then(user => {
            if(!user) {
                throw { code: -1, message: 'No user found.' }
            }

            userTarget = user

            return models.Channel.findOne({ id: idChannel, status: 'active' }).exec()
        })
        .then(channel => {
            if(!channel) {
                throw { code: -2, message: 'No channel found.' }
            }

            // Not yet subscribed.
            if(!channel.subscribers.includes(userTarget._id)) {
                if(channel.type == 'private') {
                    if(
                        !channel.admins.includes(userTarget._id) &&
                        !channel.moderators.includes(userTarget._id)
                    ) {
                        throw { code: 1, message: 'No access.' }
                    }
                }

                if(userTarget.channelsSubscribed.length > maxChannelSubscriptions) {
                    throw { code: 2, message: 'User subscriptions limit reached.' }
                }

                userTarget.channelsSubscribed.push(channel._id)
                channel.subscribers.push(userTarget._id)
            }
            // Lets unsubscribe.
            else {
                if(channel.type == 'private') {
                    if(channel.members.includes(userTarget._id)) {
                        channel.members.splice(channel.members.indexOf(userTarget._id), 1)
                    }
                }

                userTarget.channelsSubscribed.splice(userTarget.channelsSubscribed.indexOf(channel._id), 1)
                channel.subscribers.splice(channel.subscribers.indexOf(userTarget._id), 1)
            }

            userTarget.save()
            return channel.save()
        })
        .then(channel => {
            const subscribed = channel.subscribers.includes(userTarget._id)

            res.json({ code: 0, subscribed: subscribed })
            processAnalytics(req, 'event', {
                eventCategory: 'channel',
                eventAction: subscribed ? 'subscribe' : 'unsubscribe',
                eventLabel: channel.id
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error subscribing channel:', error.message)

            res.json({ code: error.code })
        })
	})

    /*
        FAVORITES.
    */

    router.route('/c/post/favoritar')
	.post(authRequired, (req, res) => {
        const idPost = req.body.id

        let userTarget
        let postTarget

        models.User.findOne({ _id: req.user._id }).exec()
        .then(user => {
            if(!user) {
                throw { code: -1, message: 'No user found.' }
            }

            userTarget = user

            return models.Post
                .findOne({ id: idPost, status: { $ne: 'removed' }})
                .populate('channel', 'admins id members moderators type')
                .exec()
        })
        .then(post => {
            if(!post) {
                throw { code: -2, message: 'No post found.' }
            }

            postTarget = post

            if(!post.public) {
                const channel = post.channel

                if(
                    !channel.admins.includes(userTarget._id) &&
                    !channel.moderators.includes(userTarget._id) &&
                    !channel.members.includes(userTarget._id)
                ) {
                    throw { code: 1, message: 'No access.' }
                }
            }

            // Add to favorites.
            if(!userTarget.postsFavorited.includes(postTarget._id)) {
                userTarget.postsFavorited.push(postTarget._id)
            }
            // Remove from favorites.
            else {
                userTarget.postsFavorited.splice(userTarget.postsFavorited.indexOf(postTarget._id), 1)
            }

            return userTarget.save()
        })
        .then(user => {
            const favorited = user.postsFavorited.includes(postTarget._id)

            res.json({ code: 0, favorited })
            processAnalytics(req, 'event', {
                eventCategory: 'post',
                eventAction: favorited ? 'favorite' : 'unfavorite',
                eventLabel: postTarget.channel.id
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error favoriting a post:', error.message)

            res.json({ code: error.code })
        })
	})

    router.route('/c/comentario/favoritar')
	.post(authRequired, (req, res) => {
        const idComment = req.body.id

        let userTarget
        let commentTarget

        models.User.findOne({ _id: req.user._id }).exec()
        .then(user => {
            if(!user) {
                throw { code: -1, message: 'No user found.' }
            }

            userTarget = user

            return models.Comment
                .findOne({ id: idComment, status: { $ne: 'removed' }})
                .populate({
                    path: 'post',
                    populate: { path: 'channel', model: 'Channel', select: 'id' },
                    select: 'channel public'
                })
                .exec()
        })
        .then(comment => {
            if(!comment) {
                throw { code: -2, message: 'No comment found.' }
            }

            commentTarget = comment
            postTarget = comment.post

            if(!postTarget.public) {
                const channel = postTarget.channel
                const isSuper = userTarget.super && userTarget.superActive

                if(
                    !userTarget.channelsModerator.includes(channel._id) &&
                    !userTarget.channelsSubscribed.includes(channel._id) &&
                    !isSuper
                ) {
                    throw { code: 1, message: 'No access.' }
                }
            }

            // Add to favorites.
            if(!userTarget.commentsFavorited.includes(commentTarget._id)) {
                userTarget.commentsFavorited.push(commentTarget._id)
            }

            // Remove from favorites.
            else {
                userTarget.commentsFavorited.splice(userTarget.commentsFavorited.indexOf(commentTarget._id), 1)
            }

            return userTarget.save()
        })
        .then(user => {
            const favorited = user.commentsFavorited.includes(commentTarget._id)

            res.json({ code: 0, favorited })
            processAnalytics(req, 'event', {
                eventCategory: 'comment',
                eventAction: favorited ? 'favorite' : 'unfavorite',
                eventLabel: postTarget.channel.id
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error favoriting a comment:', error.message)

            res.json({ code: error.code })
        })
	})

    /*
        MODERATION.
    */

    router.route('/c/post/aprovar')
    .post(authRequired, async(req, res) => {
        const ids = req.body.ids
        const user = await models.User.findOne({ _id: req.user._id, status: 'active'}).exec()

        if(!user) {
            return res.json({ code: -1 })
        }

        const posts = await models.Post
            .find({ id: { $in: ids }, status: { $nin: ['archived', 'removed']}})
            .populate('channel', 'id admins moderators')
            .exec()

        if(!posts.length) {
            return res.json({ code: -2 })
        }

        // First validate all posts.
        for(const post of posts) {
            const channel = post.channel

            // If no permissions.
            if(
                !channel.admins.includes(user._id) &&
                !channel.moderators.includes(user._id) &&
                (!user.super || !user.superActive)
            ) {
                return res.json({ code: 2 })
            }
        }

        // Approve each post.
        for(const post of posts) {
            if(post.status == 'submitted' || (post.status == 'published' && post.flags.length)) {
                channelsm.removedPostFromQueue(post.channel.id)

                processAnalytics(req, 'event', {
                    eventCategory: 'post',
                    eventAction: 'approve',
                    eventLabel: post.channel.id
                })
            }

            post.status = 'approved'
            post.save()
        }

        res.json({ code: 0 })
    })

    router.route('/c/post/trancar')
    .post(authRequired, async(req, res) => {
        const ids = req.body.ids
        const user = await models.User.findOne({ _id: req.user._id, status: 'active'}).exec()

        if(!user) {
            return res.json({ code: -1 })
        }

        const posts = await models.Post
            .find({ id: { $in: ids }, status: { $nin: ['archived', 'removed']}})
            .populate('channel', 'admins id moderators')
            .exec()

        if(!posts.length) {
            return res.json({ code: -2 })
        }

        let lock = false

        // First validate all posts.
        for(const post of posts) {
            const channel = post.channel

            if(!post.locked) {
                lock = true
            }

            // If no permissions.
            if(
                !channel.admins.includes(user._id) &&
                !channel.moderators.includes(user._id) &&
                (!user.super || !user.superActive)
            ) {
                return res.json({ code: 2 })
            }
        }

        // Lock each post.
        for(const post of posts) {
            post.locked = lock
            post.save()

            processAnalytics(req, 'event', {
                eventCategory: 'post',
                eventAction: lock ? 'lock' : 'unlock',
                eventLabel: post.channel.id
            })
        }

        res.json({ code: 0, lock })
    })

    router.route('/c/post/rejeitar')
    .post(authRequired, async(req, res) => {
        const ids = req.body.ids
        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -1 })
        }

        const posts = await models.Post
            .find({ id: { $in: ids }, status: { $nin: ['archived', 'removed']}})
            .populate('channel', 'id admins moderators')
            .exec()

        if(!posts.length) {
            return res.json({ code: -2 })
        }

        // First validate all posts.
        for(const post of posts) {
            const channel = post.channel

            // If no permissions.
            if(
                !channel.admins.includes(user._id) &&
                !channel.moderators.includes(user._id) &&
                (!user.super || !user.superActive)
            ) {
                return res.json({ code: 2 })
            }
        }

        // Reject each post.
        for(const post of posts) {
            if(post.status == 'submitted' || (post.status == 'published' && post.flags.length)) {
                channelsm.removedPostFromQueue(post.channel.id)

                processAnalytics(req, 'event', {
                    eventCategory: 'post',
                    eventAction: 'reject',
                    eventLabel: post.channel.id
                })
            }

            if(!['autorejected', 'rejected'].includes(post.status)) {
                sendNotification({
                    channel: post.channel._id,
                    post: post._id,
                    receiver: post.creator,
                    type: 'postReject'
                })
            }

            post.status = 'rejected'
            post.save()
        }

        res.json({ code: 0 })
    })

    router.route('/c/comentario/aprovar')
    .post(authRequired, async(req, res) => {
        const ids = req.body.ids
        const user = await models.User.findOne({ _id: req.user._id, status: 'active'}).exec()

        if(!user) {
            return res.json({ code: -1 })
        }

        const comments = await models.Comment
            .find({ id: { $in: ids }, status: { $ne: 'removed' }})
            .populate({
                path: 'post',
                populate: { path: 'channel', model: 'Channel', select: 'id admins moderators' }
            })
            .exec()

        if(!comments.length) {
            return res.json({ code: -2 })
        }

        // First validate all comments.
        for(const comment of comments) {
            const post = comment.post
            const channel = post.channel

            // If no permissions.
            if(
                !channel.admins.includes(user._id) &&
                !channel.moderators.includes(user._id) &&
                (!user.super || !user.superActive)
            ) {
                return res.json({ code: 2 })
            }
        }

        // Approve each comment.
        for(const comment of comments) {
            if(comment.status == 'submitted' || (comment.status == 'published' && comment.flags.length)) {
                channelsm.removedCommentFromQueue(comment.post.channel.id)

                processAnalytics(req, 'event', {
                    eventCategory: 'comment',
                    eventAction: 'approve',
                    eventLabel: comment.post.channel.id
                })
            }

            comment.status = 'approved'
            comment.save()
        }

        res.json({ code: 0 })
    })

    router.route('/c/comentario/rejeitar')
    .post(authRequired, async(req, res) => {
        const ids = req.body.ids
        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -1 })
        }

        const comments = await models.Comment
            .find({ id: { $in: ids }, status: { $ne: 'removed' }})
            .populate({
                path: 'post',
                populate: { path: 'channel', model: 'Channel', select: 'id admins moderators' }
            })
            .exec()

        if(!comments.length) {
            return res.json({ code: -2 })
        }

        // First validate all comments.
        for(const comment of comments) {
            const post = comment.post
            const channel = post.channel

            // If no permissions.
            if(
                !channel.admins.includes(user._id) &&
                !channel.moderators.includes(user._id) &&
                (!user.super || !user.superActive)
            ) {
                return res.json({ code: 2 })
            }
        }

        // Reject each comment.
        for(const comment of comments) {
            if(comment.status == 'submitted' || (comment.status == 'published' && comment.flags.length)) {
                channelsm.removedCommentFromQueue(comment.post.channel.id)

                processAnalytics(req, 'event', {
                    eventCategory: 'comment',
                    eventAction: 'reject',
                    eventLabel: comment.post.channel.id
                })
            }

            if(!['autorejected', 'rejected'].includes(comment.status)) {
                sendNotification({
                    channel: comment.post.channel._id,
                    comment: comment._id,
                    post: comment.post._id,
                    receiver: comment.creator,
                    type: 'commentReject'
                })
            }

            comment.status = 'rejected'
            comment.save()
        }

        res.json({ code: 0 })
    })

    /*
        PIN.
    */

    router.route('/c/post/afixar')
    .post(authRequired, async(req, res) => {
        const idPost = req.body.id
        const where = req.body.where

        if(!['channel', 'profile'].includes(where)) {
            return res.json({ code: 1 })
        }

        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -1 })
        }

        // Pin to channel.
        if(where == 'channel') {
            const post = await models.Post
            .findOne({ id: idPost, status: { $ne: 'removed' }})
            .populate('channel', 'admins id moderators')

            if(!post) {
                return res.json({ code: -2 })
            }

            const channel = post.channel

            // If no permissions.
            if(
                !channel.admins.includes(user._id) &&
                !channel.moderators.includes(user._id) &&
                (!user.super || !user.superActive)
            ) {
                return res.json({ code: 2 })
            }

            post.pinnedToChannel = !post.pinnedToChannel

            post.save()

            res.json({ code: 0, pinned: post.pinnedToChannel })
            processAnalytics(req, 'event', {
                eventCategory: 'post',
                eventAction: post.pinnedToChannel ? 'pinToChannel' : 'unpinFromChannel',
                eventLabel: channel.id
            })
        }
        // Pin to user profile.
        else {
            const post = await models.Post
            .findOne({ id: idPost, creator: req.user._id, status: { $ne: 'removed' }})

            if(!post) {
                return res.json({ code: -2 })
            }

            post.pinnedToProfile = !post.pinnedToProfile

            post.save()

            res.json({ code: 0, pinned: post.pinnedToProfile })
            processAnalytics(req, 'event', {
                eventCategory: 'post',
                eventAction: post.pinnedToProfile ? 'pinToProfile' : 'unpinFromProfile',
                eventLabel: ''
            })
        }
    })

    router.route('/c/comentario/afixar')
    .post(authRequired, async(req, res) => {
        const idComment = req.body.id
        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -1 })
        }

        const comment = await models.Comment
            .findOne({ id: idComment, status: { $ne: 'removed' }})
            .populate({
                path: 'post',
                populate: { path: 'channel', model: 'Channel', select: 'admins id moderators' }
            })
            .exec()

        if(!comment) {
            return res.json({ code: -2 })
        }

        if(comment.parent) {
            return res.json({ code: 1 })
        }

        const post = comment.post
        const channel = post.channel

        // If no permissions.
        if(
            !channel.admins.includes(user._id) &&
            !channel.moderators.includes(user._id) &&
            (!user.super || !user.superActive)
        ) {
            return res.json({ code: 2 })
        }

        comment.pinned = !comment.pinned

        comment.save()

        res.json({ code: 0, pinned: comment.pinned })
        processAnalytics(req, 'event', {
            eventCategory: 'comment',
            eventAction: comment.pinned ? 'pin' : 'unpin',
            eventLabel: channel.id
        })
    })

    /*
        USERS.
    */

    router.route('/u/:username')
	.get(async(req, res) => {
        const username = req.params.username
        const population = [{
            path: 'channelsModerator', select: 'id image'
        }]
        let isSuper = false

        if(req.user) {
            const user = await models.User.findOne({ _id: req.user._id, status: 'active' })

            if(user && user.super && user.superActive) {
                isSuper = true

                population.push({
                    path: 'flags.user', select: 'image username'
                })
            }
        }

        models.User
            .findOne({
                username: { $regex : new RegExp(username, 'i')},
                status: { $in: ['active', 'banned']}
            })
            .populate(population)
            .exec()
        .then(user => {
            if(!user) {
                throw { code: 1 }
            }

            const isPrivate = user.preferences.privateProfile
            const data = { private: isPrivate }

            if(isSuper) {
                data.flags = user.flags
            }

            this.render(template, {
                page: 'channels',
                pane: 'user',
                data: { ...data, ...user.toJSON()}
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            this.render(template, { page: 'error' })
        })
	})

    router.route('/utilizador/denunciar')
    .post(authRequired, async(req, res) => {
        const username = req.body.id
        const type = req.body.flag
        const text = req.body.text

        const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

        if(!user) {
            return res.json({ code: -1 })
        }

        const userTarget = await models.User
            .findOne({ username, status: { $ne: 'removed' }})
            .populate('flags.user')

        if(!userTarget) {
            return res.json({ code: -2 })
        }

        let alreadyReportedByUser = false

        for(const flag of userTarget.flags) {
            if(String(flag.user._id) == String(user._id)) {
                flag.text = text
                flag.type = type

                alreadyReportedByUser = true

                break
            }
        }

        if(!alreadyReportedByUser) {
            userTarget.flags.push({ text, type, user: user._id })
        }

        await userTarget.save()

        res.json({ code: 0 })
        processAnalytics(req, 'event', {
            eventCategory: 'user',
            eventAction: 'report',
            eventLabel: type
        })
    })

    router.route('/u/:username/banir')
	.post(authRequired, async(req, res) => {
        const username = req.params.username

        const user = await models.User.findOne({ username, status: { $in: ['active', 'banned']}})

        if(!user) {
            return res.json({ code: -1 })
        }

        if(user.status == 'active') {
            user.status = 'banned'
        }
        else {
            user.status = 'active'
        }

        user.save()

        res.json({ code: 0, banned: user.status == 'banned' })
	})
}