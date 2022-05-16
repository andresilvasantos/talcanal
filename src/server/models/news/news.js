const mongoose = require('mongoose')

const newsSchema = mongoose.Schema({
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsCategory' },
    clicks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    date: { type: Date, default: Date.now() },
    image: { type: String, trim: true },
    link: { type: String, required: true, trim: true, unique: true },
    source: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsSource' },
    text: { type: String, trim: true },
    title: { type: String, maxLength: 150, required: true, trim: true }
},
{
	timestamps: true
})

newsSchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    if(obj.clicks) {
        obj.countClicks = obj.clicks.length
    }

    // Remove sensible data always.
    delete obj.clicks

    return obj
}

const News = module.exports = mongoose.model(
    'News', newsSchema
)