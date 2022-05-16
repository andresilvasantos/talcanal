const mongoose = require('mongoose')

const quinaOldPlaySchema = mongoose.Schema({
    answer: { type: String, maxLength: 5, trim: true },
    completed: { type: Boolean, default: false },
    easyMode: { type: Boolean, default: false },
    numberChallenge: { type: Number, required: true, min: 1 },
    user: { type: String },
    victory: { type: Boolean, default: false },
    attempts: [{
        _id: false,
        lettersRight: [{ type: Number, min: 0, max: 5 }],
        lettersWrong: [{ type: Number, min: 0, max: 5 }],
        pinsRight: { type: Number, default: 0, min: 0, max: 5 },
        pinsWrong: { type: Number, default: 0, min: 0, max: 5 },
        word: { type: String, maxLength: 5, trim: true }
    }]
},
{
	timestamps: true
})

const QuinaOldPlay = module.exports = mongoose.model('QuinaOldPlay', quinaOldPlaySchema)
