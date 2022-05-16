const config = require('../../config')
const mongoose = require('mongoose')
const { MongoClient } = require('mongodb')

const ConfigTalCanal = require('../server/models/config')
const QuinaOldPlay = require('../server/models/games/quina-old-play')
const QuinaOldUser = require('../server/models/games/quina-old-user')

const uriDbBase = `mongodb://${config.db.username}:${config.db.password}@${config.db.host}:${config.db.port}`
const optionsMongoose = {
    useCreateIndex: true,
    useFindAndModify: false,
    useNewUrlParser: true,
    useUnifiedTopology: true
}

async function go() {
    mongoose.Promise = global.Promise

    const client = await MongoClient.connect(`${uriDbBase}/quina`)
    const db = client.db('quina')

    const configQuina = await db.collection('config').findOne()
    const plays = await db.collection('plays').find().toArray()
    const users = await db.collection('users').find().toArray()
    const challenges = configQuina.challenges

    console.log('Challenges:', challenges.length, 'Plays:', plays.length)

    await client.close()

    await mongoose.connect(`${uriDbBase}/${config.db.name}`, optionsMongoose)

    for(const play of plays) {
        const quinaPlay = await QuinaOldPlay.create({
            answer: play.answer,
            completed: play.completed,
            easyMode: play.easyMode,
            numberChallenge: play.numberChallenge,
            user: String(play.user),
            victory: play.victory,
            attempts: play.attempts
        })

        quinaPlay.createdAt = play.createdAt
        quinaPlay.updatedAt = play.updatedAt

        await quinaPlay.save({ timestamps: false })
    }

    for(const user of users) {
        await QuinaOldUser.create({
            _id: user._id,
            daltonicMode: user.preferences.daltonicMode,
            easyMode: user.preferences.easyMode,
            streakCurrent: user.streakCurrent,
            streakBest: user.streakBest
        })
    }

    const configTalCanal = await ConfigTalCanal.findOneAndUpdate({}, {},
        { new: true, setDefaultsOnInsert: true, upsert: true }).exec()

    for(const challenge of challenges) {
        configTalCanal.games.quina.challenges.push(challenge)
    }

    await configTalCanal.save()

    await mongoose.disconnect()

    console.log('Done')

    process.exit()
}

go()