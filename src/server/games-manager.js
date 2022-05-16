const quinam = require('@server/quina-manager')
const EventEmitter = require('@client/js/event-emitter')

class GamesManager extends EventEmitter {
    constructor() {
        super()
    }

    destroy() {
    }

    init() {
        return new Promise(async(resolve) => {
            await quinam.init()

            resolve()
        })
    }

    // Static.

    static singleton() {
        if(!this.instance) {
            this.instance = new GamesManager()
        }

        return this.instance
    }
}

module.exports = GamesManager.singleton()