class EventEmitter {
    constructor() {
        this.events = {}
    }

    getEventListByName(eventName) {
        if(typeof this.events[eventName] === 'undefined') {
            this.events[eventName] = new Set()
        }

        return this.events[eventName]
    }

    forward(eventName, sender, newEventName = '') {
        const emitFn = (...args) => {
            sender.emit(newEventName.length ? newEventName : eventName, ...args)
        }

        this.on(eventName, emitFn)
    }

    off(eventName, fn = null) {
        if(fn) {
            this.getEventListByName(eventName).delete(fn)
        }
        else {
            delete this.getEventListByName(eventName)
        }
    }

    on(eventName, fn) {
        this.getEventListByName(eventName).add(fn)
    }

    once(eventName, fn) {
        const onceFn = (...args) => {
            this.off(eventName, onceFn)
            fn.apply(this, args)
        }

        this.on(eventName, onceFn)
    }

    emit(eventName, ...args) {
        this.getEventListByName(eventName).forEach(
            (fn) => {
                fn.apply(this, [...args, this])
            }
        )
    }
}

module.exports = EventEmitter