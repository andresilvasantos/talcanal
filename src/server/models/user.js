const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const { flags } = require('@client/js/default-vars')
const { statusTypes } = require('@server/default-vars')

const userSchema = mongoose.Schema({
    activationCode: { type: String, trim: true },
    bio: { type: String, maxLength: 320, trim: true },
    channelsModerator: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],
    channelsSubscribed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],
    chats: [{
        _id: false,
        chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
        notificationsDisabled: { type: Boolean, default: false },
        status: { type: String, default: 'active', enum: statusTypes.chat }
    }],
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
    commentsFavorited: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
    commentsVoted: {
        down: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
        up: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }]
    },
    email: { type: String, required: true, unique: true, trim: true },
    emailTemp: { type: String, trim: true },
    flags: [{
        _id: false,
        text: { type: String, trim: true },
        type: {
            type: String,
            enum: flags.users
        },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    games: {
        quina: {
            plays: [{ type: mongoose.Schema.Types.ObjectId, ref: 'QuinaPlay' }],
            streakCurrent: { type: Number, default: 0 },
            streakBest: { type: Number, default: 0 },
            synced: { type: Boolean, default: false }
        }
    },
    image: { type: String, trim: true },
    karma: { type: Number, default: 0, min: 0 },
    messagesNew: [{
        _id: false,
        chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
        count: { type: Number, default: 0 }
    }],
    notifications: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Notification' }],
    notificationsNew: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Notification' }],
    password: { type: String, required: true, select: false },
    posts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
    postsFavorited: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
    postsVoted: {
        down: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
        up: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }]
    },
    preferences: {
        allowAdultContent: { type: Boolean, default: false },
        allowMessageRequests: { type: Boolean, default: true },
        disableChatRequests: { type: Boolean, default: false },
        games: {
            quina: {
                daltonicMode: { type: Boolean, default: false },
                easyMode: { type: Boolean, default: false }
            }
        },
        news: {
            categoriesExcluded: [{ type: mongoose.Schema.Types.ObjectId, ref: 'NewsCategory' }],
            sourcesExcluded: [{ type: mongoose.Schema.Types.ObjectId, ref: 'NewsSource' }]
        },
        notifications: {
            byEmail: {
                commentReplies: { type: Boolean, default: true },
                commentUpvotes: { type: Boolean, default: true },
                mentions: { type: Boolean, default: true },
                newsletter: { type: Boolean, default: true },
                postComments: { type: Boolean, default: true },
                postUpvotes: { type: Boolean, default: true }
            },
            inApp: {
                commentReplies: { type: Boolean, default: true },
                commentUpvotes: { type: Boolean, default: true },
                mentions: { type: Boolean, default: true },
                officialAnnouncements: { type: Boolean, default: true },
                postComments: { type: Boolean, default: true },
                postUpvotes: { type: Boolean, default: true }
            }
        },
        privateProfile: { type: Boolean, default: false },
        theme: { type: String, default: 'auto', enum: ['auto', 'light', 'dark'], trim: true },
        viewMode: { type: String, default: 'none', enum: ['none', 'list', 'expanded']}
    },
    status: { type: String, enum: statusTypes.user, required: true },
    super: { type: Boolean, default: false },
    superActive: { type: Boolean, default: false },
    username: { type: String, maxLength: 20, minLength: 5, required: true, unique: true, trim: true },
    usersBlocked: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
},
{
	timestamps: true
})

userSchema.methods.toJSON = function(self, doc, ret) {
    const obj = this.toObject()

    if(obj.comments) {
        obj.countComments = obj.comments.length
    }

    if(obj.posts) {
        obj.countPosts = obj.posts.length
    }

    // Remove sensible data always.
    delete obj.activationCode
    delete obj.channelsSubscribed
    delete obj.chats
    delete obj.comments
    delete obj.commentsFavorited
    delete obj.commentsVoted
    delete obj.emailTemp
    delete obj.flags
    delete obj.games
    delete obj.messagesNew
    delete obj.notifications
    delete obj.notificationsNew
    delete obj.password
    delete obj.posts
    delete obj.postsFavorited
    delete obj.postsVoted

    if(!obj.super) {
        delete obj.super
        delete obj.superActive
    }

    if(!self) {
        delete obj.email
        delete obj.preferences
        delete obj.usersBlocked
        delete obj.super
        delete obj.superActive
    }

    return obj
}

/**
 * Generate hash password before save.
 */

userSchema.pre('save', function(next) {
    const user = this

    function hashPassword() {
        return new Promise((resolve, reject) => {
            bcrypt.hash(user.password, 10, (error, hash) => {
                if(error) {
                    reject(error)
                }

                user.password = hash
                resolve()
            })
        })
    }

    const promises = []

    if(user.isModified('password')) {
        promises.push(hashPassword())
    }

    Promise.all(promises)
    .then(() => {
        next()
    })
})

/**
 * Authenticate input against database.
 */

 userSchema.statics.authenticate = function (idUser, password, callback) {
    User
    .findOne({ $or: [{ email: idUser }, { username: idUser, status: { $ne: 'removed' }}]})
    .populate('usersBlocked', 'image username')
    .select('+password')
    .exec((error, user) => {
        if(error) {
            return callback({ code: -1 })
        }
        else if(!user) {
            return callback({ code: 1 })
        }

        bcrypt.compare(password, user.password, function (error, result) {
            if(result) {
                user.password = ''
                return callback(null, user)
            }
            else {
                return callback({ code: 2 })
            }
        })
    })
}

const User = module.exports = mongoose.model('User', userSchema)
