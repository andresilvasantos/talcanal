const mongoose = require('mongoose')

const notificationSchema = mongoose.Schema({
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
    commentParent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    countVotes: { type: Number },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, required: true, trim: true, enum: [
        'channelAdmin',
        'channelAdminRemove',
        'channelBan',
        'channelMember',
        'channelMemberRemove',
        'channelModerator',
        'channelModeratorRemove',
        'channelUserBan',
        'postReject',
        'postComment',
        'postUpvotes',
        'commentReject',
        'commentReply',
        'commentUpvotes'
    ]}
},
{
	timestamps: true
})

const Notification = module.exports = mongoose.model(
    'Notification', notificationSchema
)