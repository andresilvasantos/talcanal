module.exports = {
    analyticsTrackingId: {
        live: 'UA-XXXXXXXXX-1',
        test: 'UA-XXXXXXXXX-2'
    },
	cookies: {
		maxAge: 1000 * 60 * 60 * 24 * 30 * 12 * 1000,
		secret: 'xxxxxxxxxxxxxxxxxxxxxxxx'
	},
	db: {
		host: 'localhost',
		name: 'talcanal',
		password: 'xxxxxxxxxxxxxxxxxxxxxxxx',
		port: 27017,
		username: 'xxxxx'
	},
    mailGun: {
		apiKey: 'key-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
		domain: 'mg.domain.com',
		host: 'api.eu.mailgun.net',
		sendFrom: 'mail@mg.domain.com'
	},
    news: {
        autoFetch: false,
        limitNewsPerFetch: 3
    },
	server: {
		address: '127.0.0.1',
		port: 3000
	},
    spaces: {
        endpoint: 'ams3.digitaloceanspaces.com',
        key: 'XXXXXXXXXXXXXXXXXX',
        secret: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    },
    thum: {
        key: 'XXXXXXXXXXXXXX',
        url: 'http://image.thum.io/get/auth'
    }
}
