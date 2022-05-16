module.exports = {
    sizesMedia: {
        // Post
        large: [
            { width: 1920 },
            { width: 800, tag: 'md' },
            { width: 400, tag: 'sm-nocrop' },
            { width: 400, height: 400, crop: true, tag: 'sm' },
            { width: 150, height: 150, crop: true, tag: 'tn' }
        ],
        link: [
            { width: 800 },
            { width: 400, tag: 'sm-nocrop' },
            { width: 400, height: 400, crop: true, tag: 'sm' },
            { width: 150, height: 150, crop: true, tag: 'tn' }
        ],
        // Account, channel.
        square: [
            { width: 500, height: 500, crop: true },
            { width: 150, height: 150, crop: true, tag: 'sm' },
            { width: 80, height: 80, crop: true, tag: 'tn' }
        ]
    },
    statusTypes: {
        channel: [
            'active',
            'banned',
            'removed'
        ],
        chat: [
            'active',
            'removed'
        ],
        comment: [
            'submitted',
            'published',
            'approved',
            'autorejected',
            'rejected',
            'removed'
        ],
        generic: [
            'submitted',
            'published',
            'hidden',
            'expired',
            'removed'
        ],
        post: [
            'submitted',
            'published',
            'approved',
            'archived',
            'autorejected',
            'rejected',
            'removed'
        ],
        user: [
            'pending',
            'active',
            //'recover', // This should be a flag or just a property with the key to recover?
            'banned',
            'removed'
        ]
    },
    timers: {
        archivePosts: 1000 * 60 * 60,
        checkUnclaimedMedia: 1000 * 60 * 60, // 1 hour.
        deleteNews: 1000 * 60 * 60 * 24, // 1 day.
        fetchChannelsPopular: 1000 * 60 * 60 * 24, // 1 day.
        fetchNews: 1000 * 60 * 60, // 1 hour.
        fetchTransparency: 1000 * 60 * 10, // 10 minutes.
        pingAccount: 10 * 1000,
        pingChannels: 10 * 1000
    }
}