const mongoose = require('mongoose')
const { flags, postTypes } = require('@client/js/default-vars')
const { statusTypes } = require('@server/default-vars')

const postSchema = mongoose.Schema({
    id: { type: String, required: true, trim: true, unique: true },
    adultContent: { type: Boolean, default: false },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    commentPinned: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: Date.now },
    flags: [{
        _id: false,
        text: { type: String, trim: true },
        type: {
            type: String,
            enum: flags.posts
        },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    images: [{ type: String, trim: true }],
    link: { type: String, trim: true },
    locked: { type: Boolean, default: false },
    pinnedToChannel: { type: Boolean, default: false },
    pinnedToProfile: { type: Boolean, default: false },
    poll: {
        duration: { type: Number, default: 1, max: 3 },
        multipleChoice: { type: Boolean, default: false },
        options: [{
            _id: false,
            name: { type: String, trim: true },
            votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
        }]
    },
    public: { type: Boolean, required: true },
    status: { type: String, enum: statusTypes.post, required: true },
    tag: { type: String },
    text: { type: String, trim: true },
    textOriginal: { type: String, trim: true },
    title: { type: String, maxLength: 200, required: true, trim: true },
    type: {
        type: String,
        enum: postTypes.map(type => type.id),
        required: true
    },
    views: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    votes: {
        down: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        up: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    }
},
{
	timestamps: true
})

postSchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    if(obj.comments) {
        obj.countComments = obj.comments.length
    }

    if(obj.views) {
        obj.countViews = obj.views.length
    }

    if(obj.votes) {
        obj.countVotes = obj.votes.up.length - obj.votes.down.length
    }

    // Remove sensible data always.
    delete obj.commentPinned
    delete obj.comments
    delete obj.views
    delete obj.votes

    if(obj.status == 'removed') {
        obj.edited = false
        obj.images = []
        obj.link = ''
        obj.poll = {}
        obj.text = ''
        obj.textOriginal = ''
        obj.title = ''
    }
    else {
        switch(obj.type) {
            case 'text':
                delete obj.images
                delete obj.link
                delete obj.poll
                break
            case 'link':
                delete obj.poll
                break
            case 'image':
                delete obj.link
                delete obj.poll
                break
            case 'poll':
                delete obj.images
                delete obj.link

                for(const option of obj.poll.options) {
                    option.countVotes = option.votes.length

                    delete option.votes
                }
                break
        }
    }

    return obj
}

const Post = module.exports = mongoose.model(
    'Post', postSchema
)