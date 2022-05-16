const gamesm = require('@server/games-manager')
const template = require('@client/components/root/index.marko')

module.exports = function(router) {
    router.route('/jogos')
	.get((req, res) => {
        this.render(template, { page: 'games' })
	})

    require('./quina')(router)
}