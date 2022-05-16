const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function abbreviateNumber(number, digits = 1) {
    if(!number) {
        return 0
    }

    const negative = number < 0

    number = Math.abs(number)

    // https://stackoverflow.com/questions/9461621/format-a-number-as-2-5k-if-a-thousand-or-more-otherwise-900
    const lookup = [
        { value: 1, symbol: '' },
        { value: 1e3, symbol: 'k' },
        { value: 1e6, symbol: 'M' },
        { value: 1e9, symbol: 'B' }
    ]

    const regExp = /\.0+$|(\.[0-9]*[1-9])0+$/
    const item = lookup.slice().reverse().find((item) => {
        return number >= item.value
    })

    if(item) {
        number = (number / item.value).toFixed(digits).replace(regExp, '$1') + item.symbol
    }

    return negative ? `-${number}` : number
}

function dateToTime(dateToFormat, timeEnabled = true) {
    const date = new Date(dateToFormat)
    const today = new Date()

    let year = date.getFullYear()
    let month = date.getMonth()
    let day = date.getDate()
    let hours = date.getHours()
    let minutes = date.getMinutes()

    const isToday = (
        day == today.getDate() &&
        month == today.getMonth() &&
        year == today.getFullYear()
    )

    if(hours < 10) {
        hours = `0${hours}`
    }

    if(minutes < 10) {
        minutes = `0${minutes}`
    }

    const dateStr = `${day} ${months[month]} ${year}`

    if(!timeEnabled) {
        return dateStr
    }

    const time = `${hours}:${minutes}`
    const dateFull = `${dateStr}, ${time}`

    return isToday ? time : dateFull
}

function elapsedDateToShortString(date, flipNegative = false) {
    let dateElapsed = Date.now() - new Date(date).getTime()

    if(flipNegative) {
        dateElapsed = Math.abs(dateElapsed)
    }

    const minutes = Math.floor(dateElapsed / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const months = Math.floor(days / 30)
    const years = Math.floor(days / 365)

    if(years && years > 0) {
        return `${years}a`
    }

    if(months && months > 0) {
        return `${months}me`
    }

    if(days && days > 0) {
        return `${days}d`
    }

    if(hours && hours > 0) {
        return `${hours}h`
    }

    if(minutes && minutes > 0) {
        return `${minutes}m`
    }

    return '1m'
}

function elapsedDateToString(date, flipNegative = false) {
    let dateElapsed = Date.now() - new Date(date).getTime()

    if(flipNegative) {
        dateElapsed = Math.abs(dateElapsed)
    }

    let minutes = Math.floor(dateElapsed / (1000 * 60))
    let hours = Math.floor(minutes / 60)
    let days = Math.floor(hours / 24)
    let months = Math.floor(days / 30)
    let years = Math.floor(days / 365)

    minutes %= 60
    hours %= 24
    days %= 30
    months %= 12

    let string = ''
    let addedPrevious = false

    if(years && years > 0) {
        string += `${years}a `
        addedPrevious = true
    }

    if(addedPrevious || (months && months > 0)) {
        string += `${months}me `
        addedPrevious = true
    }

    if(addedPrevious || (days && days > 0)) {
        string += `${days}d `

        if(addedPrevious) {
            return string
        }

        addedPrevious = true
    }

    if(addedPrevious || (hours && hours > 0)) {
        string += `${hours}h `
    }

    string += `${minutes}m`

    return string
}

function extractHostName(url) {
    if(!url || !url.length) {
        return ''
    }

    try {
        let { hostname } = new URL(url, `http://${url}`)

        if(hostname.startsWith('www.')) {
            hostname = hostname.slice(4, hostname.length)
        }

        return hostname
    }
    catch(error) {
        return ''
    }
}

const getCookie = (key) => {
    const value = document.cookie.match('(^|;)\\s*' + key + '\\s*=\\s*([^;]+)')
    return value ? value.pop() : ''
}

const getIndexFromId = (list, ...args) => { // args can be id1, id2, etc
    const ids = list.map(entry => entry.id || entry)

    for(const id of args) {
        let indexId = ids.indexOf(id)

        if(indexId >= 0) {
            return indexId
        }
    }

    return 0
}

function hexToRgb(hex) {
    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
    hex = hex.replace(shorthandRegex, function(m, r, g, b) {
        return r + r + g + g + b + b
    })

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    const red = parseInt(result[1], 16)
    const green = parseInt(result[2], 16)
    const blue = parseInt(result[3], 16)

    return { red: red, green: green, blue: blue }
}

function isMobile() {
    return window.innerWidth <= 992
}

function jsonValue(obj, keys) {
    return keys.split('.').reduce(function(prev, curr) {
        return prev ? prev = prev[curr] : undefined;
    }, obj)
}

function prepareUrl(url) {
    if(!url.startsWith('http')) {
        url = `https://${url}`
    }

    if(url.endsWith('/')) {
        url = url.slice(0, -1)
    }

    return url
}

function processObjectsTr(objects, trObjects, keyTr = '') {
    if(!objects) {
        return []
    }

    if(!trObjects) {
        return objects
    }

    const listProcessed = []

    for(let object of objects) {
        if(typeof object !== 'object') {
            object = { id: object }
        }

        if(!object.noTr) {
            object.text = keyTr.length ? trObjects[object.id][keyTr] : trObjects[object.id]

            if(object.children) {
                object.children = processObjectsTr(object.children, trObjects, keyTr)
            }
        }

        listProcessed.push(object)
    }

    return listProcessed
}

let _secure = true

function setCookie(key, value) {
    const secure = _secure ? 'secure' : ''

    document.cookie = `${key}=${value}; expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/;${secure}`
}

function setCookiesSecure(secure) {
    _secure = secure
}

function scrollReachBottom(element) {
    const boundingRect = element.getBoundingClientRect()
    const distanceToBottom = (boundingRect.height + boundingRect.top) - window.innerHeight

    return distanceToBottom < 150
}

function scrollReachTop(element) {
    const boundingRect = element.getBoundingClientRect()

    return boundingRect.top > -150
}

function stripHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return doc.body.textContent || ''
}

function textToPathUrl(text) {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s/g, '').toLowerCase()
}

function throttleCalls(func, limit) {
    let lastFunc, lastRan

    return function() {
        const context = this
        const args = arguments

        if(!lastRan) {
            func.apply(context, args)
            lastRan = Date.now()
        }
        else {
            clearTimeout(lastFunc)
            lastFunc = setTimeout(() => {
                if((Date.now() - lastRan) >= limit) {
                    func.apply(context, args)
                    lastRan = Date.now()
                }
            }, limit - (Date.now() - lastRan))
        }
    }
}

function updateThemeCss(themeProperties, element) {
    const applyToRoot = !element

    if(!element) {
        element = document.documentElement
    }

    const updateColorProperty = (cssVar, colorHex) => {
        const rgb = hexToRgb(colorHex)

        element.style.setProperty(cssVar, colorHex)
        element.style.setProperty(`${cssVar}-rgb`, `${rgb.red}, ${rgb.green}, ${rgb.blue}`)
    }

    for(const property of Object.keys(themeProperties)) {
        updateColorProperty(property, themeProperties[property])
    }

    if(applyToRoot) {
        // Force webkit browsers to repaint scrollbars.
        const scrollY = window.pageYOffset

        document.body.style.display = 'none'
        document.body.offsetHeight
        document.body.style.display = 'block'

        window.scrollTo(0, scrollY)
    }
}

function validateChannelDescription(description) {
    return typeof description === 'string' && description.length <= 320
}

function validateChannelId(id) {
    const regExp = /^(([a-z0-9]+-)*[a-z0-9]+){3,20}$/
    return regExp.test(id)
}

function validateChannelName(name) {
    return typeof name === 'string' && name.length <= 30
}

function validateEmail(email) {
    const regExp = /\S+@\S+\.\S+/
    return regExp.test(email)
}

function validateNewsCategoryId(id) {
    const regExp = /^(([a-z0-9]+-)*[a-z0-9]+){3,20}$/
    return regExp.test(id)
}

function validateNewsSourceId(id) {
    const regExp = /^(([a-z0-9]+-)*[a-z0-9]+){2,20}$/
    return regExp.test(id)
}

function validatePassword(password) {
    const regExp = /(?=.*\d)(?=.*[a-z]).{6,60}/
    return regExp.test(password)
}

function validatePostTitle(title) {
    return typeof title === 'string' && title.length > 0 && title.length <= 200
}

function validateUrl(url) {
    if(!url.includes('.')) {
        return false
    }

    const pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,})?'+ // domain name and extension
        '(\\/[-a-z\\d%@_.~+*&$:=-]*)*'+ // path
        '(\\?[;&a-z\\d%@_.,~+*&$:=-]*)?'+ // query string
        '(\\#[-a-z\\d_]*)?$','i') // fragment locator

    return pattern.test(url)
}

function validateUsername(username) {
    const regExp = /^[a-zA-Z0-9]{5,20}$/
    return regExp.test(username)
}

exports.abbreviateNumber = abbreviateNumber
exports.dateToTime = dateToTime
exports.elapsedDateToShortString = elapsedDateToShortString
exports.elapsedDateToString = elapsedDateToString
exports.extractHostName = extractHostName
exports.getCookie = getCookie
exports.getIndexFromId = getIndexFromId
exports.hexToRgb = hexToRgb
exports.isMobile = isMobile
exports.jsonValue = jsonValue
exports.prepareUrl = prepareUrl
exports.processObjectsTr = processObjectsTr
exports.scrollReachBottom = scrollReachBottom
exports.scrollReachTop = scrollReachTop
exports.setCookie = setCookie
exports.setCookiesSecure = setCookiesSecure
exports.stripHtml = stripHtml
exports.textToPathUrl = textToPathUrl
exports.throttleCalls = throttleCalls
exports.updateThemeCss = updateThemeCss
exports.validateChannelDescription = validateChannelDescription
exports.validateChannelId = validateChannelId
exports.validateChannelName = validateChannelName
exports.validateEmail = validateEmail
exports.validateNewsCategoryId = validateNewsCategoryId
exports.validateNewsSourceId = validateNewsSourceId
exports.validatePostTitle = validatePostTitle
exports.validatePassword = validatePassword
exports.validateUrl = validateUrl
exports.validateUsername = validateUsername
