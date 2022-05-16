const mongoose = require('mongoose')

const chatSchema = mongoose.Schema({
    id: { type: String, required: true, trim: true, unique: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    messageLast: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
    type: { type: String, default: 'direct', enums: ['direct', 'channel'] },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
},
{
	timestamps: true
})

chatSchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    // Remove sensible data always.
    delete obj.messages

    return obj
}

const Chat = module.exports = mongoose.model(
    'Chat', chatSchema
)