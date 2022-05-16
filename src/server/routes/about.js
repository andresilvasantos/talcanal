const serverm = require('@server/server-manager')
const template = require('@client/components/root/index.marko')

module.exports = function(router) {
    router.route('/sobre')
	.get((req, res) => {
        this.render(template, { page: 'about', pane: 'about' })
	})

    router.route('/termos')
	.get((req, res) => {
        this.render(template, { page: 'about', pane: 'terms' })
	})

    router.route('/privacidade')
	.get((req, res) => {
        this.render(template, { page: 'about', pane: 'privacy' })
	})

    router.route('/transparencia')
	.get((req, res) => {
        const counters = serverm.getCounters()

        if(req.xhr || req.headers.accept.indexOf('json') > -1) {
            res.json({ code: 0, transparency: counters })
        }
        else {
            this.render(template, {
                page: 'about',
                pane: 'transparency',
                data: counters
            })
        }
	})
}
