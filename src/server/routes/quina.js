const config = require('~/../config')
const quinam = require('@server/quina-manager')
const template = require('@client/components/root/index.marko')
const { authRequired, processAnalytics } = require('@server/utils')
const { gameSettings } = require('@client/js/quina-vars')
const { models } = require('mongoose')

module.exports = function(router) {
    router.route('/jogos/quina')
	.get(async(req, res) => {
        let data = {}

        if(req.user) {
            user = await models.User.findOne({ _id: req.user._id }).populate('games.quina.plays')

            const counters = quinam.getCounters()
            const dataUser = user.games.quina
            const timeNextChallenge = quinam.getTimeNextChallenge()
            const lastNumberChallenge = quinam.getChallenge().number

            data = {
                counters, dataUser, lastNumberChallenge, timeNextChallenge
            }
        }

        if(req.xhr || req.headers.accept.indexOf('json') > -1) {
            res.json({ code: 0 , ...data })
        }
        else {
            this.render(template, { page: 'games', pane: 'quina', data})
        }
	})

    router.route('/jogos/quina/desafio')
    .get(authRequired, async(req, res) => {
        const numberChallenge = req.params.number

        play = await models.Play.findOne({ numberChallenge, user: req.user._id })

        res.json({ code: 0, play })
    })

	router.route('/jogos/quina/tentativa')
	.post(authRequired, async(req, res) => {
        const word = String(req.body.word) || ''
        let numberChallenge = req.body.numberChallenge || -1
        const user = await models.User.findOne({ _id: req.user._id })

        if(!user) {
            return res.json({ code: -1 })
        }

        if(word.length < 5) {
            return res.json({ code: 1 })
        }

        if(!quinam.isValidWord(word)) {
            processAnalytics(req, 'event', {
                eventCategory: 'quina',
                eventAction: 'attemptInvalid',
                eventLabel: `${numberChallenge}-${word}`
            })

            return res.json({ code: 1 })
        }

        const challenge = quinam.getChallenge(numberChallenge)

        if(!challenge) {
            return res.json({ code: -2 })
        }

        let play = await models.QuinaPlay.findOne({ numberChallenge: challenge.number, user: user._id })

        if(!play) {
            play = await models.QuinaPlay.create({
                easyMode: user.preferences.games.quina.easyMode,
                numberChallenge: challenge.number,
                user: user._id
            })

            user.games.quina.plays.push(play._id)
            user.save()
        }

        if(play.completed) {
            return res.json({ code: 2 })
        }

        let pinsRight = 0
        let pinsWrong = 0
        const countAttempt = play.attempts.length + 1
        const maxAttempts = play.easyMode ? gameSettings.maxAttemptsEasyMode : gameSettings.maxAttempts

        let answer = quinam.getWordNormalized(challenge.answer)
        const lettersRight = []
        const lettersWrong = []

        // Check letter match at the exact tile.
        for(let i = 0; i < 5; ++i) {
            const letter = word.charAt(i)

            if(answer.charAt(i) == letter) {
                ++pinsRight
                lettersRight.push(i)

                answer = answer.substr(0, i) + ' ' + answer.substr(i + 1)
            }
        }

        // Check letter match wrong tile.
        for(let i = 0; i < 5; ++i) {
            if(lettersRight.includes(i)) {
                continue
            }

            const letter = word.charAt(i)
            const index = answer.indexOf(letter)

            if(index >= 0) {
                ++pinsWrong
                lettersWrong.push(i)

                answer = answer.substr(0, index) + ' ' + answer.substr(index + 1)
            }
        }

        const wordDiactritics = pinsRight == 5 ? challenge.answer : quinam.getWordDiacritics(word)
        const dataPlay = { word: wordDiactritics, pinsRight, pinsWrong }

        if(play.easyMode) {
            dataPlay.lettersRight = lettersRight
            dataPlay.lettersWrong = lettersWrong
        }

        play.attempts.push(dataPlay)

        if(pinsRight == 5) {
            play.completed = true
            play.victory = true
            play.answer = challenge.answer

            ++user.games.quina.streakCurrent

            if(user.games.quina.streakCurrent > user.games.quina.streakBest) {
                user.games.quina.streakBest = user.games.quina.streakCurrent
            }

            quinam.playFinished(play.victory, play.easyMode, play.attempts.length)

            // FIXME what if I started another play? We should count the number of user completed plays.
            if(user.games.quina.plays.length == 1) {
                quinam.registerUserFirstPlayCompleted()
            }

            user.save()

            processAnalytics(req, 'event', {
                eventCategory: 'quina',
                eventAction: 'attemptVictory',
                eventLabel: `${numberChallenge}-${play.attempts.length}-${play.easyMode}`
            })
        }
        else if(countAttempt >= maxAttempts) {
            play.completed = true
            play.answer = challenge.answer
            user.games.quina.streakCurrent = 0

            quinam.playFinished(play.victory, play.easyMode, play.attempts.length)

            if(user.games.quina.plays.length == 1) {
                quinam.registerUserFirstPlayCompleted()
            }

            user.save()

            processAnalytics(req, 'event', {
                eventCategory: 'quina',
                eventAction: 'attemptLoss',
                eventLabel: `${numberChallenge}-${play.attempts.length}-${play.easyMode}`
            })
        }
        else {
            processAnalytics(req, 'event', {
                eventCategory: 'quina',
                eventAction: 'attemptSubmit',
                eventLabel: `${numberChallenge}-${play.attempts.length}-${play.easyMode}-${word}`
            })
        }

        if(play.completed && !play.easyMode) {
            for(const attempt of play.attempts) {
                answer = quinam.getWordNormalized(play.answer)
                const wordAttempt = quinam.getWordNormalized(attempt.word)
                const lettersRight = []
                const lettersWrong = []

                // Check letter match at the exact tile.
                for(let i = 0; i < 5; ++i) {
                    const letter = wordAttempt.charAt(i)

                    if(answer.charAt(i) == letter) {
                        lettersRight.push(i)

                        answer = answer.substr(0, i) + ' ' + answer.substr(i + 1)
                    }
                }

                // Check letter match wrong tile.
                for(let i = 0; i < 5; ++i) {
                    if(lettersRight.includes(i)) {
                        continue
                    }

                    const letter = wordAttempt.charAt(i)
                    const index = answer.indexOf(letter)

                    if(index >= 0) {
                        lettersWrong.push(i)

                        answer = answer.substr(0, index) + ' ' + answer.substr(index + 1)
                    }
                }

                attempt.lettersRight = lettersRight
                attempt.lettersWrong = lettersWrong
            }
        }

        play = await play.save()

        res.json({ code: 0, play: play.toJSON() })
	})

    /* // TODO TODO remove
    router.route('/words')
    .get((req, res) => {
        res.json({ code: 0, words: serverm.getWords() })
    })

    router.route('/pushwords')
	.post((req, res) => {
        const words = req.body.words || []

        serverm.pushWords(words)

        res.json({ code: 0 })
	}) */

    router.route('/jogos/quina/sync')
	.post(authRequired, async(req, res) => {
        const idUser = req.body.id
        let user = await models.User.findOne({ _id: req.user._id, status: 'active' })

        if(!user) {
            return res.json({ code: -1 })
        }

        const userOld = await models.QuinaOldUser.findOne({ _id: idUser })

        if(!userOld) {
            return res.json({ code: -2 })
        }

        const daltonicMode = userOld.daltonicMode
        const easyMode = userOld.easyMode

        const playsOld = await models.QuinaOldPlay.find({ user: idUser })

        // Remove all plays in user.
        await models.QuinaPlay.deleteMany({ _id: { $in: user.games.quina.plays }})

        user.games.quina.plays = []

        const plays = []

        // Create all plays from old plays.
        for(const playOld of playsOld) {
            const quinaPlay = await models.QuinaPlay.create({
                answer: playOld.answer,
                completed: playOld.completed,
                easyMode: playOld.easyMode,
                numberChallenge: playOld.numberChallenge,
                user: user._id,
                victory: playOld.victory,
                attempts: playOld.attempts
            })

            quinaPlay.createdAt = playOld.createdAt
            quinaPlay.updatedAt = playOld.updatedAt

            plays.push(quinaPlay)

            await quinaPlay.save({ timestamps: false })

            user.games.quina.plays.push(quinaPlay._id)
        }

        user.games.quina.streakCurrent = userOld.streakCurrent
        user.games.quina.streakBest = userOld.streakBest
        user.games.quina.synced = true

        user.preferences.games.quina = {
            daltonicMode,
            easyMode
        }

        user = await user.save()

        const dataUser = { ...user.games.quina, plays }

        user = await user
            .populate('usersBlocked', 'image username')
            .execPopulate()

        req.logIn(user.toJSON(true), (error) => {
            req.session.cookie.maxAge = config.cookies.maxAge
        })

        res.json({ code: 0, dataUser, daltonicMode, easyMode })

        processAnalytics(req, 'event', {
            eventCategory: 'quina',
            eventAction: 'sync',
            eventLabel: 'success'
        })
	})

    router.route('/jogos/quina/reset')
	.post(authRequired, async(req, res) => {
        const user = await models.User.findOne({ _id: req.user._id, status: 'active' })
            .populate('quina.games.quina.plays')

        if(!user) {
            return res.json({ code: -1 })
        }

        quinam.accountCleared(user.games.quina.plays)

        const idsPlays = user.games.quina.plays.map(play => play._id)

        // Remove all plays in user.
        await models.QuinaPlay.deleteMany({ _id: { $in: idsPlays }})

        user.games.quina.plays = []
        user.games.quina.streakCurrent = 0
        user.games.quina.streakBest = 0

        user.save()

        processAnalytics(req, 'event', {
            eventCategory: 'quina',
            eventAction: 'reset',
            eventLabel: 'success'
        })

        return res.json({ code: 0 })
	})
}
