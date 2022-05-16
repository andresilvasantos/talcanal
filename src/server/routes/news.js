const newsm = require('@server/news-manager')
const serverm = require('@server/server-manager')
const template = require('@client/components/root/index.marko')
const { models } = require('mongoose')
const { authRequired, deleteFromSpaces, processAnalytics, removeAccents } = require('@server/utils')
const { sizesMedia } = require('@server/default-vars')
const { validateNewsCategoryId, validateNewsSourceId, validateUrl } = require('@client/js/utils')

const idsBlackList = [
    'jornal', 'jornais', 'fonte', 'fontes', 'noticias'
]

module.exports = function(router) {
    router.route('/noticias')
	.get((req, res) => {
        this.render(template, { page: 'news' })
	})
    .delete(authRequired, (req, res) => {
        const ids = req.query.ids || []
        const id = ids[0]

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then((user) => {
            if(!user) {
                throw { code: -2 }
            }

            if(id) {
                newsm.deleteNews(id)
            }
            else {
                newsm.deleteNewsAll()
            }

            res.json({ code: 0 })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error deleting news:', error.message)

            res.json({ code: error.code })
        })
    })

    router.route('/noticias/:id')
	.get(async(req, res) => {
        const id = req.params.id

        if(id == 'categorias') {
            return this.render(template, { page: 'news', pane: 'categories' })
        }

        let source = await models.NewsSource.findOne({ id: id })

        if(source) {
            source = source.toJSON()

            return this.render(template, { page: 'news', pane: 'source', data: source })
        }

        let category = await models.NewsCategory.findOne({ id: id })

        if(category) {
            category = category.toJSON()

            return this.render(template, { page: 'news', pane: 'category', data: category })
        }

        this.render(template, { page: 'error' })
	})

    router.route('/noticias/click')
    .post(authRequired, (req, res) => {
        const url = req.body.id

        models.News.findOneAndUpdate(
            { clicks: { $ne: req.user._id }, link: url }, { $push: { clicks: req.user._id }}
        ).exec()
        .then(() => {})
        .catch(error => {})
    })

    router.route('/noticias/refrescar')
    .post(authRequired, (req, res) => {
        const id = req.body.id

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then((user) => {
            if(!user) {
                throw { code: -2 }
            }

            newsm.fetchNews(id)

            res.json({ code: 0 })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error refreshing news:', error.message)

            res.json({ code: error.code })
        })
    })

    /*
        SOURCES.
    */

    router.route('/noticias/fonte')
    .post(authRequired, (req, res) => {
        const dataReq = req.body.data || {}
        const id = dataReq.id
        const name = dataReq.name
        const urlFeedRss = dataReq.urlFeedRss
        const urlWebsite = dataReq.urlWebsite
        const categoryDefault = (dataReq.categoryDefault || '').trim()
        const image = dataReq.image

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then(user => {
            if(!user) {
                throw { code: -2 }
            }

            if(!validateNewsSourceId(id) || idsBlackList.includes(id)) {
                throw { code: 1 }
            }

            if(!name.length) {
                throw { code: 2 }
            }

            if(!validateUrl(urlFeedRss) || !validateUrl(urlWebsite)) {
                throw { code: 3 }
            }

            const data = {
                id,
                creator: user._id,
                name,
                urlFeedRss,
                urlWebsite
            }

            if(categoryDefault.length) {
                data.categoryDefault = removeAccents(categoryDefault.toLowerCase())
            }

            if(image) {
                data.image = image
                serverm.claimMedia([image])
            }

            return models.NewsSource.create(data)
        })
        .then(source => {
            res.json({ code: 0, newsSource: source })

            newsm.addNewsSource(source)

            processAnalytics(req, 'event', {
                eventCategory: 'newsSource',
                eventAction: 'create',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(!error.code) {
				error = { code: -1, message: error }
            }
            else if(error.code === 11000) {
                error = { code: 1 }
            }

            console.log('Error creating news source', error.code)

            res.json({ code: error.code })
        })
    })
    .patch(authRequired, (req, res) => {
        const id = req.body.id
        const patch = req.body.data

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then(user => {
            if(!user) {
                throw { code: -2 }
            }

            return models.NewsSource.findOne({ id: id }).exec()
        })
        .then(source => {
            if(!source) {
                throw { code: -3, message: 'Source not found.' }
            }

            if(patch.hasOwnProperty('id')) {
                if(!validateNewsSourceId(id)) {
                    throw { code: 1 }
                }

                source.id = patch.id
            }

            if(patch.hasOwnProperty('name')) {
                source.name = patch.name
            }

            if(patch.hasOwnProperty('image')) {
                if(source.image && source.image.length) {
                    const nameFiles = []

                    sizesMedia.newsSource.map((size) => {
                        nameFiles.push(`${source.image}${size.tag ? '-' + size.tag : ''}.jpg`)
                    })

                    deleteFromSpaces(nameFiles)
                }

                source.image = patch.image

                if(source.image.length) {
                    serverm.claimMedia([source.image])
                }
            }

            if(patch.hasOwnProperty('urlFeedRss')) {
                if(!validateUrl(patch.urlFeedRss)) {
                    throw { code: 2 }
                }

                source.urlFeedRss = patch.urlFeedRss
            }

            if(patch.hasOwnProperty('urlWebsite')) {
                if(!validateUrl(patch.urlWebsite)) {
                    throw { code: 3 }
                }

                source.urlWebsite = patch.urlWebsite
            }

            if(patch.hasOwnProperty('categoryDefault')) {
                source.categoryDefault = removeAccents(patch.categoryDefault.toLowerCase())
            }

            return source.save()
        })
        .then(source => {
            source = source.toJSON()

            newsm.newsSourceUpdated(source)

            res.json({ code: 0, newsSource: source })
            processAnalytics(req, 'event', {
                eventCategory: 'newsSource',
                eventAction: 'patch',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error patching news source:', error.message)

            res.json({ code: error.code })
        })
    })
    .delete(authRequired, (req, res) => {
        const ids = req.query.ids || []
        const id = ids[0]

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then(async(user) => {
            if(!user) {
                throw { code: -2 }
            }

            const source = await models.NewsSource.findOne({ id: id })

            if(!source) {
                throw { code: -3 }
            }

            const news = await models.News.find({ source: source._id })
            const nameFiles = []
            const idsNews = []

            if(source.image) {
                sizesMedia.newsSource.map((size) => {
                    nameFiles.push(`${source.image}${size.tag ? '-' + size.tag : ''}.jpg`)
                })
            }

            for(const newsSingle of news) {
                idsNews.push(newsSingle._id)
                sizesMedia.link.map((size) => {
                    nameFiles.push(`${newsSingle.image}${size.tag ? '-' + size.tag : ''}.jpg`)
                })
            }

            deleteFromSpaces(nameFiles)
            newsm.removeNewsSource(source.id)
            models.News.deleteMany({ _id: { $in: idsNews }}).exec()
            models.NewsCategory.updateMany({ news: { $in: idsNews }}, { $pullAll: { news: idsNews }}).exec()
            return models.NewsSource.deleteOne({ id: id }).exec()
        })
        .then(() => {
            res.json({ code: 0 })
            processAnalytics(req, 'event', {
                eventCategory: 'newsSource',
                eventAction: 'delete',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
                error = { code: -1, message: error }
            }

            console.log('Error deleting news source:', error.message)

            res.json({ code: error.code })
        })
    })

    /*
        CATEGORIES.
    */

    router.route('/noticias/categoria')
    .post(authRequired, (req, res) => {
        const dataReq = req.body.data || {}
        const id = dataReq.id
        const name = dataReq.name
        const namesMatch = (dataReq.namesMatch || '').split(',')

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then(user => {
            if(!user) {
                throw { code: -2 }
            }

            if(!validateNewsCategoryId(id) || idsBlackList.includes(id)) {
                throw { code: 1 }
            }

            if(!name.length) {
                throw { code: 2 }
            }

            const namesMatchClean = []

            for(const nameMatch of namesMatch) {
                const nameMatchClean = removeAccents(nameMatch.toLowerCase()).trim()

                if(!nameMatchClean.length) {
                    continue
                }

                namesMatchClean.push(nameMatchClean)
            }

            const data = {
                id,
                creator: user._id,
                name
            }

            if(namesMatchClean.length) {
                data.namesMatch = namesMatchClean
            }

            return models.NewsCategory.create(data)
        })
        .then(category => {
            res.json({ code: 0, newsCategory: category })

            newsm.addNewsCategory(category)

            processAnalytics(req, 'event', {
                eventCategory: 'newsCategory',
                eventAction: 'create',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(!error.code) {
				error = { code: -1, message: error }
            }
            else if(error.code === 11000) {
                error = { code: 1 }
            }

            console.log('Error creating news category', error.code, error.message)

            res.json({ code: error.code })
        })
    })
    .patch(authRequired, (req, res) => {
        const id = req.body.id
        const patch = req.body.data

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then(user => {
            if(!user) {
                throw { code: -2 }
            }

            return models.NewsCategory.findOne({ id: id }).exec()
        })
        .then(category => {
            if(!category) {
                throw { code: -3, message: 'Category not found.' }
            }

            if(patch.hasOwnProperty('id')) {
                if(!validateNewsCategoryId(id)) {
                    throw { code: 1 }
                }

                category.id = patch.id
            }

            if(patch.hasOwnProperty('name')) {
                category.name = patch.name
            }

            if(patch.hasOwnProperty('namesMatch')) {
                const namesMatch = patch.namesMatch.split(',')
                const namesMatchClean = []

                for(const nameMatch of namesMatch) {
                    const nameMatchClean = removeAccents(nameMatch.toLowerCase()).trim()

                    if(!nameMatchClean.length) {
                        continue
                    }

                    namesMatchClean.push(nameMatchClean)
                }

                category.namesMatch = namesMatchClean
            }

            return category.save()
        })
        .then(category => {
            delete category.creator
            delete category.news

            newsm.newsCategoryUpdated(category)

            res.json({ code: 0, newsCategory: category })
            processAnalytics(req, 'event', {
                eventCategory: 'newsCategory',
                eventAction: 'patch',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
				error = { code: -1, message: error }
            }

            console.log('Error patching news category:', error.message)

            res.json({ code: error.code })
        })
    })
    .delete(authRequired, (req, res) => {
        const ids = req.query.ids || []
        const id = ids[0]

        models.User.findOne({ _id: req.user._id, status: 'active', super: true })
        .exec()
        .then(async(user) => {
            if(!user) {
                throw { code: -2 }
            }

            const category = await models.NewsCategory.findOne({ id: id })

            if(!category) {
                throw { code: -3 }
            }

            newsm.removeNewsCategory(category.id)
            models.News.updateMany({ category: category._id }, { category: null}).exec()
            return models.NewsCategory.deleteOne({ id: id }).exec()
        })
        .then(() => {
            res.json({ code: 0 })
            processAnalytics(req, 'event', {
                eventCategory: 'newsCategory',
                eventAction: 'delete',
                eventLabel: 'success'
            })
        })
        .catch(error => {
            if(typeof error !== 'object') {
                error = { code: -1, message: error }
            }

            console.log('Error deleting news category:', error.message)

            res.json({ code: error.code })
        })
    })
}