const EventEmitter = require('@client/js/event-emitter')
const fs = require('fs').promises
const { gameSettings } = require('@client/js/quina-vars')
const { isDaylightSavingTime } = require('@server/utils')
const { models } = require('mongoose')

class QuinaManager extends EventEmitter {
    constructor() {
        super()

        // QUINA.
        this.challenges = []
        this.counters = {}
        this.timeNextChallenge = new Date()
        this.words = []
        this.wordsNormalized = []
    }

    destroy() {
    }

    init() {
        return new Promise(async(resolve) => {
            const config = await models.Config.findOneAndUpdate({}, {},
                { new: true, setDefaultsOnInsert: true, upsert: true }).exec()

            const configQuina = config.games.quina
            this.challenges = configQuina.challenges
            //this.words = configQuina.words

            // Read words file into array.
            const wordsString = await fs.readFile('quina-words.txt', 'utf8')
            this.words = wordsString.split(',')

            // Create similar array with normalized words.
            for(const word of this.words) {
                this.wordsNormalized.push(
                    word
                    .normalize('NFD')
                    .replace(/\p{Diacritic}/gu, '')
                    .replace(/\s/g, '')
                    .toLowerCase()
                )
            }

            // Populate counters.
            this.counters.challenges = configQuina.challenges.length

            const usersWithPlaysCompleted = await models.User.aggregate([
                {
                    $lookup: {
                        from: 'quinaplays',
                        localField: 'games.quina.plays',
                        foreignField: '_id',
                        as: 'playDetails'
                    }
                },
                { $match: { 'playDetails.completed': true }}
            ])

            this.counters.users = usersWithPlaysCompleted.length
            this.counters.plays = await models.QuinaPlay.countDocuments({ completed: true }).exec()
            this.counters.victories = await models.QuinaPlay.countDocuments({
                completed: true, victory: true
            }).exec()
            this.counters.easyMode = await models.QuinaPlay.countDocuments({
                completed: true, easyMode: true
            }).exec()

            const addNormal = []
            const addEasyMode = []

            // Normal mode.
            for(let i = 0; i < gameSettings.maxAttempts + 1; ++i) {
                const query = { completed: true, easyMode: false }

                if(i < gameSettings.maxAttempts) {
                    query.victory = true
                    query.attempts = { $size: i + 1 }
                }
                else {
                    query.victory = false
                }

                const count = await models.QuinaPlay.countDocuments(query).exec()

                addNormal.push({ count: count })
            }

            // Easy mode.
            for(let i = 0; i < gameSettings.maxAttemptsEasyMode + 1; ++i) {
                const query = { completed: true, easyMode: true }

                if(i < gameSettings.maxAttempts) {
                    query.victory = true
                    query.attempts = { $size: i + 1 }
                }
                else {
                    query.victory = false
                }

                const count = await models.QuinaPlay.countDocuments(query).exec()

                addEasyMode.push({ count: count })
            }

            this.counters.attemptsDistribution = { normal: addNormal, easy: addEasyMode }

            console.log(`QUINA - Found ${this.words.length} words and ${this.counters.challenges} challenges.`)

            // Create new challenge if first time or if last one was created more than 24 hours ago.
            const challengeLast = this.challenges.length ? this.challenges[this.challenges.length - 1] : null

            if(!challengeLast || new Date - challengeLast.date > 24 * 60 * 60 * 1000) {
                this.createNewChallenge()
            }

            this.dailyLoop()

            resolve()
        })
    }

    // Getters & Setters.

    getChallenge(number = -1) {
        const index = number - 1

        if(number == -1 || index < 0 || index > this.challenges.length ) {
            return this.challenges[this.challenges.length - 1]
        }

        return this.challenges[index]
    }

    getCounters() {
        return this.counters
    }

    getTimeNextChallenge() {
        return this.timeNextChallenge
    }

    getWordDiacritics(word) {
        return this.words[this.wordsNormalized.indexOf(word)]
    }

    getWordNormalized(word) {
        return this.wordsNormalized[this.words.indexOf(word)]
    }

    /* getWords() {
        return this.words
    } */

    isValidWord(word) {
        return this.wordsNormalized.includes(word)
    }

    // Methods.

    accountCleared(plays) {
        let hasPlaysCompleted = false

        for(const play of plays) {
            if(!play.completed) {
                continue
            }

            const modeString = play.easyMode ? 'easy' : 'normal'

            hasPlaysCompleted = true

            --this.counters.plays

            if(play.victory) {
                --this.counters.victories
                --this.counters.attemptsDistribution[modeString][play.attempts.length - 1].count
            }
            else {
                const indexLoss = play.easyMode ? gameSettings.maxAttemptsEasyMode : gameSettings.maxAttempts

                --this.counters.attemptsDistribution[modeString][indexLoss].count
            }

            if(play.easyMode) {
                --this.counters.easyMode
            }
        }

        if(hasPlaysCompleted) {
            --this.counters.users
        }
    }

    createNewChallenge() {
        ++this.counters.challenges

        this.challenges.push({
            answer: this.words[Math.floor(Math.random() * this.words.length)],
            date: new Date(),
            number: this.counters.challenges
        })

        models.Config.updateOne({}, { $set: { 'games.quina.challenges': this.challenges }}).exec()
        .catch(error => {
            console.log('Save config error', error)
        })
    }

    dailyLoop() {
        // Calculate time next challenge for UTC 0h.
        const localOffset = (new Date).getTimezoneOffset() * 60 * 1000
        this.timeNextChallenge = new Date().setHours(24,0,0,0) - localOffset

        // In summer, in Portugal, timezone is UTC +1h.
        if(isDaylightSavingTime()) {
            this.timeNextChallenge -=  60 * 60 * 1000
        }

        setTimeout(() => {
            this.createNewChallenge()
            //this.removeEmptyUsers()
            this.dailyLoop()
        }, this.timeNextChallenge - Date.now())
    }

    playFinished(victory, easyMode, countAttempts) {
        const modeString = easyMode ? 'easy' : 'normal'

        ++this.counters.plays

        if(victory) {
            ++this.counters.victories
            ++this.counters.attemptsDistribution[modeString][countAttempts - 1].count
        }
        else {
            const indexLoss = easyMode ? gameSettings.maxAttemptsEasyMode : gameSettings.maxAttempts

            ++this.counters.attemptsDistribution[modeString][indexLoss].count
        }

        if(easyMode) {
            ++this.counters.easyMode
        }
    }

    registerUserFirstPlayCompleted() {
        ++this.counters.users
    }

    /* removeEmptyUsers() {
        // Delete users with no plays and with creation timestamp > 24 hours.
        models.User.deleteMany({
            createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000)},
            plays: { $exists: true, $size: 0 }
        }).exec()
    } */

    /* saveConfig() {
        if(!this.timeoutBetweenSaves) {
            this.timeoutBetweenSaves = setTimeout(() => {
                this.timeoutBetweenSaves = null

                console.log('Saving config')

                models.Config.updateOne({}, this.config).exec()
                .catch(error => {
                    console.log('Save config error', error)
                })
            }, 250)
        }
    } */

    // Static.

    static singleton() {
        if(!this.instance) {
            this.instance = new QuinaManager()
        }

        return this.instance
    }
}

module.exports = QuinaManager.singleton()