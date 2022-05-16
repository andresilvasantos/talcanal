import appm from 'js/app-manager'
import axios from 'axios'
import EventEmitter from '@client/js/event-emitter'
import { gameSettings, themes } from 'js/quina-vars'
import { getCookie } from 'js/utils'
import { timers } from 'js/default-vars'

const validateResponse = (response) => {
    if(response.data.redirect) {
        window.open(response.data.redirect, '_self')
    }

    return response.data.code
}

class QuinaManager extends EventEmitter {
    constructor() {
        super()

        this.countersGlobal = {}
        this.daltonicMode = false
        this.lastNumberChallenge = 1
        this.plays = []
        this.streakBest = 0
        this.streakCurrent = 0
        this.themeProperties = {}
        this.timeNextChallenge = new Date()
        this.synced = false

        this.dailyLoop = this.dailyLoop.bind(this)
    }

    destroy() {
    }

    // Getters & Setters

    getCountersGlobal() {
        return this.countersGlobal
    }

    getLastNumberChallenge() {
        return this.lastNumberChallenge
    }

    getPlay(number) {
        for(const play of this.plays) {
            if(play.numberChallenge == number) {
                return play
            }
        }

        return null
    }

    getPlays() {
        return this.plays
    }

    getStreakBest() {
        return this.streakBest
    }

    getStreakCurrent() {
        return this.streakCurrent
    }

    getThemeProperty(cssVar) {
        return this.themeProperties[cssVar]
    }

    getThemeProperties() {
        return this.themeProperties
    }

    getTimeNextChallenge() {
        return this.timeNextChallenge
    }

    hasSynced() {
        return this.synced
    }

    setCountersGlobal(counters) {
        this.countersGlobal = counters
    }

    setDaltonicMode(daltonicMode) {
        if(daltonicMode == this.daltonicMode) {
            return
        }

        this.daltonicMode = daltonicMode

        this.processTheme()
        //this.emit('themeChanged', this.theme)
    }

    setDataUser(dataUser) {
        this.plays = dataUser.plays
        this.streakBest = dataUser.streakBest
        this.streakCurrent = dataUser.streakCurrent
        this.synced = dataUser.synced
    }

    setLastNumberChallenge(number) {
        this.lastNumberChallenge = number
    }

    setTimeNextChallenge(time) {
        this.timeNextChallenge = time
    }

    // Methods.

    // TODO TODO TODO TODO remove

    /* fetchWords() {
        axios.get('/words')
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const words = response.data.words

            this.emit('fetchWordsSuccess', words)
        })
        .catch((error) => {
            console.log('Error fetching words:', error)
        })
    }

    pushWords(words) {
        axios.post('/pushwords', {
            _csrf: getCookie('XSRF-TOKEN'),
            words
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            console.log('YEAH!')
        })
        .catch((error) => {
            console.log('Error pushing words', error)
        })
    } */

    dailyLoop() {
        setTimeout(() => {
            this.emit('newChallengeAvailable')

            this.timeNextChallenge += 1000 * 60 * 60 * 24 // 24 hours
            this.dailyLoop()
        }, this.timeNextChallenge - Date.now())
    }

    loadInfo() {
        axios.get('/jogos/quina')
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const data = response.data
            const dataUser = data.dataUser

            this.countersGlobal = data.counters
            this.lastNumberChallenge = data.lastNumberChallenge
            this.plays = dataUser.plays
            this.streakBest = dataUser.streakBest
            this.streakCurrent = dataUser.streakCurrent
            this.timeNextChallenge = data.timeNextChallenge
            this.synced = dataUser.synced

            this.emit('loadInfoSuccess')
        })
        .catch((error) => {
            console.log('[QUINA] Error loading info:', error)

            this.emit('loadInfoError', error)
        })
    }

    processTheme() {
        let themeId = appm.getTheme()

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
            for(let key of keys) {
                const keyLC = key.toLowerCase()

                if(this.daltonicMode && (key == 'accent1' || key == 'accent2')) {
                    key += 'Daltonic'
                }
                else if(key.includes('Daltonic')) {
                    continue
                }

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

    resetProgress() {
        appm.emit('syncStarted')

        axios.post('/jogos/quina/reset', {
            _csrf: getCookie('XSRF-TOKEN')
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            appm.showNotification('Progresso limpo.')

            this.plays = []
            this.streakBest = 0
            this.streakCurrent = 0

            appm.emit('syncStopped')
            this.emit('resetProgressSuccess')
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            appm.showNotification('Problema ao limpar progresso.', -1)

            appm.emit('syncStopped')
            this.emit('resetProgressError', error)
        })
    }

    submitAttempt(word, numberChallenge) {
        appm.emit('syncStarted')

        axios.post('/jogos/quina/tentativa', {
            _csrf: getCookie('XSRF-TOKEN'),
            numberChallenge,
            word
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            const play = response.data.play
            let indexPlay = -1

            for(const [index, playExisting] of this.plays.entries()) {
                if(playExisting.numberChallenge == play.numberChallenge) {
                    indexPlay = index

                    break
                }
            }

            if(indexPlay == -1) {
                this.plays.push(play)
            }
            else {
                this.plays[indexPlay] = play
            }

            if(play.completed) {
                const modeString = play.easyMode ? 'easy' : 'normal'

                ++this.countersGlobal.plays

                if(play.victory) {
                    ++this.streakCurrent

                    if(this.streakCurrent > this.streakBest) {
                        this.streakBest = this.streakCurrent
                    }

                    ++this.countersGlobal.victories
                    ++this.countersGlobal.attemptsDistribution[modeString][play.attempts.length - 1].count
                }
                else {
                    const indexLoss = play.easyMode ? gameSettings.maxAttemptsEasyMode : gameSettings.maxAttempts

                    this.streakCurrent = 0
                    ++this.countersGlobal.attemptsDistribution[modeString][indexLoss].count
                }

                if(play.easyMode) {
                    ++this.countersGlobal.easyMode
                }
            }

            appm.emit('syncStopped')
            this.emit('submitAttemptSuccess', play)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            appm.emit('syncStopped')
            this.emit('submitAttemptError', error)
        })
    }

    syncAccount(id) {
        appm.emit('syncStarted')

        axios.post('/jogos/quina/sync', {
            _csrf: getCookie('XSRF-TOKEN'),
            id
        }, { timeout: timers.timeoutRequests })
        .then(response => {
            const code = validateResponse(response)

            if(code != 0) {
                throw code
            }

            appm.showNotification('Sincronização concluída.')
            this.setDataUser(response.data.dataUser)
            this.setDaltonicMode(response.data.daltonicMode)

            appm.emit('themeChanged', appm.getTheme())

            const user = appm.getUser()

            user.preferences.games.quina = {
                daltonicMode: response.data.daltonicMode,
                easyMode: response.data.easyMode
            }

            appm.emit('syncStopped')
            this.emit('syncAccountSuccess', user)
        })
        .catch((error) => {
            if(typeof error !== 'number') {
                console.log('Error', error)

				error = -100
            }

            if(error == 1) {
                appm.showNotification('Problema ao sincronizar - ID desconhecido.', -1)
            }
            else {
                appm.showNotification('Problema a sincronizar nova conta.', -1)
            }

            appm.emit('syncStopped')
            this.emit('syncAccountError', error)
        })
    }

    // Static

    static singleton() {
        if(!this.instance) {
            this.instance = new QuinaManager()
        }

        return this.instance
    }
}

export default QuinaManager.singleton()