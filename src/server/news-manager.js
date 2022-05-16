const charset = require('charset')
const cheerio = require('cheerio')
const config = require('~/../config')
const EventEmitter = require('@client/js/event-emitter')
const iconv = require('iconv-lite')
const jschardet = require('jschardet')
const request = require('request')
const sanitizeHtml = require('sanitize-html')
const { deleteFromSpaces, isDaylightSavingTime, prepareLink, removeAccents } = require('@server/utils')
const { models } = require('mongoose')
const { validateUrl } = require('@client/js/utils')
const { sizesMedia, timers } = require('@server/default-vars')

class NewsManager extends EventEmitter {
    constructor() {
        super()

        this.fetchingNews = false
        this.newsCategories = []
        this.newsSources = []
    }

    destroy() {
    }

    init() {
        return new Promise(async(resolve) => {
            await this.fetchNewsSources()
            await this.fetchNewsCategories()

            if(config.news.autoFetch) {
                setTimeout(() => {
                    this.fetchNews()

                    this.deleteNewsOld()
                }, 2000)

                setInterval(() => {
                    this.fetchNews()

                    this.deleteNewsOld()
                }, timers.fetchNews)
            }

            resolve()
        })
    }

    // Getters & Setters.

    getNewsCategories() {
        return this.newsCategories
    }

    getNewsSources() {
        return this.newsSources
    }

    // Methods.

    addNewsCategory(category) {
        this.newsCategories.push(category)
    }

    addNewsSource(source) {
        this.newsSources.push(source)
    }

    async deleteNews(idSource) {
        let sourceTarget

        for(const source of this.newsSources) {
            if(source.id == idSource) {
                sourceTarget = source
                break
            }
        }

        if(!sourceTarget) {
            return
        }

        const news = await models.News.find({ source: sourceTarget._id })
        const ids = []
        const nameFiles = []

        for(const newsSingle of news) {
            ids.push(newsSingle._id)
            sizesMedia.link.map((size) => {
                nameFiles.push(`${newsSingle.image}${size.tag ? '-' + size.tag : ''}.jpg`)
            })
        }

        deleteFromSpaces(nameFiles)

        models.News.deleteMany({ source: sourceTarget._id }).exec()
        models.NewsCategory.updateMany({ news: { $in: ids }}, { $pullAll: { news: ids }}).exec()
        await models.NewsSource.updateMany({ _id: sourceTarget._id }, { $set: { news: [] }}).exec()
    }

    async deleteNewsAll() {
        const news = await models.News.find()
        const nameFiles = []

        for(const newsSingle of news) {
            sizesMedia.link.map((size) => {
                nameFiles.push(`${newsSingle.image}${size.tag ? '-' + size.tag : ''}.jpg`)
            })
        }

        deleteFromSpaces(nameFiles)

        models.News.deleteMany().exec()
        models.NewsSource.updateMany({}, { $set: { news: [] }}).exec()
        models.NewsCategory.updateMany({}, { $set: { news: [] }}).exec()
    }

    async deleteNewsOld() {
        const news = await models.News.find({
            date: { $lt: new Date(Date.now() - timers.deleteNews)}
        })

        if(!news.length) {
            return
        }

        const ids = []
        const nameFiles = []

        for(const newsSingle of news) {
            ids.push(newsSingle._id)
            sizesMedia.link.map((size) => {
                nameFiles.push(`${newsSingle.image}${size.tag ? '-' + size.tag : ''}.jpg`)
            })
        }

        try {
            await deleteFromSpaces(nameFiles)

            models.News.deleteMany({ _id: { $in: ids }}).exec()
            models.NewsSource.updateMany({ news: { $in: ids }}, { $pullAll: { news: ids }}).exec()
            models.NewsCategory.updateMany({ news: { $in: ids }}, { $pullAll: { news: ids }}).exec()
        }
        catch(error) {
            console.log('Problem deleting old news.')
        }
    }

    async fetchNews(idTarget) {
        if(this.fetchingNews) {
            this.fetchNewsAgain = true
            return
        }

        this.fetchingNews = true

        // Calculate offset for UTC 0h.
        let localOffset = (new Date).getTimezoneOffset() * 60 * 1000

        // In summer, in Portugal, timezone is UTC +1h.
        if(isDaylightSavingTime()) {
            localOffset -=  60 * 60 * 1000
        }

        console.log(`Fetching news${idTarget ? ` for ${idTarget}` : ''}`)

        const createNews = (news, source) => {
            return new Promise(async(resolve, reject) => {
                const newsFound = await models.News.findOne({
                    $or: [{ link: news.link }, { title: news.title }], source: source._id
                })

                if(newsFound) {
                    return resolve(1)
                }

                let idImage

                try {
                    idImage = await prepareLink(news.link)
                }
                catch(error) {
                }

                if(!idImage) {
                    return resolve(2)
                }

                const data = {
                    date: news.date,
                    image: idImage,
                    link: news.link,
                    source: source._id,
                    text: news.text,
                    title: news.title
                }

                const categoryOrigin = (
                    source.categoryDefault.length ? source.categoryDefault : news.category
                )
                let categoryTarget

                if(categoryOrigin.length) {
                    for(const category of this.newsCategories) {
                        const namesCompare = [category.id, ...category.namesMatch]

                        for(const nameCompare of namesCompare) {
                            if(categoryOrigin.startsWith(nameCompare)) {
                                categoryTarget = category
                                break
                            }
                        }

                        if(categoryTarget) {
                            break
                        }
                    }
                }

                if(categoryTarget) {
                    data.category = categoryTarget._id
                }
                else {
                    console.log('No category found for:', news.category, news.link)
                }

                const newsCreated = await models.News.create(data)

                models.NewsSource.findOneAndUpdate(
                    { _id: source._id }, { $push: { news: newsCreated }}
                ).exec()

                if(categoryTarget) {
                    models.NewsCategory.findOneAndUpdate(
                        { _id: categoryTarget._id }, { $push: { news: newsCreated }}
                    ).exec()
                }

                resolve(0)
            })
        }

        const fetchNewsFromSource = (url) => {
            return new Promise((resolve, reject) => {
                request({ url: url, encoding: 'binary' }, (error, res, body) => {
                    if(error || res.statusCode == 404) {
                        return reject(error)
                    }

                    const encoding = (
                        charset(res.headers, body) ||
                        (jschardet.detect(body).encoding || '').toLowerCase()
                    )

                    iconv.skipDecodeWarning = true
                    body = iconv.encode(iconv.decode(body, encoding), 'UTF-8')

                    const xmlLoader = cheerio.load(body, { xmlMode: true })
                    const items = xmlLoader('item')
                    const itemsValid = []

                    const optionsHtmlSanitize = {
                        allowedClasses: {},
                        allowedSchemes: [ 'http', 'https' ],
                        allowedTags: []
                    }

                    for(const item of items) {
                        let title = xmlLoader(item).find('title').text()
                        let description = xmlLoader(item).find('description').text()
                        const link = xmlLoader(item).find('link').text().trim()
                        title = sanitizeHtml(title, optionsHtmlSanitize).trim().substring(0, 150)
                        description = sanitizeHtml(description, optionsHtmlSanitize).trim()

                        if(
                            !title.length || !description.length ||
                            !link.length || !validateUrl(link)
                        ) {
                            continue
                        }

                        let category = xmlLoader(item).find('category').text()
                        let date = xmlLoader(item).find('pubDate').text()

                        category = removeAccents(category.toLowerCase()).trim()

                        const now = new Date(Date.now() - localOffset)

                        if(date) {
                            date = new Date(date)
                        }
                        else {
                            date = now
                        }

                        // If date is future, set it to present.
                        if(date.getTime() > Date.now()) {
                            date = new Date(Date.now() - (date.getTime() - Date.now()))
                        }

                        itemsValid.push({
                            category,
                            date,
                            link,
                            text: description,
                            title
                        })

                        if(itemsValid.length >= config.news.limitNewsPerFetch) {
                            break
                        }
                    }

                    resolve(itemsValid)
                })
            })
        }

        for(const source of this.newsSources) {
            if(idTarget && source.id != idTarget) {
                continue
            }

            let news

            try {
                news = await fetchNewsFromSource(source.urlFeedRss)
            }
            catch(error) {
                console.log('Error fetching news for', source.id, error)
                continue
            }

            for(const newsSingle of news) {
                // Remove podcast news from Observador.
                if(
                    source.id == 'observador' &&
                    (
                        newsSingle.title.includes('As notícias das') ||
                        newsSingle.text.includes('Aconteça o que acontecer')
                    )
                ) {
                    continue
                }

                // Remove ads from Pplware.
                if(source.id == 'pplware' && newsSingle.category.includes('publicidade')) {
                    continue
                }

                // Remove ads from JN.
                if(source.id == 'jn' && newsSingle.category.includes('patrocinado')) {
                    continue
                }

                // Remove 'em direto' from Record.
                if(
                    source.id == 'record' &&
                    (
                        newsSingle.text.startsWith('Acompanhe') ||
                        newsSingle.title.includes('em direto')
                    )
                ) {
                    continue
                }

                try {
                    const response = await createNews(newsSingle, source)

                    if(response == 1) { // News already created, forget the rest
                        //console.log('Found same link, no more news to add from this source.')
                        break
                    }
                    else if(response == 2) {
                        //console.log('Problem fetching link.')
                    }
                }
                catch(error) {
                    console.log('Error creating news for', error)
                    continue
                }

                await new Promise(resolve => setTimeout(resolve, 5000)) // wait 5 seconds.
            }
        }

        this.fetchingNews = false

        console.log('All news processed.')

        if(this.fetchNewsAgain) {
            this.fetchNewsAgain = false
            this.fetchNews()
        }
    }

    fetchNewsCategories() {
        return models.NewsCategory
        .find()
        .select('id name namesMatch')
        .then(categories => {
            this.newsCategories = categories

            this.newsCategories.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))

            console.log('News categories fetched:', categories.length)
        })
        .catch(error => {
            console.log('Error fetching news categories.', error)
        })
    }

    fetchNewsSources() {
        return models.NewsSource
        .find()
        .select('id categoryDefault image name urlWebsite urlFeedRss')
        .then(sources => {
            this.newsSources = sources

            this.newsSources.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))

            console.log('News sources fetched:', sources.length)
        })
        .catch(error => {
            console.log('Error fetching news sources.', error)
        })
    }

    newsCategoryUpdated(categoryUpdated) {
        for(const [index, category] of this.newsCategories.entries()) {
            if(category._id == String(categoryUpdated._id)) {
                this.newsCategories[index] = categoryUpdated
                break
            }
        }
    }

    newsSourceUpdated(sourceUpdated) {
        for(const [index, source] of this.newsSources.entries()) {
            if(source._id == String(sourceUpdated._id)) {
                this.newsSources[index] = sourceUpdated
                break
            }
        }
    }

    removeNewsCategory(id) {
        for(const [index, category] of this.newsCategories.entries()) {
            if(category.id == id) {
                this.newsCategories.splice(index, 1)
                break
            }
        }
    }

    removeNewsSource(id) {
        for(const [index, source] of this.newsSources.entries()) {
            if(source.id == id) {
                this.newsSources.splice(index, 1)
                break
            }
        }
    }

    // Static.

    static singleton() {
        if(!this.instance) {
            this.instance = new NewsManager()
        }

        return this.instance
    }
}

module.exports = NewsManager.singleton()