const randToken = require('rand-token').generator({ chars: 'a-z' })
const serverm = require('@server/server-manager')
const { sizesMedia } = require('@server/default-vars')
const { authRequired, deleteFromSpaces, resizeImage, processAnalytics, sendToSpaces } = require('@server/utils')

module.exports = function(router, upload) {
    router.route('/images')
 	.post(authRequired, upload.array('media', 12), async(req, res) => {
        const files = req.files
        const size = req.body.size
        const ids = []

        if(!sizesMedia[size]) {
            return res.json({ code: 1 })
        }

        const sizes = sizesMedia[size]

        for(const file of files) {
            const buffer = file.buffer
            const id = randToken.generate(10)

            try {
                await Promise.all(sizes.map(async(size) => {
                    const nameFile = `${id}${size.tag ? '-' + size.tag : ''}.jpg`

                    const bufferResized = await resizeImage(buffer, size)
                    await sendToSpaces(nameFile, bufferResized)
                }))
            }
            catch(error) {
                const nameFiles = []

                for(const idToDelete of ids) {
                    sizes.map((size) => {
                        nameFiles.push(`${idToDelete}${size.tag ? '-' + size.tag : ''}.jpg`)
                    })
                }

                deleteFromSpaces(nameFiles)

                return res.json({ code: -1 })
            }

            ids.push(id)
        }

        serverm.mediaUploaded(ids, size)

        res.json({ code: 0, ids })
        processAnalytics(req, 'event', {
            eventCategory: 'media',
            eventAction: 'upload',
            eventLabel: `${size}-${ids.length}`
        })
 	})
}
