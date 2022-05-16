const mongoose = require('mongoose')
const { statusTypes } = require('@server/default-vars')
const {
    archivePostOptions,
    channelTypes,
    modActionOptions,
    modTriggerDataTypes,
    modTriggerTypes,
    postTypes
} = require('@client/js/default-vars')

const optionsViewMode = ['none', 'expanded', 'list', 'grid']

const channelSchema = mongoose.Schema({
    id: { type: String, maxLength: 20, minLength: 3, required: true, trim: true, unique: true },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    adultContent: { type: Boolean, default: false },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    default: { type: Boolean, default: false },
    description: { type: String, maxLength: 320, trim: true },
    image: { type: String, trim: true },
    memberRequests: [{
        _id: false,
        text: { type: String, trim: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    moderation: {
        automatic: {
            triggers: [{
                _id: false,
                action: {
                    type: String,
                    default: 'queue',
                    enum: modActionOptions.map(option => option.id)
                },
                rule: { type: String, trim: true },
                type: { type: String, default: 'match', enum: modTriggerTypes },
                typeData: {
                    type: String,
                    default: 'all',
                    enum: modTriggerDataTypes.map(option => option.id)
                },
                value: { type: String, maxLength: 1000, trim: true }
            }]
        },
        autoPublish: { type: Boolean, default: true }
    },
    moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    name: { type: String, maxLength: 30, trim: true },
    preferences: {
        acceptRequests: { type: Boolean, default: true },
        archiveAfter: { type: String, default: 'none', enum: archivePostOptions },
        typePostsAllowed: [{
            type: String,
            enum: postTypes.map(type => type.id)
        }],
        viewMode: { type: String, default: 'none', enum: optionsViewMode }
    },
    posts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
    rules: [{
        _id: false,
        text: { type: String, trim: true }, // TODO max length
        title: { type: String, trim: true } // TODO max length
    }],
    status: { type: String, enum: statusTypes.channel, required: true },
    subscribers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    tags: [{
        _id: false,
        id: { type: String, maxLength: 6, minLength: 6, required: true, trim: true },
        color: { type: Number, min: 0 },
        name: { type: String, required: true, trim: true }
    }],
    type: {
        type: String,
        default: 'public',
        enum: channelTypes.map(type => type.id)
    },
    usersBanned: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]

    // Welcome message for new subscribers / moderators
},
{
	timestamps: true
})

channelSchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    if(obj.posts) {
        obj.countPosts = obj.posts.length
    }

    if(obj.members) {
        obj.countMembers = obj.members.length
    }

    if(obj.subscribers) {
        obj.countSubscribers = obj.subscribers.length
    }

    // Remove sensible data always.
    delete obj.memberRequests
    delete obj.members
    delete obj.posts
    delete obj.subscribers
    delete obj.usersBanned

    return obj
}

const Channel = module.exports = mongoose.model(
    'Channel', channelSchema
)