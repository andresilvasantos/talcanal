const mongoose = require('mongoose')

const visitSchema = mongoose.Schema({
    ip: { type: String, required: true, trim: true/* , unique: true */ },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
},
{
	timestamps: true
})

const Visit = module.exports = mongoose.model(
    'Visit', visitSchema
)