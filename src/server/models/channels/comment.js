const mongoose = require('mongoose')
const { flags } = require('@client/js/default-vars')
const { statusTypes } = require('@server/default-vars')

const commentSchema = mongoose.Schema({
    id: { type: String, required: true, trim: true, unique: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: Date.now },
    flags: [{
        _id: false,
        text: { type: String, trim: true },
        type: {
            type: String,
            enum: flags.comments
        },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
    pinned: { type: Boolean, default: false },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    replies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
    status: { type: String, enum: statusTypes.comment, required: true },
    text: { type: String, trim: true },
    textOriginal: { type: String, trim: true },
    votes: {
        down: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        up: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
    }
},
{
	timestamps: true
})

commentSchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    if(obj.votes) {
        obj.countVotes = obj.votes.up.length - obj.votes.down.length
    }

    // Remove sensible data always.
    delete obj.replies
    delete obj.votes

    if(obj.status == 'removed') {
        obj.text = ''
    }

    return obj
}

const Comment = module.exports = mongoose.model(
    'Comment', commentSchema
)