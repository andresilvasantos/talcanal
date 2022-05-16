import axios from 'axios'
import EventEmitter from 'js/event-emitter'
import { getCookie, jsonValue, throttleCalls } from 'js/utils'
import { maxChannelAdmins, maxChannelMods, maxChannelSubscriptions, themes, timers, urls } from 'js/default-vars'
import { uid } from 'rand-token'
import { metadataFromPage } from 'js/composer'

const endpointFromType = (type) => {
    switch(type) {
        case 'channels':
            return 'c/canal'
        case 'comments':
            return 'c/comentario'
        case 'posts':
            return 'c/post'
        case 'users':
            return 'utilizador'
        case 'newsCategory':
            return 'noticias/categoria'
        case 'newsSource':
            return 'noticias/fonte'
        default:
            const trPage = AppManager.singleton().tr(type) || {}
            return trPage.id
    }
}

const validateResponse = (response) => {
    if(response.data.redirect) {
        window.open(response.data.redirect, '_self')
    }

    return response.data.code
}

class AppManager extends EventEmitter {
    constructor() {
        super()

        this.analyticsCollection = []
        this.channelsPopular = []
        this.channelsMod = []
        this.channelsSub = []
        this.dataChannelsMod = {}
        this.dirtyChannelsUser = true
        this.environment = ''
        this.newsCategories = []
        this.newsSources = []
        this.sidebarVisible = true
        this.signedIn = false
        this.stackPages = []
        this.themeProperties = {}
        this.theme = 'auto'
        this.translation = {}
        this.user = null

        this.scrolling = this.scrolling.bind(this)
        this.scrollThrottler = throttleCalls((event) => {
            this.emit('scroll', event)
        }, 50)

        const debounce = (cb) => () => window.requestAnimationFrame(cb)

        this.resize = this.resize.bind(this)
        this.resizeThrottler = debounce((event) => {
            this.emit('resize', event)
        })

        this.themeOSUpdated = this.themeOSUpdated.bind(this)
    }

    destroy() {
    }

    // Getters & Setters.

    getChannelsPopular() {
        return this.channelsPopular
    }

    getChannelsMod() {
        return this.channelsMod
    }

    getChannelsSub() {
        return this.channelsSub
    }

    getDataChannelsMod() {
        return this.dataChannelsMod
    }

    getDataPageLast() {
        return this.getPageLast().args
    }

    getEnvironment() {
        return this.environment
    }

    getNewsCategories() {
        return this.newsCategories
    }

    getNewsSources() {
        return this.newsSources
    }

    getPageLast() {
        return this.stackPages[this.stackPages.length - 1]
    }

    getStackPages() {
        return this.stackPages
    }

    getTheme() {
        return this.theme
    }

    getThemeProperty(cssVar) {
        return this.themeProperties[cssVar]
    }

    getThemeProperties() {
        return this.themeProperties
    }

    getTranslation() {
        return this.translation
    }

    getUrlCdn() {
        if(this.environment === 'development') {
            return `${urls.cdn}/dev`
        }

        return `${urls.cdn}/public`
    }

    getUser() {
        return this.user
    }

    hasPreviousPage() {
        return this.stackPages.length > 1
    }

    isChannelsUserDirty() {
        return this.dirtyChannelsUser
    }

    isSidebarVisible() {
        return this.sidebarVisible
    }

    isUserSignedIn() {
        return this.signedIn
    }

    setChannelsPopular(channels) {
        this.channelsPopular = channels
    }

    setEnvironment(environment) {
        this.environment = environment
    }

    setNewsCategories(categories) {
        this.newsCategories = categories
    }

    setNewsSources(sources) {
        this.newsSources = sources
    }

    setSidebarVisible(visible) {
        if(this.sidebarVisible == visible) {
            return
        }

        this.sidebarVisible = visible

        this.emit('sidebarVisibilityChanged', this.sidebarVisible)
    }

    setTheme(theme) {
        if(this.theme == 'auto') {
            window.matchMedia('(prefers-color-scheme: dark)').removeEventListener(
                'change', this.themeOSUpdated
            )
        }

        if(theme != 'auto' && !themes.hasOwnProperty(theme)) {
            return false
        }

        this.theme = theme

        if(this.theme == 'auto') {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener(
                'change', this.themeOSUpdated
            )
        }

        this.processTheme()
        this.emit('themeChanged', this.theme)
    }

    setTranslation(translation) {
        this.translation = translation
    }

    setUser(user) {
        const oldUser = this.user

        this.user = user

        // Signed in or account update.
        if(this.user) {
            if(this.user.preferences) {
                this.setTheme(this.user.preferences.theme)
            }

            if(!oldUser) {
                this.signedIn = true
                this.emit('signedIn', this.user)
            }
            else {
                // If user updated, don't let it call userChanged.
                if(oldUser.username == this.user.username) {
                    return this.emit('userUpdated', this.user)
                }
            }

            this.dirtyChannelsUser = true
            this.fetchChannelsUser()
            this.startPingAccount()
        }
        // Signed out.
        else if(oldUser) {
            this.stopPingAccount()

            this.channelsMod = []
            this.channelsSub = []
            this.dataChannelsMod = {}
            this.signedIn = false
            this.emit('signedOut')
        }

        this.emit('userChanged', this.user)
        //this.emit('userUpdated', this.user)
    }

    // Methods.

    addAnalyticsEvent(eventCategory, eventAction, eventLabel) {
        this.analyticsCollection.push({
            type: 'event',
            eventCategory: eventCategory,
            eventAction: eventAction,
            eventLabel: eventLabel
        })

        this.sendAnalytics()
    }

    addAnalyticsPageView(pageTitle) {
        const pageUrl = window.location.pathname

        this.analyticsCollection.push({
            title: pageTitle,
            type: 'pageview',
            url: pageUrl
        })

        this.sendAnalytics()
    }

    addBrowserHistory(url, title, changeHistory = true) {
        const baseTitle = this.tr('metadata.title')
        const fullTitle = title ? `${title} / ${baseTitle}` : baseTitle

        if(changeHistory) {
            window.history.pushState(null, fullTitle, url)
        }

        document.title = fullTitle
    }

    banUser(username) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/u/${username}/banir`, {
                _csrf: getCookie('XSRF-TOKEN')
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const banned = response.data.banned

            this.showNotification(`Utilizador ${banned ? 'banido' : 'desbanido'}.`) // TODO

            this.emit('syncStopped')
            this.emit('banUserSuccess', username, banned)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao banir utilizador.', -1) // TODO

            this.emit('syncStopped')
            this.emit('banUserError', username, error)
        })
    }

    copyToClipboard(text) {
        this.showNotification('Copiado para a área de transferência.', 0)

        if(navigator.clipboard) { // default: modern asynchronous API
            navigator.clipboard.writeText(text)
            return
        }

        if(window.clipboardData && window.clipboardData.setData) { // for IE11
            window.clipboardData.setData('Text', text)
            return
        }

        const input = document.createElement('textarea')

        input.innerHTML = text

        document.body.append(input)
        input.select()
        document.execCommand('copy')
        input.remove()
    }

    deleteAccount(password) {
        this.emit('syncStarted')

        axios.delete('/conta', { params: { _csrf: getCookie('XSRF-TOKEN'), password: password } },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.setUser(null)
            this.openPage('channels')
            this.showNotification('Conta eliminada.')
            this.emit('syncStopped')
            this.emit('deleteAccountSuccess')
        })
        .catch((error) => {
            console.log('Error deleting account', error)

            this.emit('syncStopped')
            this.emit('deleteAccountError', error)
        })
    }

    fetchTransparency() {
        axios.get('/transparencia')
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const transparency = response.data.transparency

            this.emit('fetchTransparencySuccess', transparency)
        })
        .catch((error) => {
            console.log('Error fetching transparency:', error)

            this.emit('fetchTransparencyError', error)
        })
    }

    hideTooltip() {
        this.emit('hideTooltip')
    }

    openPage(idPage, idPane = '', optionsOpen = false, ...args) {
        let allowBack = false
        let newTab = false

        if(typeof optionsOpen === 'boolean') {
            allowBack = optionsOpen
        }
        else {
            allowBack = optionsOpen.allowBack
            newTab = optionsOpen.newTab
        }

        if(newTab) {
            const dataUrl = metadataFromPage(idPage, idPane, args, this)

            if(!dataUrl) {
                return
            }

            const eventClick = new MouseEvent('click', { button: 0, ctrlKey: true })
            const buttonLink = document.querySelector('.button-linkdummy')

            buttonLink.href = `${urls.domain}${dataUrl.path}`

            return buttonLink.dispatchEvent(eventClick)
        }

        if(allowBack) {
            const pageCurrent = this.stackPages[this.stackPages.length - 1]

            pageCurrent.scrollY = window.scrollY

            this.stackPages.push({ id: idPage, idPane: idPane, args: args })
        }
        else {
            this.stackPages = [{ id: idPage, idPane: idPane, args: args }]
        }

        this.emit('pageChanged', idPage, idPane, args, false, allowBack, false)
        this.addAnalyticsPageView(`${idPage}${idPane.length ? `-${idPane}` : ''}`)
    }

    openTabExternal(url) {
        window.open(url, '_blank').focus()
    }

    openTabSameDomain(path = '') {
        window.open(`${urls.domain}${path}`, '_blank')
    }

    previousPage(browserRequest = false) {
        const page = this.stackPages[this.stackPages.length - 1]

        this.stackPages.pop()

        const pagePrevious = this.stackPages[this.stackPages.length - 1]

        // We can't go back, no previous page.
        if(!pagePrevious) {
            // If current page has the generic pane, let's move home,
            if(!page.idPane) {
                this.openPage('channels')
                return
            }

            if(page.id == 'channels') {
                switch(page.idPane) {
                    case 'channelMod':
                    case 'channelSettings':
                        return this.openPage('channels', 'channel', {}, ...page.args)
                }
            }

            if(page.id == 'chats') {
                return this.openPage('channels')
            }
            else {
                // Move to the generic pane.
                return this.openPage(page.id)
            }
        }

        const idPage = pagePrevious.id
        const idPane = pagePrevious.idPane
        const args = pagePrevious.args

        this.emit('pageChanged', idPage, idPane, args, true, false, browserRequest)
        this.addAnalyticsPageView(`${idPage}-${idPane}`)
    }

    processTheme() {
        let themeId = this.theme

        if(themeId == 'auto') {
            if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                themeId = 'dark'
            }
            else {
                themeId = 'light'
            }
        }

        const theme = themes[themeId]
        this.themeProperties = {}

        const registerProperty = (cssVar, value) => {
            this.themeProperties[cssVar] = value
        }

        const processKeys = (theme, keys, prefix = '') => {
            for(const key of keys) {
                const keyLC = key.toLowerCase()

                if(typeof theme[key] == 'object') {
                    const prefixStr = prefix.length ? prefix : ''

                    processKeys(theme[key], Object.keys(theme[key]), `${prefixStr}${keyLC}-`)
                }
                else {
                    registerProperty(`--color-${prefix}${keyLC}`, theme[key])
                }
            }
        }

        processKeys(theme, Object.keys(theme))
    }

    recoverAccount(idUser) {
        this.emit('syncStarted')

        axios.post('/recuperar', {
            _csrf: getCookie('XSRF-TOKEN'),
            idUser: idUser
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.emit('syncStopped')
            this.emit('recoverAccountSuccess')
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.emit('syncStopped')
            this.emit('recoverAccountError', error)
        })
    }

    resize(event) {
        this.resizeThrottler(event)
    }

    scrolling(event) {
        this.scrollThrottler(event)
    }

    sendAnalytics() {
        if(this.timeoutSendAnalytics) {
            return
        }

        // A timeout so we can group multiple updates.
        this.timeoutSendAnalytics = setTimeout(() => {
            axios.post('/analytics', {
                _csrf: getCookie('XSRF-TOKEN'),
                data: JSON.stringify(this.analyticsCollection)
            })
            .then(response => {})
            .catch(error => {})

            this.analyticsCollection = []
            this.timeoutSendAnalytics = null
        }, timers.delaySendAnalytics)
    }

    sendMessage(idChat, message) {
        const idSend = uid(6)

        axios.post(`/conversas/${idChat}`, {
            _csrf: getCookie('XSRF-TOKEN'),
            message: message
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const dataMessage = response.data.message

            this.emit('messageSent', idSend, idChat, dataMessage)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

                error = -100
            }

            this.showNotification('Problema ao enviar mensagem.', -1)
            this.emit('sendMessageError', idSend, error)
        })

        return idSend
    }

    signIn(idUser, password) {
        this.emit('syncStarted')

        axios.post('/entrar', {
            _csrf: getCookie('XSRF-TOKEN'),
            password: password,
            idUser: idUser
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const user = response.data.user

            this.showNotification(`Bem-vindo <span class='bold'>${user.username}</span>.`)
            this.setUser(user)
            this.emit('syncStopped')
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.emit('syncStopped')
            this.emit('signInError', error)
        })
    }

    signOut(sayGoodbye = true) {
        axios.post('/sair', {
            _csrf: getCookie('XSRF-TOKEN')
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            if(sayGoodbye) {
                this.showNotification('Estás off. Até já!')
            }

            this.setUser(null)
            this.openPage('channels')
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.emit('signOutError', error)
        })
    }

    signUp(username, email, password) {
        this.emit('syncStarted')

        axios.post('/registar', {
            _csrf: getCookie('XSRF-TOKEN'),
            email: email,
            password: password,
            theme: this.getTheme(),
            username: username
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.emit('syncStopped')
            this.emit('signedUp')
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.emit('syncStopped')
            this.emit('signUpError', error)
        })
    }

    showNotification(message, code, icon) {
        this.emit('showNotification', message, code, icon)
    }

    showPopup(name, ...args) {
        const popupsAuthNeeded = [
            'createChannel', 'createPost',
            'addMod', 'manageUsers',
            'sendMessage', 'createChat',  'blockUser',
            'deleteItem', 'report', 'requestAccess', 'deleteAccount',
            'newsSettings'
        ]

        if(popupsAuthNeeded.includes(name) && !this.isUserSignedIn()) {
            return this.emit('showPopup', 'auth', args)
        }

        this.emit('showPopup', name, args)
        this.addAnalyticsEvent('popup', 'show', name)
    }

    showTooltip(text, extraClasses, triggerBoundingRect) {
        this.emit('showTooltip', text, extraClasses, triggerBoundingRect)
    }

    startPingAccount() {
        if(this.pingAccountStarted || document.hidden) {
            return
        }

        this.pingAccountStarted = true
        this.esPingAccount = new EventSource('/conta/ping')

        this.esPingAccount.addEventListener('message', event => {
            let data

            try {
                data = JSON.parse(event.data)
            }
            catch(error) {
                return
            }

            if(data.status != 'active') {
                switch(data.status) {
                    case 'pending':
                        this.showNotification('A tua conta não está ativada.', -1) // TODO
                        break
                    case 'banned':
                        this.showNotification('A tua conta foi banida.', -1) // TODO
                        break
                    case 'removed':
                        this.showNotification('A tua conta foi eliminada.', -1) // TODO
                        break
                    default:
                        this.showNotification('A tua conta não está disponível.', -1) // TODO
                        break
                }

                this.signOut(false)
            }

            this.user.countNotificationsNew = data.countNotificationsNew
            this.user.karma = data.karma
            this.user.messagesNew = data.messagesNew
            this.dataChannelsMod = data.infoChannelsMod

            this.emit('pingAccountSuccess', this.user, data)

            if(data.infoChannelsMod) {
                this.emit('pingChannelsModSuccess', data.infoChannelsMod)
            }
        })

        this.esPingAccount.addEventListener('error', event => {
            this.stopPingAccount()

            setTimeout(() => {
                this.startPingAccount()
            }, 5000)
        })
    }

    startPingChat(idChat) {
        if(this.pingChatStarted || document.hidden) {
            return
        }

        this.pingChatStarted = true
        this.esPingChat = new EventSource(`/conversas/${idChat}/ping`)

        this.esPingChat.addEventListener('message', event => {
            let data

            try {
                data = JSON.parse(event.data)
            }
            catch(error) {
                return
            }

            this.emit('pingChatSuccess', data)
        })

        this.esPingChat.addEventListener('error', event => {
            this.stopPingChat()
        })
    }

    startRandomChat() {
        if(this.pingRandomChatStarted) {
            return
        }

        this.pingRandomChatStarted = true
        this.esPingRandomChat = new EventSource('/chatdatreta/ping')

        this.esPingRandomChat.addEventListener('message', event => {
            let data

            try {
                data = JSON.parse(event.data)
            }
            catch(error) {
                return
            }

            this.emit('pingRandomChatSuccess', data)
        })

        this.esPingRandomChat.addEventListener('error', event => {
            this.stopRandomChat()
        })
    }

    stopPingAccount() {
        if(!this.pingAccountStarted) {
            return
        }

        this.pingAccountStarted = false
        this.esPingAccount.close()
    }

    stopPingChat() {
        if(!this.pingChatStarted) {
            return
        }

        this.pingChatStarted = false
        this.esPingChat.close()

        this.emit('stopChatSuccess')
    }

    stopRandomChat() {
        if(!this.pingRandomChatStarted) {
            return
        }

        this.pingRandomChatStarted = false
        this.esPingRandomChat.close()

        this.emit('stopRandomChatSuccess')
    }

    stopPings() {
        this.stopPingAccount()
        this.stopPingChat()
        this.stopRandomChat()
    }

    subscribeChannel(idChannel) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post('/c/subscrever', {
                _csrf: getCookie('XSRF-TOKEN'),
                idChannel
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const subscribed = response.data.subscribed

            this.dirtyChannelsUser = true

            this.emit('syncStopped')
            this.emit('subscribeChannelSuccess', idChannel, subscribed)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            if(error == 2) {
                this.showNotification(`Nº máximo de canais subscritos (${maxChannelSubscriptions}).`, -1) // TODO
            }
            else {
                this.showNotification('Problema ao subscrever canal.', -1) // TODO
            }

            this.emit('syncStopped')
            this.emit('subscribeChannelError', error)
        })
    }

    tr(keys) {
        if(!keys || !keys.length) {
            return ''
        }

        let value = jsonValue(this.translation, keys)

        if(!value) {
            value = keys
        }

        return value
    }

    updateAccount(data, quiet = false) {
        this.emit('syncStarted')

        axios.patch('/conta', { _csrf: getCookie('XSRF-TOKEN'), data: data },
                { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const user = response.data.user
            const verifyEmail = response.data.verifyEmail

            this.setUser(user)

            if(verifyEmail) {
                this.showNotification('Enviámos um pedido de confirmação para o teu novo email.') // TODO
            }
            else if(!quiet) {
                this.showNotification('Conta atualizada.') // TODO
            }

            this.emit('syncStopped')
            this.emit('updateAccountSuccess', user, response.data.verifyEmail)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao atualizar a tua conta.', -1) // TODO
            this.emit('syncStopped')
            this.emit('updateAccountError', error)
        })
    }

    uploadImages(size, formData) {
        const idUpload = uid(6)

        this.emit('syncStarted')

        formData.set('size', size)

        axios.post('/images', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
                'X-CSRF-Token': getCookie('XSRF-TOKEN')
            },
            onUploadProgress: (progressEvent) => {
                const uploadProgress = progressEvent.loaded / progressEvent.total

                console.log('upload progress', uploadProgress)

                this.emit('uploadImagesProgress', idUpload, uploadProgress)
            }
        })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const ids = response.data.ids

            this.emit('syncStopped')
            this.emit('uploadImagesSuccess', idUpload, ids)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao carregar imagens.', -1) // TODO

            this.emit('syncStopped')
            this.emit('uploadImagesError', idUpload, error)
        })

        return idUpload
    }

    voteComment(idComment, idPost, vote) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post('/c/comentario/votar', {
                _csrf: getCookie('XSRF-TOKEN'),
                idComment,
                idPost,
                vote: vote
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const vote = response.data.vote
            const voteIncrement = response.data.voteIncrement

            this.emit('syncStopped')
            this.emit('voteCommentSuccess', idComment, idPost, vote, voteIncrement)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao registar o voto.', -1) // TODO
            this.emit('syncStopped')
            this.emit('voteCommentError', error)
        })
    }

    votePoll(idPost, indexOptions) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post('/c/sondagem/votar', {
                _csrf: getCookie('XSRF-TOKEN'),
                idPost,
                indexOptions
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.emit('syncStopped')
            this.emit('votePollSuccess', idPost, indexOptions)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao registar o voto.', -1) // TODO
            this.emit('syncStopped')
            this.emit('votePollError', error)
        })
    }

    votePost(idPost, vote) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post('/c/post/votar', {
                _csrf: getCookie('XSRF-TOKEN'),
                idPost,
                vote: vote
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const vote = response.data.vote
            const voteIncrement = response.data.voteIncrement

            this.emit('syncStopped')
            this.emit('votePostSuccess', idPost, vote, voteIncrement)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao registar o voto.', -1) // TODO
            this.emit('syncStopped')
            this.emit('votePostError', error)
        })
    }


    /*
        ITEMS
    */

    activateItems(type, ids) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.post(`/${endpoint}/ativar`, {
                _csrf: getCookie('XSRF-TOKEN'),
                ids
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const active = response.data.active

            this.showNotification(`
                ${ids.length} ${active ? '' : 'des'}ativada${ids.length > 1 ? 's' : ''}.
            `
            ) // TODO

            this.emit('syncStopped')
            this.emit('activateItemsSuccess', type, ids, active)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao ativar.', -1) // TODO

            this.emit('syncStopped')
            this.emit('activateItemsError', type, ids, error)
        })
    }

    approveItems(type, ids) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.post(`/${endpoint}/aprovar`, {
                _csrf: getCookie('XSRF-TOKEN'),
                ids
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.showNotification(`
                ${ids.length} aprovado${ids.length > 1 ? 's' : ''}.
            `) // TODO

            this.emit('syncStopped')
            this.emit('approveItemsSuccess', type, ids)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao aprovar.', -1) // TODO

            this.emit('syncStopped')
            this.emit('approveItemsError', type, ids, error)
        })
    }

    createItem(type, data) {
        if(!this.isUserSignedIn()) {
            this.showPopup('auth')
            return false
        }

        const endpoint = endpointFromType(type)
        const idRequest = uid(6)

        axios.post(`/${endpoint}`, {
            _csrf: getCookie('XSRF-TOKEN'),
            data
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)
            let omitNotification = false

            if(type == 'chats') {
                // 0 - created, 1 - already exists.
                if(code != 0 && code != 1) {
                    throw code
                }

                // TODO translate notifications
                if(code == 0) {
                    this.showNotification('Conversa criada.')
                }

                omitNotification = true
            }
            else if(code != 0) {
                throw code
            }

            const typeSingular = type.slice(-1) == 's' ? type.slice(0, -1) : type
            const item = response.data[typeSingular]

            if(type == 'channels') {
                this.dirtyChannelsUser = true
            }

            if(type == 'newsCategory') {
                this.newsCategories.push(item)
                this.newsCategories.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
            }
            else if(type == 'newsSource') {
                this.newsSources.push(item)
                this.newsSources.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
            }

            // TODO translate notifications
            if(!omitNotification) {
                this.showNotification('Criado.')
            }

            this.emit('syncStopped')
            this.emit('createItemSuccess', type, idRequest, item)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            // TODO translate notifications
            if(type == 'chats') {
                if(data.message && data.message.length) {
                    this.showNotification('Problema ao enviar mensagem.', -1)
                }
                else {
                    this.showNotification('Problema ao criar conversa.', -1)
                }
            }
            if(type == 'channels') {
                if(error == 21) {
                    this.showNotification('Tens criado demasiados canais.<br>Tenta de novo amanhã.', -1)
                }
                else {
                    this.showNotification('Problema ao criar canal.', -1)
                }
            }
            else if(type == 'posts') {
                if(error == 21) {
                    this.showNotification('Tens postado demasiado.<br>Aguarda um pouco.', -1)
                }
                else if(error == 5) {
                    this.showNotification('Estás banido deste canal.<br>Se achares ser um lapso, entra em contacto com os moderadores.', -1)
                }
                else {
                    this.showNotification('Problema ao criar o post.', -1) // TODO
                }
            }
            else if(type == 'comments') {
                if(error == 21) {
                    this.showNotification('Tens comentado demasiado.<br>Aguarda um pouco.', -1)
                }
                else {
                    this.showNotification('Problema ao criar o comentário.', -1) // TODO
                }
            }
            else {
                this.showNotification('Problema ao criar.', -1) // TODO
            }

            this.emit('syncStopped')
            this.emit('createItemError', type, idRequest, error)
        })

        return idRequest
    }

    deleteItem(type, id) {
        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.delete(`/${endpoint}`, {
            params: {
                _csrf: getCookie('XSRF-TOKEN'),
                ids: [id]
            }
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            if(type == 'channels') {
                this.dirtyChannelsUser = true
            }
            else if(type == 'newsCategory') {
                for(const [index, category] of this.newsCategories.entries()) {
                    if(category.id == id) {
                        this.newsCategories.splice(index, 1)
                        break
                    }
                }
            }
            else if(type == 'newsSource') {
                for(const [index, source] of this.newsSources.entries()) {
                    if(source.id == id) {
                        this.newsSources.splice(index, 1)
                        break
                    }
                }
            }

            this.showNotification('Eliminado.') // TODO
            this.emit('syncStopped')
            this.emit('deleteItemSuccess', type, id)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao eliminar.', -1) // TODO
            this.emit('syncStopped')
            this.emit('deleteItemError', type, id, error)
        })
    }

    favoriteItem(type, id) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.post(`/${endpoint}/favoritar`, {
                _csrf: getCookie('XSRF-TOKEN'),
                id
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const favorited = response.data.favorited

            if(favorited) {
                this.showNotification('Adicionado aos favoritos.', 0, 'heart')
            }

            this.emit('syncStopped')
            this.emit('favoriteItemSuccess', type, id, favorited)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.emit('syncStopped')
            this.emit('favoriteItemError', type, id, error)
        })
    }

    fetchItems(type, filter = '', filtersExtra = {}, pageCurrent = 0, keySort = 'createdAt', itemsPerPage = 0) {
        const idFetch = uid(6)

        if(!itemsPerPage) {
            itemsPerPage = 20
        }

        axios.get(`/data/${type}`, {
            params: {
                pageCurrent: pageCurrent,
                filter: filter,
                filtersExtra: filtersExtra,
                itemsPerPage: itemsPerPage,
                keySort: keySort
            }
        })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const items = response.data[type] || []
            const countTotal = response.data.countTotal || 0

            // If we're fetching channels of user, update them.
            if(idFetch == this.idFetchChannelsUser) {
                this.channelsMod = items.mod
                this.channelsSub = items.sub
                this.dirtyChannelsUser = false
                this.fetchingChannelsUser = false
            }

            this.emit('fetchItemsSuccess', idFetch, items, countTotal, pageCurrent)
        })
        .catch((error) => {
            console.log('Error fetching items:', error)

            if(idFetch == this.idFetchChannelsUser) {
                this.fetchingChannelsUser = false
            }

            this.emit('fetchItemsError', idFetch, error)
        })

        return idFetch
    }

    pinItem(type, id, where) {
        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.post(`/${endpoint}/afixar`, {
            _csrf: getCookie('XSRF-TOKEN'),
            id,
            where
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const pinned = response.data.pinned

            const trWhere = where == 'channel' ? 'canal' : 'perfil'
            this.showNotification(pinned ? `Afixado no ${trWhere}.` : `Desafixado do ${trWhere}.`)

            this.emit('syncStopped')
            this.emit('pinItemSuccess', type, id, pinned)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

                error = -100
            }

            this.showNotification('Problema ao afixar.', -1)
            this.emit('syncStopped')
            this.emit('pinItemError', type, id, error)
        })
    }

    rejectItems(type, ids) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.post(`/${endpoint}/rejeitar`, {
                _csrf: getCookie('XSRF-TOKEN'),
                ids
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.showNotification(`
                ${ids.length} ${ids.length > 1 ? 'rejeitados.' : 'rejeitado.'}
            `) // TODO

            this.emit('syncStopped')
            this.emit('rejectItemsSuccess', type, ids)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao rejeitar.', -1) // TODO

            this.emit('syncStopped')
            this.emit('rejectItemsError', type, ids, error)
        })
    }

    reportItem(type, id, flag, text) {
        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.post(`/${endpoint}/denunciar`, {
            _csrf: getCookie('XSRF-TOKEN'),
            id,
            flag,
            text
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.showNotification('Denunciado.')
            this.emit('syncStopped')
            this.emit('reportItemSuccess', type, id)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

                error = -100
            }

            this.showNotification('Problema ao denunciar.', -1)
            this.emit('syncStopped')
            this.emit('reportItemError', type, id, error)
        })
    }

    themeOSUpdated(event) {
        if(this.theme != 'auto') {
            return
        }

        this.processTheme()
        this.emit('themeChanged', this.theme)
    }

    updateItem(type, id, data) {
        this.emit('syncStarted')

        const endpoint = endpointFromType(type)

        axios.patch(`/${endpoint}`, { _csrf: getCookie('XSRF-TOKEN'), id, data: data },
                { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const typeSingular = type.slice(-1) == 's' ? type.slice(0, -1) : type
            const item = response.data[typeSingular]

            if(type == 'newsSource') {
                for(const [index, source] of this.newsSources.entries()) {
                    if(source.id == id) {
                        this.newsSources[index] = Object.assign(source, item)
                        break
                    }
                }
            }
            else if(type == 'newsCategory') {
                for(const [index, category] of this.newsCategories.entries()) {
                    if(category.id == id) {
                        this.newsCategories[index] = Object.assign(category, item)
                        break
                    }
                }
            }

            this.showNotification('Atualizado.') // TODO

            this.emit('syncStopped')
            this.emit('updateItemSuccess', type, id, item)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            if(type == 'channels') {
                switch(error) {
                    case -16:
                        this.showNotification(`Nº máximo de administradores (${maxChannelAdmins}).`, -1) // TODO
                        break
                    case -17:
                        this.showNotification(`Nº máximo de moderadores (${maxChannelMods}).`, -1) // TODO
                        break
                }
            }

            this.showNotification('Problema ao atualizar.', -1) // TODO
            this.emit('syncStopped')
            this.emit('updateItemError', type, id, error)
        })
    }

    // Channels.

    banFromChannel(idChannel, username) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/c/${idChannel}/banir`, {
                _csrf: getCookie('XSRF-TOKEN'),
                username
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const banned = response.data.banned

            this.emit('syncStopped')
            this.emit('banFromChannelSuccess', idChannel, username, banned)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao banir utilizador.', -1) // TODO

            this.emit('syncStopped')
            this.emit('banFromChannelError', idChannel, username, error)
        })
    }

    banChannel(id) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/c/banir`, {
                _csrf: getCookie('XSRF-TOKEN'),
                id
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const banned = response.data.banned

            this.showNotification(`Canal ${banned ? 'banido' : 'desbanido'}.`) // TODO

            this.emit('syncStopped')
            this.emit('banChannelSuccess', id, banned)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao banir canal.', -1) // TODO

            this.emit('syncStopped')
            this.emit('banChannelError', id, error)
        })
    }

    fetchChannelsUser() {
        if(!this.isUserSignedIn()) {
            return
        }

        if(this.fetchingChannelsUser) {
            return this.idFetchChannelsUser
        }

        this.fetchingChannelsUser = true
        this.idFetchChannelsUser = this.fetchItems('channels', '', { myChannels: true })

        return this.idFetchChannelsUser
    }

    inviteToChannel(idChannel, username) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/c/${idChannel}/convidar`, {
                _csrf: getCookie('XSRF-TOKEN'),
                username
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const invited = response.data.invited

            this.emit('syncStopped')
            this.emit('inviteToChannelSuccess', idChannel, username, invited)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao convidar utilizador.', -1) // TODO

            this.emit('syncStopped')
            this.emit('inviteToChannelError', idChannel, username, error)
        })
    }

    leaveChannel(idChannel) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/c/${idChannel}/abandonar`, {
                _csrf: getCookie('XSRF-TOKEN')
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.showNotification('Abandonaste o cargo de moderador.')

            this.emit('syncStopped')
            this.emit('leaveChannelSuccess', idChannel)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao abandonar canal.', -1) // TODO

            this.emit('syncStopped')
            this.emit('leaveChannelError', idChannel, error)
        })
    }

    lockPosts(ids) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post('/c/post/trancar', {
                _csrf: getCookie('XSRF-TOKEN'),
                ids
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const lock = response.data.lock

            this.showNotification(`
                Discuss${ids.length > 1 ? 'ões' : 'ão'} ${lock ? '' : 'des'}bloqueada${ids.length > 1 ? 's' : ''}.
            `
            ) // TODO

            this.emit('syncStopped')
            this.emit('lockPostsSuccess', ids, lock)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao bloquear discussões.', -1) // TODO
            this.emit('syncStopped')
            this.emit('lockPostsError', ids, error)
        })
    }

    replyChannelAccess(idChannel, username, accept) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/c/${idChannel}/responderpedido`, {
                _csrf: getCookie('XSRF-TOKEN'),
                username,
                accept
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            if(accept) {
                this.showNotification(`Pedido aceite.`) // TODO
            }
            else {
                this.showNotification(`Pedido rejeitado.`) // TODO
            }

            this.emit('syncStopped')
            this.emit('replyChannelAccessSuccess', idChannel, username, accept)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            if(accept) {
                this.showNotification(`Problema ao aceitar.`, -1) // TODO
            }
            else {
                this.showNotification(`Problema ao rejeitar.`, -1) // TODO
            }

            this.emit('syncStopped')
            this.emit('replyChannelAccessError', idChannel, username, error)
        })
    }

    requestChannelAccess(idChannel, text) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/c/${idChannel}/pediracesso`, {
                _csrf: getCookie('XSRF-TOKEN'),
                text
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.showNotification(`Pedido submetido.`) // TODO

            this.emit('syncStopped')
            this.emit('requestChannelAccessSuccess', idChannel)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao submeter pedido.', -1) // TODO

            this.emit('syncStopped')
            this.emit('requestChannelAccessError', idChannel, error)
        })
    }

    reviveChannel(id) {
        if(!this.isUserSignedIn()) {
            return this.showPopup('auth')
        }

        this.emit('syncStarted')

        axios.post(`/c/reavivar`, {
                _csrf: getCookie('XSRF-TOKEN'),
                id
            },
            { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.showNotification(`Canal reavivado.`) // TODO

            this.emit('syncStopped')
            this.emit('reviveChannelSuccess', id)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.showNotification('Problema ao reavivaar canal.', -1) // TODO

            this.emit('syncStopped')
            this.emit('reviveChannelError', id, error)
        })
    }

    // News.

    fetchMoreNews(idSource) {
        this.emit('syncStarted')

        const params = { _csrf: getCookie('XSRF-TOKEN') }

        if(idSource) {
            params.id = idSource
        }

        axios.post('/noticias/refrescar', params,
        { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            this.showNotification('A refrescar notícias.')
            this.emit('syncStopped')
            this.emit('syncNewsSuccess')
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            this.emit('syncStopped')
            this.emit('syncNewsError', error)
        })
    }

    newsClick(id) {
        if(!this.isUserSignedIn()) {
            return
        }

        axios.post('/noticias/click', {
            _csrf: getCookie('XSRF-TOKEN'),
            id
        }, { timeout: timers.timeoutRequests })
        .then(response => {})
        .catch((error) => {})
    }

    // Random chat.

    sendMessageRandomChat(idChat, message) {
        const idSend = uid(6)

        axios.post(`/chatdatreta/${idChat}`, {
            _csrf: getCookie('XSRF-TOKEN'),
            message: message
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const id = response.data.id

            this.emit('messageSentRandomChat', idSend, id)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

                error = -100
            }

            this.showNotification('Problema ao enviar mensagem.', -1)
            this.emit('sendMessageRandomChatError', idSend, error)
        })

        return idSend
    }

    // Static.

    static singleton() {
        if(!this.instance) {
            this.instance = new AppManager()
        }

        return this.instance
    }
}

export default AppManager.singleton()