const mongoose = require('mongoose')

const randomChatSchema = mongoose.Schema({
    id: { type: String, required: true, trim: true, unique: true },
    messages: [{
        _id: false,
        id: { type: String, trim: true },
        text: { type: String, trim: true },
        time: { type: Date },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    // 0 - OnGoing, 1 - Finished
    status: { type: Number, default: 0, min: 0, max: 1 },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
},
{
	timestamps: true
})

randomChatSchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    // Remove sensible data always.
    delete obj.messages
    delete obj.users

    return obj
}

const RandomChat = module.exports = mongoose.model(
    'RandomChat', randomChatSchema
)