const mongoose = require('mongoose')

const configSchema = mongoose.Schema({
    _immutable: { type: Boolean, default: true, unique: true, immutable: true },
    games: {
        quina: {
            challenges: [{
                _id: false,
                answer: { type: String, maxLength: 5 },
                date: { type: Date, required: true },
                number: { type: Number, min: 1, required: true, unique: true },
                plays: [{ type: mongoose.Schema.Types.ObjectId, ref: 'QuinaPlay' }]
            }],
            words: [{ type: String, maxLength: 5 }]
        }
    },
    news: {
        autoFetch: { type: Boolean, default: true },
        lastTimeFetched: { type: Date }
    }
},
{
    collection: 'config',
	timestamps: true
})

const Config = module.exports = mongoose.model(
    'Config', configSchema
)
