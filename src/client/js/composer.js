const { textToPathUrl } = require('js/utils')
const { urls } = require('js/default-vars')

function pageFromUrl(path, appm) {
    const paths = path.split('/')

    paths.splice(0, 1)

    if(paths.length) {
        switch(paths[0]) {
            // Channels
            case '':
            case 'canais':
                return { idPage: 'channels' }
            case 'explorar':
                return { idPage: 'channels', idPane: 'explore' }
            case 'c':
                if(paths.length > 1) {
                    let idChannel = paths[1]

                    if(paths.length > 2) {
                        if(paths[2] == 'p') {
                            // Is it a post or a comment?
                            if(paths.length == 4 || paths.length == 5) {
                                const idPost = paths[3]
                                const postObj = { id: idPost, channel: { id: idChannel }}

                                // Is it a comment?
                                if(paths.length == 5) {
                                    const idComment = paths[4]

                                    return {
                                        idPage: 'channels',
                                        idPane: 'post',
                                        args: [postObj, idComment]
                                    }
                                }

                                return {
                                    idPage: 'channels',
                                    idPane: 'post',
                                    args: [postObj]
                                }
                            }
                        }

                        break
                    }

                    if(['todos', 'moderados', 'populares', 'favoritos'].includes(idChannel)) {
                        idChannel = idChannel.replace('todos', 'all')
                        idChannel = idChannel.replace('moderados', 'mod')
                        idChannel = idChannel.replace('populares', 'popular')
                        idChannel = idChannel.replace('favoritos', 'favorites')

                        return { idPage: 'channels', idPane: 'channels', args: [idChannel] }
                    }

                    let idPane = 'channel'

                    if(idChannel == 'sobre') {
                        idPane = 'channelAbout'
                    }
                    else if(idChannel == 'configuracoes') {
                        idPane = 'channelSettings'
                    }
                    else if(idChannel == 'moderacao') {
                        idPane = 'channelMod'
                    }

                    return { idPage: 'channels', idPane, args: [{ id: idChannel }] }
                }

            // Profiles.
            case 'u':
                if(paths.length > 1) {
                    const username = paths[1]

                    return { idPage: 'channels', idPane: 'user', args: [{ username: username }] }
                }
            // Messages.
            case 'conversas':
                if(paths.length > 1) {
                    let idChat = paths[1]

                    return { idPage: 'chats', idPane: 'chat', args: [{ id: idChat }]}
                }

                return { idPage: 'chats' }
            case 'notificacoes':
                return { idPage: 'notifications' }
            case 'conta':
                return { idPage: 'settings' }
            case 'sobre':
                return { idPage: 'about', idPane: 'about', back: true }
            case 'termos':
                return { idPage: 'about', idPane: 'terms', back: true }
            case 'privacidade':
                return { idPage: 'about', idPane: 'privacy', back: true }
            case 'transparencia':
                return { idPage: 'about', idPane: 'transparency', back: true }
            case 'noticias':
                if(paths.length > 1) {
                    let id = paths[1]

                    if(id == 'categorias') {
                        return { idPage: 'news', idPane: 'categories' }
                    }

                    const categories = appm.getNewsCategories()
                    const sources = appm.getNewsSources()

                    for(const source of sources) {
                        if(source.id == id) {
                            return { idPage: 'news', idPane: 'source', args: [source]}
                        }
                    }

                    for(const category of categories) {
                        if(category.id == id) {
                            return { idPage: 'news', idPane: 'category', args: [category]}
                        }
                    }

                    return { idPage: 'news', idPane: ''}
                }

                return { idPage: 'news' }
            case 'jogos':
                if(paths.length > 1) {
                    let id = paths[1]

                    if(['quina'].includes(id)) {
                        return { idPage: 'games', idPane: id}
                    }
                }

                return { idPage: 'games' }
            case 'chatdatreta':
                return { idPage: 'randomChat' }
        }

        return null
    }

    return { idPage: 'channels' }
}

function metadataFromPage(idPage, idPane, args = [], appm) {
    const trPage = appm.tr(`${idPage}`) || {}

    if(idPage == 'about') {
        const trPane = idPane ? trPage[idPane] || {} : ''

        return { path: `/${trPane.id || ''}`, title: trPane.title }
    }
    else if(idPage == 'channels') {
        switch(idPane) {
            case 'explore': {
                const trPane = trPage[idPane] || {}

                return { path: `/${trPane.id || ''}`, title: trPane.title }
            }
            case 'channels': {
                const channelsDefault = appm.isUserSignedIn() ? 'sub' : 'popular'
                const idChannels = args[0]

                if(idChannels == channelsDefault || !idChannels) {
                    return { path: `/${trPage.id || ''}`, title: trPage.title }
                }

                const title = trPage.aggregators ? trPage.aggregators[idChannels] : ''
                const idUrl = textToPathUrl(title)

                return { path: `/c/${idUrl}`, title: title }
            }
            case 'post': {
                const post = args[0] || {}
                const channel = post.channel || {}
                const metadata = {
                    description: channel.description,
                    path: `/c/${channel.id}/p/${post.id}`,
                    title: post.title
                }

                if((post.type == 'image' || post.type == 'link') && post.images) {
                    metadata.image = `${appm.getUrlCdn()}/${post.images[0]}.jpg`
                }
                else if(channel.image) {
                    metadata.image = `${appm.getUrlCdn()}/${channel.image}.jpg`
                }

                return metadata
            }
            case 'comment': {
                const post = args[0] || {}
                const channel = post.channel || {}
                const idComment = args[1] || post.idCommentHighlight
                const metadata = {
                    path: `/c/${channel.id}/p/${post.id}/${idComment}`,
                    title: post.title
                }

                if((post.type == 'image' || post.type == 'link') && post.images) {
                    metadata.image = `${appm.getUrlCdn()}/${post.images[0]}.jpg`
                }
                else if(channel.image) {
                    metadata.image = `${appm.getUrlCdn()}/${channel.image}.jpg`
                }

                return metadata
            }
            case 'user': {
                const user = args[0]

                const metadata = {
                    description: user.bio,
                    path: `/u/${user.username}`,
                    title: user.username
                }

                if(user.image) {
                    metadata.image = `${appm.getUrlCdn()}/${user.image}.jpg`
                }

                return metadata
            }
        }

        if(idPane && idPane.startsWith('channel') && idPane != 'channels') {
            const channel = args[0]
            let urlSub

            if(idPane == 'channelAbout') {
                urlSub = 'sobre'
            }
            else if(idPane == 'channelMod') {
                urlSub = 'moderacao'
            }
            else if(idPane == 'channelSettings') {
                urlSub = 'configuracoes'
            }

            const metadata = {
                description: channel.description,
                path: `/c/${channel.id}${urlSub ? `/${urlSub}` : ''}`,
                title: channel.name || channel.id
            }

            if(channel.image) {
                metadata.image = `${appm.getUrlCdn()}/${channel.image}.jpg`
            }

            return metadata
        }
    }
    else if(idPage == 'chats') {
        switch(idPane) {
            case 'chat':
                const chat = args[0]

                let userPair = {}

                if(appm.isUserSignedIn() && chat.users) {
                    for(const user of chat.users) {
                        if(user.username != appm.getUser().username) {
                            userPair = user
                        }
                    }
                }

                return {
                    path: `/${trPage.id || ''}/${chat.id}`,
                    title: userPair.username || trPage.title
                }
        }
    }
    else if(idPage == 'news') {
        const metadata = {
            description: trPage.description,
            image: `${urls.domain}/assets/images/og-image-news.jpg`,
            path: `/${trPage.id || ''}`,
            title: trPage.title
        }

        switch(idPane) {
            case 'source':
            case 'category': {
                const item = args[0] || {}

                metadata.path = `/${trPage.id || ''}/${item.id}`
                metadata.title = `${item.name || item.id} - ${metadata.title}`

                if(idPane == 'source' && item.image) {
                    metadata.image = `${appm.getUrlCdn()}/${item.image}.jpg`
                }

                break
            }
            case 'categories': {
                const trCategories = appm.tr('news.categories') || ''

                metadata.path = `/${trPage.id || ''}/${trCategories.toLowerCase()}`,
                metadata.title = `${trCategories} - ${metadata.title}`
                break
            }
        }

        return metadata
    }
    else if(idPage == 'games') {
        const trPane = idPane ? trPage[idPane] || {} : ''

        switch(idPane) {
            case 'quina':
                return {
                    description: trPane.description,
                    image: '/assets/images/og-image-quina.jpg',
                    path: `/${trPage.id || ''}/${trPane.id || ''}`,
                    title: trPane.title
                }
        }
    }
    else if(idPage == 'randomChat') {
        return {
            description: trPage.description,
            image: '/assets/images/og-image-chatdatreta.jpg',
            path: `/${trPage.id || ''}`,
            title: trPage.title
        }
    }

    return { path: `/${trPage.id || ''}`, title: trPage.title }
}

exports.pageFromUrl = pageFromUrl
exports.metadataFromPage = metadataFromPage