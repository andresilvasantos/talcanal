const mongoose = require('mongoose')

const messageSchema = mongoose.Schema({
    id: { type: String, trim: true },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    removed: { type: Boolean, default: false },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, trim: true },
    time: { type: Date }
},
{
	timestamps: true
})

const Message = module.exports = mongoose.model(
    'Message', messageSchema
)