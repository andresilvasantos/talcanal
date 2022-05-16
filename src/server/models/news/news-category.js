const mongoose = require('mongoose')

const newsCategorySchema = mongoose.Schema({
    id: { type: String, required: true, trim: true, unique: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true },
    namesMatch: [{ type: String, default: '', trim: true }],
    news: [{ type: mongoose.Schema.Types.ObjectId, ref: 'News' }]
},
{
	timestamps: true
})

newsCategorySchema.methods.toJSON = function(doc, ret) {
    const obj = this.toObject()

    // Remove sensible data always.
    delete obj.creator
    delete obj.news

    return obj
}

const NewsCategory = module.exports = mongoose.model(
    'NewsCategory', newsCategorySchema
)