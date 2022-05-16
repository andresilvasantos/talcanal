const ChannelsManager = require('@server/channels-manager')
const EventEmitter = require('@client/js/event-emitter')
const GamesManager = require('@server/games-manager')
const NewsManager = require('@server/news-manager')
const { deleteFromSpaces } = require('@server/utils')
const { models } = require('mongoose')
const { sizesMedia, timers } = require('@server/default-vars')

class ServerManager extends EventEmitter {
    constructor() {
        super()

        this.channelsPopular = []
        this.counters = {}
        this.mapChannelsInfo = new Map()
        this.mediaUnclaimed = []
    }

    destroy() {
    }

    init() {
        return new Promise(async(resolve) => {
            await ChannelsManager.init()
            await NewsManager.init()
            await GamesManager.init()

            // Fetch transparency counters every 10m.
            setInterval(() => {
                this.fetchTransparency()
            }, timers.fetchTransparency)

            this.fetchTransparency()

            setInterval(() => {
                this.checkUnclaimedMedia()
            }, timers.checkUnclaimedMedia)

            resolve()
        })
    }

    // Getters & Setters.

    getCounters() {
        return this.counters
    }

    // Methods.

    checkUnclaimedMedia() {
        const nameFiles = []

        for(let i = this.mediaUnclaimed.length - 1; i >= 0; --i) {
            const media = this.mediaUnclaimed[i]

            if(Date.now() - media.date > timers.checkUnclaimedMedia) {
                this.mediaUnclaimed.splice(i, 1)

                sizesMedia[media.size].map(size => {
                    nameFiles.push(`${media.id}${size.tag ? '-' + size.tag : ''}.jpg`)
                })
            }
        }

        deleteFromSpaces(nameFiles)
    }

    claimMedia(ids) {
        for(let i = this.mediaUnclaimed.length - 1; i >= 0; --i) {
            const media = this.mediaUnclaimed[i]

            if(ids.includes(media.id)) {
                this.mediaUnclaimed.splice(i, 1)
            }
        }
    }

    fetchTransparency() {
        this.counters = {}
        const dayMs = 1000 * 60 * 60 * 24

        const modelFromType = dataId => {
            switch(dataId) {
            case 'channels':
                return models.Channel
            case 'posts':
                return models.Post
            case 'comments':
                return models.Comment
            case 'randomChats':
                return models.RandomChat
            case 'users':
                return models.User
            case 'visits':
                return models.Visit
            }

            return null
        }

        const countDocuments = (type) => {
            const model = modelFromType(type)

            if(!model) {
                console.log('Error caching transparency', 'No model.')

                return
            }

            model.aggregate([
                {
                    $facet: {
                        'allTime': [
                            { '$match': {} },
                            { '$count': 'count' }
                        ],
                        'days30': [
                            { '$match': { createdAt: {
                                $gte: new Date((new Date().getTime() - (dayMs * 30))) // 30 days.
                            }}},
                            { '$count': 'count' }
                        ],
                        'days7': [
                            { '$match': { createdAt: {
                                $gte: new Date((new Date().getTime() - (dayMs * 7))) // 7 days.
                            }}},
                            { '$count': 'count' }
                        ],
                        'today': [
                            { '$match': { createdAt: {
                                $gte: new Date((new Date().getTime() - (dayMs))) // 1 day.
                            }}},
                            { '$count': 'count' }
                        ]
                    }
                }, {
                    $project: {
                        allTime: { '$arrayElemAt': ['$allTime.count', 0]},
                        days30: { '$arrayElemAt': ['$days30.count', 0]},
                        days7: { '$arrayElemAt': ['$days7.count', 0]},
                        today: { '$arrayElemAt': ['$today.count', 0]}
                    }
                }
            ]).exec()
            .then((data) => {
                this.counters[type] = data[0]
            })
            .catch((error) => {
                console.log('Error caching transparency', error)
            })
        }

        for(const type of ['channels', 'posts', 'comments', 'randomChats', 'users', 'visits']) {
            countDocuments(type)
        }
    }

    mediaUploaded(ids, size) {
        for(const id of ids) {
            this.mediaUnclaimed.push({ id, date: Date.now(), size })
        }
    }

    // Static.

    static singleton() {
        if(!this.instance) {
            this.instance = new ServerManager()
        }

        return this.instance
    }
}

module.exports = ServerManager.singleton()