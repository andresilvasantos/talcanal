const mongoose = require('mongoose')

const newsSourceSchema = mongoose.Schema({
    id: { type: String, required: true, trim: true, unique: true },
    categoryDefault: { type: String, default: '', trim: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    image: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    news: [{ type: mongoose.Schema.Types.ObjectId, ref: 'News' }],
    urlFeedRss: { type: String, required: true, trim: true },
    urlWebsite: { type: String, required: true, trim: true }
},
{
	timestamps: true
})

newsSourceSchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    // Remove sensible data always.
    delete obj.creator
    delete obj.news

    return obj
}

const NewsSource = module.exports = mongoose.model(
    'NewsSource', newsSourceSchema
)