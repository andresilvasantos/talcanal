const channelsm = require('@server/channels-manager')
const mongoose = require('mongoose')
const newsm = require('@server/news-manager')
const serverm = require('@server/server-manager')
const { processAnalytics, setupFilter } = require('@server/utils')
const { models } = require('mongoose')

function modelFromType(type) {
    switch(type) {
    case 'channels':
        return { schema: models.Channel, keysFilter: ['id', 'name'] }
    case 'chats':
        return { schema: models.Chat }
    case 'comments':
        return { schema: models.Comment, keysFilter: ['text'] }
    case 'messages':
        return { schema: models.Message, keysFilter: ['text'] }
    case 'news':
        return { schema: models.News, keysFilter: ['title'] }
    case 'notifications':
        return { schema: models.Notification }
    case 'posts':
        return { schema: models.Post, keysFilter: ['title'] }
    case 'users':
        return { schema: models.User, keysFilter: ['username'] }
    }

    return null
}

const sortFromQuery = (query, typeData) => {
    if(query.startsWith('top')) {
        switch(typeData) {
            case 'channels':
                return 'countSubscribers'
            case 'users':
                return 'karma'
            case 'news':
                return 'countClicks'
        }

        return 'countVotes'
    }

    switch(query) {
        case 'new':
            return typeData == 'news' ? 'date' : 'createdAt'
        case 'old':
            return typeData == 'news' ? '-date' : '-createdAt'
        case 'az':
            return typeData == 'users' ? '-username' : '-title'
        case 'za':
            return typeData == 'users' ? 'username' : 'title'
        case 'trending':
            return 'scoreTrend'
        case 'update':
            return 'updatedAt'
    }

    return 'createdAt'
}

module.exports = function(router) {
    router.route('/data/:id')
	.get(async (req, res) => {
        const typeData = req.params.id
        const model = modelFromType(typeData)

        if(!model) {
            return res.json({ code: -2 })
        }

        const query = req.query || {}
        let filter = query.filter || ''
        const filtersExtra = JSON.parse(query.filtersExtra || '{}')
        const itemsPerPage = Math.min(parseInt(query.itemsPerPage) || finder.fetchLimit, 50)
        const skip = parseInt(query.pageCurrent || 0) * itemsPerPage
        const sort = sortFromQuery(query.keySort, typeData)
        const population = []

        let user = null

        if(model.keysFilter) {
            filter = setupFilter(filter, model.keysFilter)

            Object.keys(filtersExtra).forEach((keyExtraFilter) => {
                filter[keyExtraFilter] = filtersExtra[keyExtraFilter]
            })
        }
        else {
            filter = {}
        }

        const data = { code: 0, countTotal: 0 }
        const addFields = {}
        const addFieldsBeforeObj = {}
        const addFieldsAfterObj = {}
        let lookup
        let limitDisabled = false
        const match = {}
        let sortObj = {}
        const setFields = []
        const unsetFields = []
        let unwind

        sortObj[sort] = -1

        if(query.keySort.startsWith('top')) {
            sortObj = { ...sortObj, createdAt: -1 }

            if(query.keySort != 'top' && query.keySort != 'topAllTime') {
                const dayMs = 1000 * 60 * 60 * 24
                let numberDays = 1

                switch(query.keySort) {
                    case 'topWeek':
                        numberDays = 7
                        break
                    case 'topMonth':
                        numberDays = 30
                        break
                    case 'topYear':
                        numberDays = 365
                        break
                }

                filter.createdAt = { $gte: new Date((new Date().getTime() - (dayMs * numberDays)))}
            }
        }

        // Post.
        if(model.schema == models.Post) {
            population.push({
                path: 'channel',
                select: 'id admins image moderators name subscribers tags'
            })
            population.push({ path: 'creator', select: 'image status super username' })
            population.push({ path: 'flags.user', select: 'image username' })
            unsetFields.push('comments', 'votes', 'poll.options.votes')

            // Fetch user if there's one.
            if(req.user) {
                user = await models.User.findOne({ _id: req.user._id, status: 'active'})

                if(!user) {
                    return res.json({ code: 1 })
                }

                if(!filter['$and']) {
                    filter['$and'] = []
                }

                if(!user.super || !user.superActive) {
                    const or = []

                    filter['$and'].push({ $or: or })

                    or.push({ public: true })
                    or.push({ creator: user._id })
                    or.push({ 'channelDetails.admins': user._id })
                    or.push({ 'channelDetails.moderators': user._id })
                    or.push({ 'channelDetails.members': user._id })

                    // Do the lookup so we can search for channel properties.
                    lookup = {
                        from: 'channels',
                        localField: 'channel',
                        foreignField: '_id',
                        as: 'channelDetails'
                    }
                }

                if(!user.preferences.allowAdultContent) {
                    filter['$and'].push({ $or: [{ adultContent: false }, { creator: user._id }]})
                }

                filter['$and'].push({ creator: { $nin: user.usersBlocked }})
            }
            else {
                filter['public'] = true
                filter['adultContent'] = false
            }

            // Posts from user.
            if(filtersExtra.creator) {
                if(
                    !user ||
                    (
                        !user.super &&
                        !user.superActive &&
                        filter['creator'] != mongoose.Types.ObjectId(user._id)
                    )
                ) {
                    const creator = await models.User.findOne({ _id: filter['creator'] })

                    if(creator.preferences.privateProfile) {
                        return res.json(data)
                    }
                }

                filter['creator'] = mongoose.Types.ObjectId(filter['creator'])
                filter['status'] = { $ne: 'removed' }

                sortObj = { pinnedToProfile: -1, ...sortObj }
            }
            // Posts from single channel.
            else if(filtersExtra.channel) {
                filter['channel'] = mongoose.Types.ObjectId(filter['channel'])
                filter['status'] = { $in: ['published', 'approved', 'archived']}

                // Fetching for mods.
                if(filtersExtra.filterStatus) {
                    if(
                        !user || ((!user.super || !user.superActive) &&
                        !user.channelsModerator.includes(filter['channel']))
                    ) {
                        return res.json({ code: 1 })
                    }

                    delete filter.filterStatus

                    switch(filtersExtra.filterStatus) {
                        case 'queue':
                            delete filter.status

                            filter['$and'].push({
                                $or: [
                                    { status: 'submitted' },
                                    { $and: [
                                        {
                                            status: 'published',
                                            flags: { $exists: true, $not: { $size: 0 }}
                                        }
                                    ]}
                                ]
                            })
                            break
                        case 'approved':
                            filter['status'] = 'approved'
                            break
                        case 'autoRejected':
                            filter['status'] = 'autorejected'
                            break
                        case 'rejected':
                            filter['status'] = 'rejected'
                            break
                        case 'reported':
                            filter['flags'] = { $exists: true, $not: { $size: 0 }}
                            break
                        case 'unmoderated':
                            filter['status'] = { $in: ['submitted', 'published']}
                            break
                        default:
                            return res.json({ code: 2 })
                    }
                }
                else if(filtersExtra.rejected) {
                    delete filter.rejected

                    filter['status'] = { $in: ['rejected', 'autorejected']}
                }

                sortObj = { pinnedToChannel: -1, ...sortObj }
            }
            // Posts from combination of channels (sub, mod, popular, all).
            else if(filtersExtra.channels) {
                filter['status'] = { $in: ['published', 'approved', 'archived']}

                delete filter.channels

                // Make sure channel is active, unless favorites or super.
                if(filtersExtra.channels != 'favorites' && (!user || !user.super || !user.superActive)) {
                    if(!filter['$and']) {
                        filter['$and'] = []
                    }

                    if(!lookup) {
                        // Do the lookup so we can search for channel properties.
                        lookup = {
                            from: 'channels',
                            localField: 'channel',
                            foreignField: '_id',
                            as: 'channelDetails'
                        }
                    }

                    filter['$and'].push({ 'channelDetails.status': 'active' })
                }

                if(filtersExtra.channels == 'sub' || filtersExtra.channels == 'mod') {
                    if(!req.user) {
                        return res.json({ code: 1 })
                    }

                    const ids = []

                    const channels = (
                        filtersExtra.channels == 'sub' ?
                        user.channelsSubscribed :
                        user.channelsModerator
                    )

                    for(const channel of channels) {
                        ids.push(channel._id)
                    }

                    if(!ids) {
                        data[typeData] = []

                        return res.json(data)
                    }

                    filter['channel'] = { $in: ids }
                }
                else if(filtersExtra.channels == 'popular') {
                    const ids = []

                    for(const channel of channelsm.getChannelsPopular()) {
                        ids.push(channel._id)
                    }

                    filter['channel'] = { $in: ids }
                }
                else if(filtersExtra.channels == 'favorites') {
                    if(!user) {
                        return res.json({ code: 1 })
                    }

                    const ids = []

                    for(const post of user.postsFavorited) {
                        ids.push(post._id)
                    }

                    if(!ids) {
                        data[typeData] = []

                        return res.json(data)
                    }

                    filter['_id'] = { $in: ids }
                }
                else if(filtersExtra.channels != 'all') {
                    return res.json({ code: 3 })
                }
            }
            else if(filtersExtra.id) {
                filter['status'] = { $ne: 'removed' }

                // Set seen by this user.
                if(user) {
                    models.Post.findOneAndUpdate(
                        { id: filtersExtra.id, views: { $ne: user._id }}, { $push: { views: user._id }}
                    ).exec()
                }
            }
            else {
                return res.json({ code: 2 })
            }

            addFields.countComments = { $size: '$comments' }
            addFields.countVotes = { $subtract: [{ $size: '$votes.up' }, { $size: '$votes.down' }] }

            // Add poll field if post is a poll.
            addFieldsAfterObj.poll = {
                $cond: [
                    { $eq: ['$type', 'poll'] },
                    {
                        $mergeObjects: [
                            { duration: '$poll.duration' },
                            {
                                options: {
                                    $map: {
                                        input: '$poll.options',
                                        as: 'option',
                                        in: {
                                            countVotes: { $size: '$$option.votes' },
                                            ...(req.user) && {
                                                hasUserVoted: {
                                                    $in: [
                                                        mongoose.Types.ObjectId(req.user._id),
                                                        '$$option.votes'
                                                    ]
                                                }
                                            },
                                            name: '$$option.name'
                                        }
                                    }
                                }
                            }
                        ]
                    },
                    '$$REMOVE'
                ]
            }

            if(req.user) {
                addFieldsAfterObj.hasUserDownvoted = { $in: [mongoose.Types.ObjectId(req.user._id), '$votes.down']}
                addFieldsAfterObj.hasUserUpvoted = { $in: [mongoose.Types.ObjectId(req.user._id), '$votes.up']}
                addFieldsAfterObj.hasUserFavorited = { $in: ['$_id', user.postsFavorited]}
                addFieldsAfterObj.hasUserSeen =  { $in: [mongoose.Types.ObjectId(req.user._id), '$views']}
            }

            if(sort.includes('scoreTrend')) {
                if(!lookup) {
                    // Do the lookup so we can search for channel properties.
                    lookup = {
                        from: 'channels',
                        localField: 'channel',
                        foreignField: '_id',
                        as: 'channelDetails'
                    }
                }

                addFieldsBeforeObj.scoreTrend = { $add : [
                    { $multiply: [ // Multiply vote count by 10.
                        { $subtract: ['$countVotes', 1]}, // Remove creator upvote.
                        10
                    ]},
                    { $multiply: [
                        { $divide: [ // Divide vote count by subscribers counts and multiply by 100.
                                { $subtract: ['$countVotes', 1]}, // Remove creator upvote.
                                { $max: [{ $size: { $arrayElemAt: ['$channelDetails.subscribers', 0]}}, 1]}
                        ]},
                        100
                    ]},
                    { $divide: [ { $subtract: ['$createdAt', new Date()]}, 1000 * 60 ]}
                ]}
            }

            if(filter['$and'] && !filter['$and'].length) {
                delete filter['$and']
            }
        }
        // Channel.
        else if(model.schema == models.Channel) {
            population.push({ path: 'admins', select: 'image username' })
            population.push({ path: 'moderators', select: 'image username' })
            unsetFields.push(
                'memberRequests', 'members', 'posts', 'subscribeInvites',
                'subscribeRequests', 'subscribers', 'usersBanned'
            )

            if(req.user) {
                user = await models.User
                    .findOne({ _id: req.user._id, status: 'active' })
                    .populate('channelsSubscribed', 'id image name status')
                    .populate('channelsModerator', 'id image name status')

                if(!user) {
                    return res.json({ code: 1 })
                }

                if(!user.preferences.allowAdultContent) {
                    if(!filter['$and']) {
                        filter['$and'] = []
                    }

                    filter['$and'].push({ adultContent: false })
                }
            }
            else if(!filtersExtra.id) {
                filter['adultContent'] = false
            }

            if(!user || !user.super || !user.superActive) {
                filter['status'] = 'active'
            }

            if(filtersExtra.myChannels) {
                if(!user) {
                    return res.json({ code: 1 })
                }

                const channelsSubscribed = user.channelsSubscribed
                    .filter(channel => channel.status == 'active')
                const channelsModerator = user.channelsModerator
                    .filter(channel => channel.status == 'active')

                const data = { code: 0, countTotal: channelsSubscribed.length }

                data[typeData] = { sub: channelsSubscribed, mod: channelsModerator }

                return res.json(data)
            }
            else if(filtersExtra.toPost) {
                if(!user) {
                    return res.json({ code: 1 })
                }

                if(!filtersExtra.ids.length) {
                    return res.json({ code: 2 })
                }

                delete filter.toPost
                delete filter.ids

                limitDisabled = true

                filter['id'] = { $in: filtersExtra.ids }

                if(!user.super || !user.superActive) {
                    // Not banned and channel is public, or mod / member.
                    if(!filter['$and']) {
                        filter['$and'] = []
                    }

                    filter['$and'].push({ $or: [
                        { type: 'public' },
                        { $or: [{ admins: user._id }, { moderators: user._id }, { members: user._id }]}
                    ]})
                    filter['$and'].push({ usersBanned: { $ne: user._id }})
                }
            }

            addFieldsAfterObj.countPosts = { $size: '$posts' }
            addFieldsBeforeObj.countSubscribers = { $size: '$subscribers' }

            if(user) {
                addFieldsAfterObj.isUserAdmin = { $in: [user._id, '$admins']}
                addFieldsAfterObj.isUserMember = { $in: [user._id, '$members']}
                addFieldsAfterObj.isUserModerator = {
                    $or: [
                        { $in: [user._id, '$admins']},
                        { $in: [user._id, '$moderators']}
                    ]
                }
                addFieldsAfterObj.isUserSubscribed = { $in: [user._id, '$subscribers']}
                addFieldsAfterObj.isUserBanned = { $in: [user._id, '$usersBanned']}
            }
        }
        // Comment.
        else if(model.schema == models.Comment) {
            population.push({ path: 'creator', select: 'image status super username' })
            population.push({ path: 'flags.user', select: 'image username' })
            population.push({ path: 'parent', select: 'id' })
            population.push({ path: 'replies', select: 'id' })

            addFieldsAfterObj.creator = { $cond: [{ $eq: ['$status', 'removed']}, '$$REMOVE', '$creator']}
            addFieldsAfterObj.text = { $cond: [{ $eq: ['$status', 'removed']}, '$$REMOVE', '$text']}
            addFieldsAfterObj.textOriginal = { $cond: [{ $eq: ['$status', 'removed']}, '$$REMOVE', '$textOriginal']}

            addFields.countVotes = { $subtract: [{ $size: '$votes.up' }, { $size: '$votes.down' }] }

            // Fetch user if there's one.
            if(req.user) {
                user = await models.User.findOne({ _id: req.user._id, status: 'active'})

                if(!user) {
                    return res.json({ code: 1 })
                }

                if(!filter['$and']) {
                    filter['$and'] = []
                }

                filter['$and'].push({ creator: { $nin: user.usersBlocked }})

                addFieldsAfterObj.hasUserDownvoted = { $in: [mongoose.Types.ObjectId(req.user._id), '$votes.down']}
                addFieldsAfterObj.hasUserUpvoted = { $in: [mongoose.Types.ObjectId(req.user._id), '$votes.up']}
                addFieldsAfterObj.hasUserFavorited = { $in: ['$_id', user.commentsFavorited]}
            }

            // Comments of user.
            if(filtersExtra.creator) {
                population.push({
                    path: 'post',
                    populate: { path: 'channel', model: 'Channel', select: 'id admins moderators' },
                    select: 'id channel status title'
                })

                if(
                    !user ||
                    (
                        !user.super &&
                        !user.superActive &&
                        filter['creator'] != mongoose.Types.ObjectId(user._id)
                    )
                ) {
                    const creator = await models.User.findOne({ _id: filter['creator'] })

                    if(creator.preferences.privateProfile) {
                        return res.json(data)
                    }

                    lookup = {
                        from: 'posts',
                        localField: 'post',
                        foreignField: '_id',
                        as: 'postDetails'
                    }

                    filter['postDetails.public'] = true
                }

                filter['creator'] = mongoose.Types.ObjectId(filter['creator'])
                filter['status'] = { $ne: 'removed' }
            }
            // Comments of post.
            else if(filtersExtra.post) {
                const post = await models.Post.findOne({ id: filtersExtra.post })

                if(!post) {
                    return res.json({ code: 2 })
                }

                if(req.user) {
                    if(!post.views.includes(req.user._id)) {
                        post.views.push(req.user._id)
                        post.save()
                    }
                }

                filter['post'] = post._id
                limitDisabled = true

                sortObj = { pinned: -1, ...sortObj }
            }
            // Comments from single channel.
            else if(filtersExtra.channel) {
                population.push({
                    path: 'post',
                    populate: { path: 'channel', model: 'Channel', select: 'id admins moderators' },
                    select: 'id channel status title'
                })

                const idChannel = filter['channel']

                delete filter.channel

                // Only moderators or super can view all comments for a channel.
                if(!user || (
                    !user.channelsModerator.includes(idChannel) &&
                    (!user.super || !user.superActive)
                )) {
                    return res.json({ code: 1 })
                }

                // Do the lookup so we can search for channel _id.
                lookup = {
                    from: 'posts',
                    localField: 'post',
                    foreignField: '_id',
                    as: 'postDetails'
                }

                filter['postDetails.channel'] = mongoose.Types.ObjectId(idChannel)

                // Fetching for mods.
                if(filtersExtra.filterStatus) {
                    delete filter.filterStatus

                    switch(filtersExtra.filterStatus) {
                        case 'queue':
                            delete filter.status

                            if(!filter['$and']) {
                                filter['$and'] = []
                            }

                            filter['$and'].push({
                                $or: [
                                    { status: 'submitted' },
                                    { $and: [
                                        {
                                            status: 'published',
                                            flags: { $exists: true, $not: { $size: 0 }}
                                        }
                                    ]}
                                ]
                            })
                            break
                        case 'approved':
                            filter['status'] = 'approved'
                            break
                        case 'autoRejected':
                            filter['status'] = 'autorejected'
                            break
                        case 'rejected':
                            filter['status'] = 'rejected'
                            break
                        case 'reported':
                            filter['flags'] = { $exists: true, $not: { $size: 0 }}
                            break
                        case 'unmoderated':
                            filter['status'] = { $in: ['submitted', 'published']}
                            break
                        default:
                            return res.json({ code: 2 })
                    }
                }
                else {
                    return res.json({ code: 3 })
                }
            }
            // User favorites.
            else if(filtersExtra.channels == 'favorites') {
                population.push({
                    path: 'post',
                    populate: { path: 'channel', model: 'Channel', select: 'id' },
                    select: 'id channel title'
                })

                delete filter.channels

                if(!req.user) {
                    return res.json({ code: 1 })
                }

                const ids = []

                for(const comment of user.commentsFavorited) {
                    ids.push(comment._id)
                }

                filter['_id'] = { $in: ids }
            }
            else {
                return res.json({ code: 3 })
            }

            if(sort.includes('scoreTrend')) {
                addFieldsBeforeObj.scoreTrend = { $add : [
                    { $multiply: ['$countVotes', 10]},
                    { $divide: [ { $subtract: ['$createdAt', new Date()]}, 1000 * 60 ]}
                ]}
            }
        }
        // User.
        else if(model.schema == models.User) {
            setFields.push('image', 'username')

            filter.status = 'active'

            // If we have an array of users to exclude.
            if(filtersExtra.exclude) {
                if(!req.user) {
                    return res.json({ code: 1 })
                }

                delete filter.exclude

                const ids = []

                for(const id of filtersExtra.exclude) {
                    ids.push(mongoose.Types.ObjectId(id))
                }

                filter['_id'] = { $nin: ids }
                // TODO check usersBlocked
            }

            // Send message? Then if no filter query, show users from chats already started.
            if(filtersExtra.sendMessage) {
                if(!req.user) {
                    return res.json({ code: 1 })
                }

                delete filter.sendMessage

                const idUser = mongoose.Types.ObjectId(req.user._id)

                // If no filter string, return users that user has started chat with.
                if(!query.filter.length) {
                    const user = await models.User
                        .findOne({ _id: idUser, status: 'active'})
                        .populate({
                            path: 'chats.chat',
                            populate: { path: 'users', model: 'User', select: 'image username' },
                            select: 'users'
                        })

                    if(!user) {
                        return res.json({ code: 1 })
                    }

                    const users = []

                    for(const chatObj of user.chats) {
                        for(const userOfChat of chatObj.chat.users) {
                            if(userOfChat._id == String(idUser)) {
                                continue
                            }

                            users.push(userOfChat)
                        }
                    }

                    if(users.length) {
                        data[typeData] = users
                        data.countTotal = users.length

                        return res.json(data)
                    }
                }

                filter['_id'] = { $ne: idUser }
            }
            // New chat?
            else if(filtersExtra.chat) {
                if(!req.user) {
                    return res.json({ code: 1 })
                }

                delete filter.chat

                const idUser = mongoose.Types.ObjectId(req.user._id)

                // Search for users that user has already started a chat with.
                const user = await models.User
                    .findOne({ _id: idUser, status: 'active'})
                    .populate({
                        path: 'chats.chat',
                        populate: { path: 'users', model: 'User', select: 'image username' },
                        select: 'users'
                    })

                if(!user) {
                    return res.json({ code: 1 })
                }

                const ids = []

                for(const chatObj of user.chats) {
                    if(chatObj.status == 'removed') {
                        continue
                    }

                    for(const userOfChat of chatObj.chat.users) {
                        if(userOfChat._id == String(idUser)) {
                            continue
                        }

                        ids.push(userOfChat._id)
                    }
                }

                // Exclude self.
                filter['_id'] = { $ne: idUser }

                if(!filter['$and']) {
                    filter['$and'] = []
                }

                // Check if user target has chat requests enable or user has already started a chat with.
                filter['$and'].push({
                    $or: [
                        { 'preferences.disableChatRequests': false },
                        { '_id': { $in: ids }}
                    ]
                })
            }
            // Users from a channel (mod or super only).
            else if(filtersExtra.channel) {
                setFields.push('isAdmin', 'isMember', 'isMod', 'isBanned')

                if(!req.user) {
                    return res.json({ code: 1 })
                }

                delete filter.channel
                delete filter.banned
                delete filter.members
                delete filter.requests
                delete filter.toMod

                const idChannel = filtersExtra.channel
                const idUser = mongoose.Types.ObjectId(req.user._id)
                const user = await models.User.findOne({ _id: idUser, status: 'active'})

                if(!user) {
                    return res.json({ code: 1 })
                }

                const channel = await models.Channel
                    .findOne({ id: idChannel })
                    .populate('memberRequests.user', 'image username')

                if(!channel) {
                    return res.json({ code: 2 })
                }

                const moderators = channel.moderators.concat(channel.admins)
                const isMod = moderators.includes(user._id)

                if(!isMod && (!user.super || !user.superActive)) {
                    return res.json({ code: 1 })
                }

                // Member requests.
                if(filtersExtra.requests) {
                    if(channel.type != 'private') {
                        return res.json({ code: 2 })
                    }

                    let memberRequests = channel.memberRequests.map(request => {
                        const user = request.user.toJSON()
                        user.text = request.text

                        return user
                    })

                    if(query.filter.length) {
                        memberRequests = memberRequests.filter(user => {
                            return user.username.toLowerCase().indexOf(query.filter.toLowerCase()) > -1
                        })
                    }

                    data[typeData] = memberRequests
                    data.countTotal = memberRequests.length

                    return res.json(data)
                }

                if(!query.filter.length) {
                    if(filtersExtra.banned) {
                        filter['_id'] = { $in: channel.usersBanned }
                    }
                    else if(filtersExtra.members) {
                        if(channel.type == 'public') {
                            return res.json({ code: 2 })
                        }

                        filter['_id'] = { $in: channel.members.concat(moderators)}
                    }
                    else if(filtersExtra.toMod) {
                        if(!filter['$and']) {
                            filter['$and'] = []
                        }

                        filter['$and'].push({ _id: filter['_id']})
                        filter['$and'].push({ _id: { $in: channel.members.concat(moderators)}})

                        delete filter['_id']
                    }
                }

                addFieldsAfterObj.isAdmin = { $in: ['$_id', channel.admins]}
                addFieldsAfterObj.isMember = { $in: ['$_id', channel.members]}
                addFieldsAfterObj.isMod = { $in: ['$_id', channel.moderators]}
                addFieldsAfterObj.isBanned = { $in: ['$_id', channel.usersBanned]}
            }
            // Single user or explore.
            else {
                population.push({ path: 'channelsModerator', select: 'id image' })

                setFields.push(
                    'bio', 'channelsModerator', 'chatRequestsDisabled', 'countComments',
                    'countPosts', 'createdAt', 'karma', 'private', 'status'
                )

                addFieldsAfterObj.chatRequestsDisabled = '$preferences.disableChatRequests'
                addFieldsAfterObj.countComments = { $size: '$comments' }
                addFieldsAfterObj.countPosts = { $size: '$posts' }
                addFieldsAfterObj.private = '$preferences.privateProfile'

                // TODO if super, load up all details
                if(req.user) {
                    const user = await models.User.findOne({ _id: req.user._id, status: 'active'})

                    if(user && user.super && user.superActive) {
                        population.push({ path: 'flags.user', select: 'image username' })
                        setFields.push('flags')
                    }
                }
            }
        }
        // Chats.
        else if(model.schema == models.Chat) {
            setFields.push('id', 'messageLast', 'users')
            population.push({
                path: 'users',
                select: 'username image'
            })
            population.push({
                path: 'messageLast',
                select: 'text time'
            })

            if(!req.user) {
                return res.json({ code: 1 })
            }

            user = await models.User.findOne({
                _id: mongoose.Types.ObjectId(req.user._id),
                status: 'active'
            }).populate({
                path: 'chats.chat',
                populate: { path: 'users', model: 'User', select: 'image username' },
                select: 'id messageLast users'
            })

            if(filtersExtra.id) {
                for(const chatObj of user.chats) {
                    if(chatObj.chat.id == filtersExtra.id) {
                        const chat = chatObj.chat.toJSON()

                        chat.notificationsDisabled = chatObj.notificationsDisabled
                        data[typeData] = [chat]

                        return res.json(data)
                    }
                }

                return res.json({ code: 2 })
            }

            const chatsValid = user.chats.filter(chatObj => chatObj.status == 'active')

            if(!chatsValid.length) {
                data[typeData] = []

                return res.json(data)
            }

            const chatsNotificationsDisabled = []

            for(const chatObj of chatsValid) {
                if(chatObj.notificationsDisabled) {
                    chatsNotificationsDisabled.push(chatObj.chat._id)
                }
            }

            filter['_id'] = { $in: chatsValid.map(chatObj => chatObj.chat._id)}

            addFieldsAfterObj.notificationsDisabled = { $in: ['$_id', chatsNotificationsDisabled]}

            limitDisabled = true
        }
        // Messages.
        else if(model.schema == models.Message) {
            if(!filtersExtra.chat) {
                return res.json({ code: 1 })
            }

            if(!req.user) {
                return res.json({ code: 2 })
            }

            user = await models.User.findOne({ _id: req.user._id, status: 'active' })

            if(!user) {
                return res.json({ code: 2 })
            }

            if(query.pageCurrent == 0) {
                let cleanMessagesNew = false

                for(const [index, chatCounter] of user.messagesNew.entries()) {
                    if(String(chatCounter.chat) == filtersExtra.chat && chatCounter.count) {
                        user.messagesNew.splice(index, 1)
                        cleanMessagesNew = true

                        break
                    }
                }

                if(cleanMessagesNew) {
                    await user.save()

                    serverm.emit('clearedMessagesNew', user)
                }
            }

            filter.chat = mongoose.Types.ObjectId(filtersExtra.chat)
        }
        // Notifications.
        else if(model.schema == models.Notification) {
            population.push({ path: 'sender', select: 'image username' })
            population.push({ path: 'channel', select: 'id image name' })
            population.push({ path: 'post', select: 'id title' })
            population.push({ path: 'comment', select: 'id text' })
            population.push({ path: 'commentParent', select: 'id text' })

            if(!req.user) {
                return res.json({ code: 1 })
            }

            user = await models.User.findOne({ _id: req.user._id, status: 'active'})

            if(!user) {
                return res.json({ code: 1 })
            }

            if(query.pageCurrent == 0) {
                if(user.notificationsNew.length) {
                    user.notificationsNew = []
                    await user.save()

                    serverm.emit('clearedNotificationsNew', user)
                }
            }

            filter.receiver = mongoose.Types.ObjectId(req.user._id)
        }
        // News.
        else if(model.schema == models.News) {
            let user

            if(req.user) {
                user = await models.User.findOne({ _id: req.user._id })
            }

            population.push({
                path: 'source',
                select: 'id image name urlWebsite'
            })
            population.push({
                path: 'category',
                select: 'id name'
            })
            unsetFields.push('clicks')

            if(filter.source) {
                if(user) {
                    filter.category = { $nin: user.preferences.news.categoriesExcluded }
                }

                let foundSource = false

                for(const source of newsm.getNewsSources()) {
                    if(source.id == filter.source) {
                        filter.source = source._id
                        foundSource = true
                        break
                    }
                }

                if(!foundSource) {
                    return res.json({ code: 1 })
                }
            }
            else if(filter.category) {
                if(user) {
                    filter.source = { $nin: user.preferences.news.sourcesExcluded }
                }

                let foundCategory = false

                for(const category of newsm.getNewsCategories()) {
                    if(category.id == filter.category) {
                        filter.category = category._id
                        foundCategory = true
                        break
                    }
                }

                if(!foundCategory) {
                    return res.json({ code: 1 })
                }
            }
            else {
                if(user) {
                    filter.source = { $nin: user.preferences.news.sourcesExcluded }
                    filter.category = { $nin: user.preferences.news.categoriesExcluded }
                }

                if(filtersExtra.categories) {
                    delete filter.categories

                    if(!user) {
                        filter.category = {}
                    }

                    filter.category['$exists'] = true
                    filter.category['$ne'] = null
                }
            }

            addFields.countClicks = { $size: '$clicks' }

            if(user) {
                addFieldsAfterObj.hasUserViewed = { $in: [user._id, '$clicks']}
            }

            if(sort.includes('scoreTrend')) {
                addFieldsBeforeObj.scoreTrend = { $add : [
                    { $multiply: ['$countClicks', 10]},
                    { $divide: [ { $subtract: ['$date', new Date()]}, 1000 * 60 ]}
                ]}
            }
        }

        const arrayFilters = Object.keys(filter).map(key => {
            const filterObj = {}

            filterObj[key] = filter[key]

            return filterObj
        })

        if(arrayFilters.length) {
            match['$match'] = { $and: arrayFilters }
        }

        // Pipeline for items and count.
        const pipeline = []

        if(lookup) {
            pipeline.push({ $lookup: lookup })
        }

        if(unwind) {
            pipeline.push({ $unwind: unwind })
        }

        if(Object.keys(match).length) {
            pipeline.push(match)
        }

        if(Object.keys(addFields).length) {
            pipeline.push({ $addFields: addFields })
        }

        if(Object.keys(addFieldsBeforeObj).length) {
            pipeline.push({ $addFields: addFieldsBeforeObj })
        }

        pipeline.push({ $sort: sortObj})

        // Pipeline for items only.
        const pipelineItems = [{ $match: {} }]

        if(Object.keys(addFieldsAfterObj).length) {
            pipelineItems.push({ $addFields: addFieldsAfterObj })
        }

        if(setFields.length) {
            const project = {}

            for(const field of setFields) {
                if(typeof field === 'object') {
                    for(const key of Object.keys(field)) {
                        project[key] = field[key]
                    }
                }
                else {
                    project[field] = 1
                }
            }

            pipelineItems.push({ $project: project })
        }

        if(unsetFields.length) {
            pipelineItems.push({ $unset: unsetFields })
        }

        if(!limitDisabled) {
            pipelineItems.push({ $skip: skip })
            pipelineItems.push({ $limit: itemsPerPage })
        }

        pipeline.push({
            $facet: {
                countTotal: [{ $count: 'count' }],
                items: pipelineItems
            }
        })

        // Aggregate.
        model.schema
        .aggregate(pipeline)
        .then(result => {
            result = result[0]

            // Populate items.
            return Promise.all([
                model.schema.populate(result.items, population),
                result.countTotal[0] ? result.countTotal[0].count : 0
            ])
        })
        .then(([items, count]) => {
            data.countTotal = count
            data[typeData] = items

            res.json(data)
            /* processAnalytics(req, 'event', {
                eventCategory: 'dataFetch',
                eventAction: typeData,
                eventLabel: query.pageCurrent
            }) */
        })
        .catch(error => {
            if(typeof error !== 'object') {
                error = { code: -1, message: error }
            }

            console.log(`Error fetching items[${typeData}]:`, error.message)

            res.json({ code: error.code })
        })
    })
}
