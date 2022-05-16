const channelsm = require('@server/channels-manager')
const mongoose = require('mongoose')
const newsm = require('@server/news-manager')
const template = require('@client/components/root/index.marko')
const { createGzip } = require('zlib')
const { defaultLanguage, languages, urls } = require('@client/js/default-vars')
const { models } = require('mongoose')
const { processAnalytics } = require('@server/utils')
const { SitemapStream } = require('sitemap')

module.exports = function(express, locales, passport, upload) {
    const router = express.Router()

    router.use((req, res, next) => {
        if(!req.xhr && (!req.headers.accept || req.headers.accept.indexOf('json') == -1)) {
            let language = req.session ? req.session.language : null

            if(!language) {
                const languageCodes = []
                for(let i = 0; i < languages.length; ++i) {
                    languageCodes.push(languages[i].code)
                }

                language = req.acceptsLanguages(languageCodes)

                if(!language) {
                    language = defaultLanguage
                }
            }

            const localeData = locales[language]

            this.global = {
                channelsPopular: channelsm.getChannelsPopular(),
                environment: process.env.NODE_ENV,
                language: language,
                newsCategories: newsm.getNewsCategories(),
                newsSources: newsm.getNewsSources(),
                translation: localeData
            }

            this.render = (template, data) => {
                data.$global = this.global
                data.$global.serializedGlobals = {
                    channelsPopular: true,
                    environment: true,
                    language: true,
                    loggedUser: true,
                    newsCategories: true,
                    newsSources: true,
                    translation: true
                }

                try {
                    res.set('Content-Type', 'text/html')
                    template.render(data, res)
                }
                catch (error) {}
            }
        }

		next()
	})

    // Check if user is logged in and add it to global out.
	router.use((req, res, next) => {
        const ip = req.ip
        const dataVisit = { ip: ip }

		if(req.user) {
			this.global.loggedUser = req.user

            dataVisit.user = mongoose.Types.ObjectId(req.user._id)
		}

        models.Visit.findOneAndUpdate(
            {
                ip: ip,
                user: dataVisit.user,
                createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            },
            dataVisit,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).exec()

		next()
	})

    router.route('/')
	.get((req, res) => {
        this.render(template, { page: 'channels' })
	})

    require('./about')(router)
    require('./auth')(router, locales, passport)
    require('./account')(router, locales)
    require('./channels')(router)
    require('./chats')(router)
    require('./news')(router)
    require('./games')(router)
    require('./randomchats')(router)
    require('./datafetch')(router)
    require('./media')(router, upload)

    /**
	 * Robots.txt.
	 */

	router.route('/robots.txt')
	.get((req, res) => {
		const robots = [
			'User-agent: *',
			//'Disallow: /admin/',
			`Sitemap: ${urls.domain}/sitemap.xml`
		  ].join('\n')

		res.header('Content-Type', 'text/plain')
		res.send(robots)
	})

    /**
	 * Sitemap.
	 */

	router.route('/sitemap.xml')
	.get(async(req, res) => {
		const urlsToRegister = [
            { url: '/sobre',  changefreq: 'monthly', priority: 0.6 },
            { url: '/privacidade',  changefreq: 'monthly', priority: 0.1 },
            { url: '/termos',  changefreq: 'monthly', priority: 0.1 },
            { url: '/transparencia',  changefreq: 'monthly', priority: 0.1 }
		]

        // Users.
        const users = await models.User.find({ 'preferences.privateProfile': false, status: 'active' })

        for(const user of users) {
            urlsToRegister.push({ url: `/u/${user.username}`,  changefreq: 'weekly', priority: 0.4 })
        }

        // Channels.
        urlsToRegister.push({ url: '/explorar',  changefreq: 'daily', priority: 0.4 })

		const channels = await models.Channel.find({ status: 'active', type: { $ne: 'private' }})
        const posts = await models.Post
            .find({ status: { $nin: ['autorejected', 'rejected', 'removed']}})
            .populate('channel', 'id')

        for(const channel of channels) {
            urlsToRegister.push({ url: `/c/${channel.id}`,  changefreq: 'daily', priority: 0.6 })
        }

        for(const post of posts) {
            urlsToRegister.push({ url: `/c/${post.channel.id}/p/${post.id}`,  changefreq: 'daily', priority: 0.8 })
        }

        // News.
        urlsToRegister.push({ url: '/noticias',  changefreq: 'daily', priority: 0.5 })

        const newsSources = newsm.getNewsSources()
        const newsCategories = newsm.getNewsCategories()

        for(const source of newsSources) {
            urlsToRegister.push({ url: `/noticias/${source.id}`,  changefreq: 'daily', priority: 0.5 })
        }

        for(const category of newsCategories) {
            urlsToRegister.push({ url: `/noticias/${category.id}`,  changefreq: 'daily', priority: 0.5 })
        }

        // Games.
        urlsToRegister.push({ url: '/jogos',  changefreq: 'monthly', priority: 0.1 })
        urlsToRegister.push({ url: '/jogos/quina',  changefreq: 'monthly', priority: 0.1 })

        res.header('Content-Type', 'application/xml')
        res.header('Content-Encoding', 'gzip')

        try {

            const smStream = new SitemapStream({ hostname: urls.domain })
            const pipeline = smStream.pipe(createGzip())

            for(const url of urlsToRegister) {
                smStream.write(url)
            }

            // make sure to attach a write stream such as streamToPromise before ending
            smStream.end()
            // stream write the response
            pipeline.pipe(res).on('error', (error) => { throw error })
        }
        catch(error) {
            res.status(500).end()
        }
	})

    /**
	 * Analytics.
	 */

	router.route('/analytics')
	.post((req, res) => {
		const collection = JSON.parse(req.body.data)

		for(const analytics of collection) {
			processAnalytics(req, analytics.type, analytics)
		}

        res.json({ code: 0 })
	})

    /**
	 * //404 Route (ALWAYS Keep this as the last route)
	 */

    router.route('*')
 	.get((req, res) => {
         this.render(template, { page: 'error' })
 	})

    return router
}
