const aws = require('aws-sdk')
const fs = require('fs-extra')
const mjml2html = require('mjml')
const nodeMailer = require('nodemailer')
const nodeMailerMG = require('nodemailer-mailgun-transport')
const randToken = require('rand-token').generator({ chars: 'a-z' })
const request = require('request')
const sharp = require('sharp')
const urlMetadata = require('url-metadata')
const { extractHostName, validateUrl } = require('@client/js/utils')
const { defaultLanguage, languages } = require('@client/js/default-vars')
const { mailGun, spaces, thum } = require('~/../config')
const { sizesMedia } = require('@server/default-vars')

const devEnvironment = process.env.NODE_ENV === 'development'
const spacesS3 = new aws.S3({
    endpoint: spaces.endpoint,
    accessKeyId: spaces.key,
    secretAccessKey: spaces.secret
})

const authRequired = (req, res, next) => {
	if(req.user) {
		return next()
	}

	if(req.xhr || req.headers.accept.indexOf('json') > -1) {
		res.send({ redirect: '/entrar' })
	}
	else {
		res.redirect('/entrar')
	}
}

const compileEmail = (path, customProperties, convertToHtml = true) => {
    return new Promise((resolve, reject) => {
        fs.readFile(path, 'utf8', (error, emailString) => {
            if(error) {
                reject(error)
            }
            else {
                const emailEval = (_) => eval('`' + emailString  + '`')
                const emailMjml = emailEval(customProperties)

                if(!convertToHtml) {
                    return resolve(emailMjml)
                }

                const email = mjml2html(emailMjml)

                resolve(email.html)
            }
        })
    })
}

const currentLanguage = (req) => {
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

	return language
}

const deleteFromSpaces = (nameFiles) => {
    return new Promise((resolve, reject) => {
        const folder = devEnvironment ? 'dev' : 'public'
        const objects = []

        for(const nameFile of nameFiles) {
            objects.push({ Key : `${folder}/${nameFile}` });
        }

        const params = {
            Bucket: 'talcanal',
            Delete: {
                Objects: objects
            }
        }

        spacesS3.deleteObjects(params).promise()
        .then(() => {
            resolve()
        })
        .catch((error) => {
            console.log('Error deleting from spaces', error)
            reject(error)
        })
    })
}

const fetchUrlImage = (url) => {
    const urlWebShot = `${thum.url}/${thum.key}/noanimate/${url}`

    const fetchUrl = (url) => {
        return new Promise((resolve, reject) => {
            request({ url: url, encoding: null }, async(error, resp, buffer) => {
                if(error || [403, 404].includes(resp.statusCode)) {
                    return reject(error)
                }

                return resolve(buffer)
            })
        })
    }

    return new Promise((resolve, reject) => {
        const processImageUrl = (imageUrl, usingWebShot = false) => {
            fetchUrl(imageUrl)
            .then(buffer => {
                return resolve([buffer, imageUrl])
            })
            .catch(error => {
                if(usingWebShot) {
                    return reject(error)
                }

                fetchUrl(urlWebShot)
                .then(buffer => {
                    return resolve([buffer, urlWebShot])
                })
                .catch(error => {
                    return reject(error)
                })
            })
        }
        // If the url is a direct image, return it.
        if(url.toLowerCase().match(/\.(jpeg|jpg|gif|png|webp)$/) != null) {
            return processImageUrl(url)
        }

        urlMetadata(url)
        .then(metadata => {
            let imageUrl = ''
            let usingWebShot = false

            for(const propertyName of ['twitter:image', 'og:image', 'image']) {
                if(metadata[propertyName] && metadata[propertyName].length) {
                    imageUrl = metadata[propertyName]

                    if(!validateUrl(imageUrl)) {
                        while(imageUrl.startsWith('.') || imageUrl.startsWith('/')) {
                            imageUrl = imageUrl.substring(1)
                        }

                        if(!imageUrl.startsWith('http')) {
                            imageUrl = `http://${extractHostName(url)}/${imageUrl}`
                        }
                    }

                    break
                }
            }

            if(!imageUrl.length) {
                imageUrl = urlWebShot
                usingWebShot = true
            }

            return processImageUrl(imageUrl, usingWebShot)
        }, error => {
            reject(error)
        })
    })
}

// Function to check if it's summer time.
const isDaylightSavingTime = () => {
    const date = new Date()
    const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset()
    const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset()
    return Math.max(jan, jul) !== date.getTimezoneOffset()
}

const prepareLink = (url) => {
    return new Promise((resolve, reject) => {
        // TODO this should be called fetchBufferImage.
        fetchUrlImage(url)
        .then(async([buffer, urlImage]) => {
            const id = randToken.generate(10)

            try {
                await Promise.all(sizesMedia.link.map(async(size) => {
                    const nameFile = `${id}${size.tag ? '-' + size.tag : ''}.jpg`

                    const bufferResized = await resizeImage(buffer, size)
                    await sendToSpaces(nameFile, bufferResized)
                }))
            }
            catch(error) {
                console.log('Error preparing image link', error, url, urlImage)
                return reject('Problem processing image link.', url)
            }

            resolve(id)
        })
        .catch(error => {
            console.log('Error preparing link', error, url)
            reject('Error preparing link')
        })
    })
}

const processAnalytics = (req, type, data) => {
	const visitor = req.visitor

	visitor.set('uip', req.headers['x-real-ip'] || req.connection.remoteAddress)
	visitor.set('ua', req.headers['user-agent'])

    switch(type) {
        case 'pageview':
            visitor.pageview({ dp: data.url, dt: data.title }).send()
            break
        case 'event':
            visitor.event(data.eventCategory, data.eventAction, data.eventLabel).send()
            break
    }
}

const removeAccents = (string) => {
    // Remove accents.
    // https://stackoverflow.com/questions/990904/remove-accents-diacritics-in-a-string-in-javascript
    return string.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const resizeImage = (buffer, size) => {
    return new Promise((resolve, reject) => {
        const optionsResize = { withoutEnlargement: true }

        if(size.width) {
            optionsResize.width = size.width
        }

        if(size.height) {
            optionsResize.height = size.height
        }

        if(size.crop) {
            optionsResize.fit = sharp.fit.cover
        }

        sharp(buffer)
        .rotate()
        .resize(optionsResize)
        .jpeg({
            quality: 90,
            force: true
        })
        .toBuffer()
        .then(data => {
            resolve(data)
        })
        .catch(error => {
            reject(error)
        })
    })
}

const sendEmail = (data, callback) => {
	const emailAuth = {
		auth: {
			api_key: mailGun.apiKey,
			domain: mailGun.domain
		},
		host: mailGun.host
	}

	const mailSender = nodeMailer.createTransport(
		nodeMailerMG(emailAuth)
	)

	mailSender.sendMail(data,
	function (error, info) {
		callback(error, info)
	})
}

const sendToSpaces = (nameFile, data) => {
    return new Promise((resolve, reject) => {
        const folder = devEnvironment ? 'dev' : 'public'
        const params = {
            Bucket: 'talcanal',
            Key: `${folder}/${nameFile}`,
            Body: data,
            ACL: 'public-read',
            ContentType: 'image/jpeg'
        }

        spacesS3.putObject(params).promise()
        .then(() => {
            resolve()
        })
        .catch((error) => {
            console.log('Error uploading to spaces', error)
            reject(error)
        })
    })
}

const setupFilter = (filter, keysToFilter/*, language*/) => {
    filter = removeAccents(filter)

    // Diacritic sensitive regex.
    filter = filter
            .replace(/a/g, '[a,á,à,ä]')
            .replace(/e/g, '[e,é,ë]')
            .replace(/i/g, '[i,í,ï]')
            .replace(/o/g, '[o,ó,ö,ò]')
            .replace(/u/g, '[u,ü,ú,ù]')

	filter = {'$regex': new RegExp(
		filter.replace(/\s+/g,'\\s+'),
		'gi'
	)}

	if(!Array.isArray(keysToFilter)) {
		keysToFilter = [keysToFilter]
	}

	const keyFilters = []
	for(let i = 0; i < keysToFilter.length; ++i) {
		const keyFilter = {}

        keyFilter[keysToFilter[i]] = filter
		keyFilters.push(keyFilter)
	}

	filter = {}
    filter['$or'] = keyFilters

	return filter
}

const setupHeadersEventSource = (res) => {
    res.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Access-Control-Allow-Origin': '*',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Cache-Control': 'no-transform'
    })
}

exports.authRequired = authRequired
exports.compileEmail = compileEmail
exports.currentLanguage = currentLanguage
exports.deleteFromSpaces = deleteFromSpaces
exports.fetchUrlImage = fetchUrlImage
exports.isDaylightSavingTime = isDaylightSavingTime
exports.prepareLink = prepareLink
exports.processAnalytics = processAnalytics
exports.removeAccents = removeAccents
exports.resizeImage = resizeImage
exports.sendEmail = sendEmail
exports.sendToSpaces = sendToSpaces
exports.setupFilter = setupFilter
exports.setupHeadersEventSource = setupHeadersEventSource