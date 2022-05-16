const mongoose = require('mongoose')

const quinaOldUserSchema = mongoose.Schema({
    daltonicMode: { type: Boolean, default: false },
    easyMode: { type: Boolean, default: false },
    streakCurrent: { type: Number, default: 0 },
    streakBest: { type: Number, default: 0 }
})

const QuinaOldUser = module.exports = mongoose.model('QuinaOldUser', quinaOldUserSchema)
