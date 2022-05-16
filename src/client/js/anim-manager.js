const easeOutBounce = (x) => {
    const n1 = 7.5625
    const d1 = 2.75

    if (x < 1 / d1) {
        return n1 * x * x
    }
    else if (x < 2 / d1) {
        return n1 * (x -= 1.5 / d1) * x + 0.75
    }
    else if (x < 2.5 / d1) {
        return n1 * (x -= 2.25 / d1) * x + 0.9375
    }
    else {
        return n1 * (x -= 2.625 / d1) * x + 0.984375
    }
}

const easings = ['none', 'sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'bounce', 'elastic']
const easeIns = [
    (x) => { // 'sine
        return 1 - Math.cos((x * Math.PI) / 2)
    },
    (x) => { // quad
        return Math.pow(x, 2)
    },
    (x) => { // cubic
        return Math.pow(x, 3)
    },
    (x) => { // quart
        return Math.pow(x, 4)
    },
    (x) => { // quint
        return Math.pow(x, 5)
    },
    (x) => { // expo
        return x == 0 ? 0 : Math.pow(2, 10 * x - 10)
    },
    (x) => { // circ
        return 1 - Math.sqrt(1 - Math.pow(x, 2))
    },
    (x) => { // back
        const c1 = 1.70158
        const c3 = c1 + 1

        return c3 * Math.pow(x, 3) - c1 * Math.pow(x, 2)
    },
    (x) => { // bounce
        return 1 - easeOutBounce(1 - x)
    },
    (x) => { // elastic
        const c4 = (2 * Math.PI) / 3

        return x == 0 ? 0 : (
            x == 1 ? 1 : - Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * c4)
        )
    }
]

const easeOuts = [
    (x) => { // sine
        return Math.sin(x * Math.PI / 2)
    },
    (x) => { // quad
        return 1 - Math.pow(1 - x, 2)
    },
    (x) => { // cubic
        return 1 - Math.pow(1 - x, 3)
    },
    (x) => { // quart
        return 1 - Math.pow(1 - x, 4)
    },
    (x) => { // quint
        return 1 - Math.pow(1 - x, 5)
    },
    (x) => { // expo
        return x == 1 ? 1 : 1 - Math.pow(2, -10 * x)
    },
    (x) => { // circ
        return Math.sqrt(1 - Math.pow(x - 1, 2))
    },
    (x) => { // back
        const c1 = 1.70158
        const c3 = c1 + 1

        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
    },
    easeOutBounce,
    (x) => { // elastic
        const c4 = (2 * Math.PI) / 3

        return x === 0 ? 0 : (
            x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1
        )
    }
]

class AnimManager {
    constructor() {
        this.animations = []
        this.mapEaseIns = new Map()
        this.mapEaseOuts = new Map()

        for(const [index, easeIn] of easeIns.entries()) {
            this.mapEaseIns.set(easings[index + 1], easeIn)
        }

        for(const [index, easeOut] of easeOuts.entries()) {
            this.mapEaseOuts.set(easings[index + 1], easeOut)
        }

        this.animate = this.animate.bind(this)
    }

    // Getters & Setters.

    getEaseIn(name) {
        return this.mapEaseIns.get(name)
    }

    getEaseOut(name) {
        return this.mapEaseOuts.get(name)
    }

    getEasings() {
        return easings
    }

    // Methods.

    add(element, options, callback) {
        const duration = options.hasOwnProperty('duration') ? options.duration * 1000 : 200
        const easeIn = options.easeIn || 'none'
        const easeOut = options.easeOut || 'none'

        const properties = []

        for(const key of Object.keys(options)) {
            if(['duration', 'easeIn', 'easeOut'].includes(key)) {
                continue
            }

            // Not working with transforms directly, maybe not interested.
            // https://stackoverflow.com/questions/42267189/how-to-get-value-translatex-by-javascript/42267468
            const name = key
            const from = parseFloat(getComputedStyle(element).getPropertyValue(name))
            const to = parseFloat(options[name])
            let type = ''

            if(typeof options[name] == 'string') {
                for(const unit of ['px', '%']) {
                    if(options[name].includes(unit)) {
                        type = unit
                    }
                }
            }

            if(from == to) {
                // Let it pass, it needs to clean previous existing animations.
                // continue
            }
            else if(duration == 0) {
                element.style.setProperty(name, `${to}${type}`)

                continue
            }

            properties.push({ name, from, to, type })
        }

        if(!properties.length) {
            if(callback) {
                callback()
            }

            return false
        }

        const namesProperties = properties.map(property => property.name)

        // Check if there's already an animation for this element and properties.
        for(let i = this.animations.length - 1; i >= 0; --i) {
            const animation = this.animations[i]

            if(!animation.element.isSameNode(element)) {
                continue
            }

            const sameProperties = animation.properties.filter(
                property => namesProperties.includes(property.name)
            )

            if(sameProperties.length) {
                this.animations.splice(i, 1)
            }
        }

        this.animations.push({
            callback,
            duration,
            easeIn,
            easeOut,
            elapsed: 0,
            element,
            properties
        })

        if(!this.started) {
            this.start()
        }

        return true
    }

    animate(timeStamp) {
        if(!this.timeStampLast) {
            this.timeStampLast = timeStamp
        }

        const elapsed = timeStamp - this.timeStampLast
        this.timeStampLast = timeStamp

        for(let i = this.animations.length - 1; i >= 0; --i) {
            const animation = this.animations[i]

            if(this.animateSingle(animation, elapsed)) {
                this.animations.splice(i, 1)

                if(animation.callback) {
                    animation.callback()
                }
            }
        }

        if(!this.animations.length) {
            this.stop()
        }
        else if(this.started) {
            if(window) {
                window.requestAnimationFrame(this.animate)
            }
            else {
                setImmediate(this.animate)
            }
        }
    }

    animateSingle(animation, elapsed) {
        const duration = animation.duration
        const easeIn = this.getEaseIn(animation.easeIn)
        const easeOut = this.getEaseOut(animation.easeOut)

        animation.elapsed += elapsed

        const progress = Math.min(animation.elapsed / (duration == 0 ? 0.00001 : duration), 1)
        let position = progress // Position in transitions is always progress, as we move forward.
        let interpolation = position

        // Calculate interpolation from easings.
        if(easeIn && easeOut) {
            const interpolateIn = easeIn(position)
            const interpolateOut = easeOut(position)
            const progressEased = easeInOutCubic(position)

            interpolation = interpolateIn * (1 - progressEased) + interpolateOut * progressEased
        }
        else if(easeIn) {
            interpolation = easeIn(position)
        }
        else if(easeOut) {
            interpolation = easeOut(position)
        }

        for(const property of animation.properties) {
            const from = property.from
            const to = property.to

            animation.element.style.setProperty(
                property.name,
                `${from + (to - from) * interpolation}${property.type}`
            )
        }

        // Are we finished?
        return progress == 1
    }

    remove(...elements) {
        let removed = false

        for(let i = this.animations.length - 1; i >= 0; --i) {
            const animation = this.animations[i]

            if(elements.includes(animation.element)) {
                this.animations.splice(i, 1)

                removed = true
            }
        }

        if(this.started && !this.animations.length) {
            this.stop()
        }

        return removed
    }

    set(element, options) {
        this.add(element, { duration: 0, ...options})
    }

    start() {
        if(this.started) {
            return
        }

        this.started = true
        this.timeStampLast = null

        if(window) {
            window.requestAnimationFrame(this.animate)
        }
        else {
            setImmediate(this.animate)
        }
    }

    stop() {
        this.started = false
    }

    // Static

    static singleton() {
        if(!this.instance) {
            this.instance = new AnimManager()
        }

        return this.instance
    }
}

export default AnimManager.singleton()