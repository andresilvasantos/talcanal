const EventEmitter = require('@client/js/event-emitter')
const mongoose = require('mongoose')
const { models } = require('mongoose')
const { timers } = require('@server/default-vars')

class ChannelsManager extends EventEmitter {
    constructor() {
        super()

        this.channelsPopular = []
        this.mapChannelsInfo = new Map()
    }

    destroy() {
    }

    init() {
        return new Promise(async(resolve) => {
            // Fetch popular channels each day.
            setInterval(() => {
                this.fetchChannelsPopular()
            }, timers.fetchChannelsPopular)

            await this.fetchChannelsPopular()

            // Populate all channels info so we can sync data to moderators properly.
            await this.fetchChannelsInfo()

            // Archive posts.
            setInterval(() => {
                this.archivePosts()
            }, timers.archivePosts)

            await this.archivePosts()

            resolve()
        })
    }

    // Getters & Setters.

    getChannelInfo(idChannel) {
        return this.mapChannelsInfo.get(idChannel)
    }

    getChannelsPopular() {
        return this.channelsPopular
    }

    // Methods.

    addedCommentToQueue(idChannel) {
        const channelInfo = this.mapChannelsInfo.get(idChannel)

        if(!channelInfo) {
            return
        }

        if(!channelInfo.countCommentsQueue) {
            channelInfo.countCommentsQueue = 0
        }

        ++channelInfo.countCommentsQueue
    }

    addedPostToQueue(idChannel) {
        const channelInfo = this.mapChannelsInfo.get(idChannel)

        if(!channelInfo) {
            return
        }

        if(!channelInfo.countPostsQueue) {
            channelInfo.countPostsQueue = 0
        }

        ++channelInfo.countPostsQueue
    }

    addedUserChannelRequest(idChannel) {
        const channelInfo = this.mapChannelsInfo.get(idChannel)

        if(!channelInfo) {
            return
        }

        if(!channelInfo.countMemberRequests) {
            channelInfo.countMemberRequests = 0
        }

        ++channelInfo.countMemberRequests
    }

    archivePosts() {
        return new Promise(async(resolve) => {
            let count = 0

            const channels = await models.Channel.find({
                'preferences.archiveAfter': { $ne: 'none' },
                status: 'active'
            })

            for(const channel of channels) {
                const dayMs = 1000 * 60 * 60 * 24
                let time = dayMs

                switch(channel.preferences.archiveAfter) {
                    case 'week':
                        time = dayMs * 7
                        break
                    case 'month':
                        time = dayMs * 30
                        break
                    case 'halfYear':
                        time = dayMs * 182
                        break
                    case 'year':
                        time = dayMs * 365
                        break
                }

                const resultUpdate = await models.Post.updateMany({
                    channel: channel._id,
                    createdAt: { $lt: Date.now() - time },
                    status: { $in: ['published', 'approved']}
                }, {
                    status: 'archived'
                })

                count += resultUpdate.nModified
            }

            if(count) {
                console.log('Archived posts:', count)
            }

            resolve()
        })
    }

    channelCreated(idChannel) {
        this.mapChannelsInfo.set(idChannel, {})
    }

    channelUpdated(channel) {
        for(const channelPopular of this.channelsPopular) {
            if(channelPopular.id == channel.id) {
                channelPopular.image = channel.image
                channelPopular.name = channel.name
                break
            }
        }
    }

    fetchChannelsInfo() {
        return new Promise(async(resolve) => {
            const channels = await models.Channel.find({}).select('id memberRequests')

            for(const channel of channels) {
                const countPostsQueue = await models.Post.countDocuments({
                    channel: channel._id,
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

                const pipeline = []

                // Lookup.
                pipeline.push({
                    $lookup: {
                        from: 'posts',
                        localField: 'post',
                        foreignField: '_id',
                        as: 'postDetails'
                    }
                })

                // Match.
                pipeline.push({
                    $match: {
                        $and: [{
                            'postDetails.channel': mongoose.Types.ObjectId(channel._id)
                        }, {
                            $or: [
                                { status: 'submitted' },
                                { $and: [
                                    {
                                        status: 'published',
                                        flags: { $exists: true, $not: { $size: 0 }}
                                    }
                                ]}
                            ]
                        }]
                    }
                })

                pipeline.push({
                    $count: 'count'
                })

                const countCommentsResult = await models.Comment.aggregate(pipeline)
                const countCommentsQueue = countCommentsResult[0] ? countCommentsResult[0].count : 0
                const countMemberRequests = channel.memberRequests.length
                const info = {}

                if(countCommentsQueue) {
                    info.countCommentsQueue = countCommentsQueue
                }

                if(countMemberRequests) {
                    info.countMemberRequests = countMemberRequests
                }

                if(countPostsQueue) {
                    info.countPostsQueue = countPostsQueue
                }

                this.mapChannelsInfo.set(channel.id, info)
            }

            console.log('Fetched channels info:', channels.length)

            resolve()
        })
    }

    fetchChannelsPopular() {
        return new Promise(async(resolve) => {
            this.channelsPopular = await models.Channel.aggregate([
                { $match: { status: 'active', type: { $ne: 'private' }, adultContent: false }},
                { $addFields: { 'countSubscribers': { $size: '$subscribers' }}},
                { $project: { id: 1, countSubscribers: 1, image: 1, name: 1 }},
                { $sort: { countSubscribers: -1 }},
                { $limit: 15 }
            ])

            console.log('Popular channels fetched:', this.channelsPopular.length)

            resolve()
        })
    }

    removedCommentFromQueue(idChannel) {
        const channelInfo = this.mapChannelsInfo.get(idChannel)

        if(!channelInfo) {
            return
        }

        channelInfo.countCommentsQueue = Math.max(channelInfo.countCommentsQueue - 1, 0)

        if(!channelInfo.countCommentsQueue) {
            delete channelInfo.countCommentsQueue
        }
    }

    removedPostFromQueue(idChannel) {
        const channelInfo = this.mapChannelsInfo.get(idChannel)

        if(!channelInfo) {
            return
        }

        channelInfo.countPostsQueue = Math.max(channelInfo.countPostsQueue - 1, 0)

        if(!channelInfo.countPostsQueue) {
            delete channelInfo.countPostsQueue
        }
    }

    removedUserChannelRequest(idChannel) {
        const channelInfo = this.mapChannelsInfo.get(idChannel)

        if(!channelInfo) {
            return
        }

        channelInfo.countMemberRequests = Math.max(channelInfo.countMemberRequests - 1, 0)

        if(!channelInfo.countMemberRequests) {
            delete channelInfo.countMemberRequests
        }
    }

    // Static.

    static singleton() {
        if(!this.instance) {
            this.instance = new ChannelsManager()
        }

        return this.instance
    }
}

module.exports = ChannelsManager.singleton()