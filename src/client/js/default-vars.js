module.exports = {
    archivePostOptions: ['none', 'week', 'month', 'halfYear', 'year'],
    flags: {
        comments: ['ruleBreaker', 'spam', 'personalInfo', 'hate', 'misinformation', 'other'],
        posts: ['ruleBreaker', 'spam', 'personalInfo', 'hate', 'misinformation', 'other'],
        users: ['spam', 'harassment', 'violence', 'other']
    },
    channelTypes: [{
            id: 'public',
            icon: 'eye'
        }, {
            id: 'restricted',
            icon: 'eyePeek'
        }, {
            id: 'private',
            icon: 'lock'
    }],
    commentsSettings: {
        collapseIfDepthAbove: 5,
        collapseIfVotesBelow: 0,
        threadLimit: 8,
        threadLimitMobile: 4
    },
	defaultLanguage: 'pt',
    imageSizeLimitMb: 5,
	languages: [{
		code: 'pt',
		name: 'Português'
	}],
    maxChannelAdmins: 6,
    maxChannelMods: 20,
    maxChannelSubscriptions: 100,
    maxImages: 12,
    maxOptionsPoll: 10,
    maxRules: 12,
    maxTags: 15,
    maxTriggersAutoMod: 10,
    modActionOptions: ['queue', 'publish', 'approve', 'reject'],
    modTriggerTypes: ['words', 'links', 'karma', 'age'],
    modTriggerDataTypes: [{
        id: 'all',
        icon: 'atom'
    }, {
        id: 'posts',
        icon: 'post'
    }, {
        id: 'comments',
        icon: 'comment'
    }],
    optionsHtmlSanitize: {
        allowedClasses: {
            'span': ['bold', 'quotation', 'spoiler']
        },
        allowedSchemes: ['http', 'https'],
        allowedTags: [
            'span', 'a', 'b', 'strong', 'i', 'strike', 'br', 'ul', 'ol', 'li', 'code', 'p', 'div'
        ],
        transformTags: {
            'span': (tagName, attribs) => {
                // Always open links in a new window.
                if(attribs && ['bold', 'quotation', 'spoiler'].includes(attribs.class)) {
                    return { tagName, attribs }
                }
                else {
                    return {}
                }
            },
            'a': (tagName, attribs) => {
                // Always open links in a new window.
                if(attribs) {
                    attribs.target = '_blank'
                    attribs.rel = 'noopener noreferrer'
                }

                return { tagName, attribs }
            },
            'b': (tagName, attribs) => {
                return {
                    tagName: 'span',
                    attribs: {
                        class: 'bold'
                    }
                }
            },
            'strong': (tagName, attribs) => {
                return {
                    tagName: 'span',
                    attribs: {
                        class: 'bold'
                    }
                }
            },
            'p': (tagName, attribs) => {
                return {
                    tagName: 'br'
                }
            },
            'div': (tagName, attribs) => {
                return {
                    tagName: 'br'
                }
            }
        }
    },
    postTypes: [{
        id: 'text',
        icon: 'details'
    }, {
        id: 'link',
        icon: 'link'
    }, {
        id: 'image',
        icon: 'image'
    }, {
        id: 'poll',
        icon: 'poll'
    }],
    themes: {
        dark: {
            accent1: '#ffd326',
            background1: '#000000',
            background2: '#0d0d0d',
            background3: '#222222',
            background4: '#1a1a1a',
            border1: '#2f2f2f',
            border2: '#444444',
            border3: '#969696',
            border4: '#1c1c1c',
            button1: '#202020',
            button2: '#3d3d3d',
            chat1: '#141414',
            chat2: '#3d3d3d',
            icon1: '#969696',
            icon2: '#c4c4c4',
            icon3: '#dddddd',
            icon4: '#ebebeb',
            icon5: '#ffffff',
            input1: '#181818',
            input2: '#202020',
            link: '#34affa',
            tags: {
                '1': '#48c8ff',
                '2': '#ff7511',
                '3': '#ffd326',
                '4': '#23f490',
                '5': '#f652f0',
                '6': '#ff93ba',
                '7': '#3686ff',
                '8': '#cbcbcb',
                '9': '#fd4c57',
                '10': '#ba63ff'
            },
            text1: '#969696',
            text2: '#c4c4c4',
            text3: '#dddddd',
            text4: '#ebebeb',
            text5: '#ffffff',
            votedown: '#ff4b56',
            voteup: '#67ffb6',
            warning: '#ff4b56'
        },
        light: {
            accent1: '#ffa800',
            background1: '#f6f6f6',
            background2: '#fdfdfd',
            background3: '#eeeeee',//'#f7f7f7',
            background4: '#f0f0f0',
            border1: '#cecece',
            border2: '#b9b9b9',
            border3: '#666666',
            border4: '#e6e6e6',
            button1: '#e6e6e6',
            button2: '#dfdfdf',
            chat1: '#dfdfdf',
            chat2: '#fdfdfd',
            icon1: '#666666',
            icon2: '#4c4c4c',
            icon3: '#3c3c3c',
            icon4: '#2b2b2b',
            icon5: '#1b1b1b',
            input1: '#f9f9f9',
            input2: '#ffffff',
            link: '#009bfa',
            tags: {
                '1': '#48c8ff',
                '2': '#ff7511',
                '3': '#ffd326',
                '4': '#23f490',
                '5': '#f652f0',
                '6': '#ff93ba',
                '7': '#3686ff',
                '8': '#cbcbcb',
                '9': '#fd4c57',
                '10': '#ba63ff'
            },
            text1: '#5c5c5c',
            text2: '#4c4c4c',
            text3: '#3c3c3c',
            text4: '#2b2b2b',
            text5: '#1b1b1b',
            votedown: '#f83c3f',
            voteup: '#22da82',
            warning: '#f83c3f'
        }
    },
    timers: {
        betweenFetches: 250,
        delaySendAnalytics: 5000,
        delayShowTooltip: 10,
		durationNotifications: 3 * 1000,
        imageReload: 5 * 1000,
		timeoutRequests: 20 * 1000
	},
    urls: {
        cdn: 'https://talcanal.ams3.cdn.digitaloceanspaces.com',
        domain: 'https://talcanal.pt',
        favicons: 'https://s2.googleusercontent.com/s2/favicons?sz=32&domain=',
        iconica: 'https://iconica.pt',
        social: {
            email: 'geral@iconica.pt',
            instagram: 'https://instagram.com/iconicadigitaldesign',
            twitter: 'https://twitter.com/iconicadigital',
            website: 'https://iconica.pt'
        }
    },
    viewModes: [{
        id: 'expanded',
        icon: 'cards'
    }, {
        id: 'list',
        icon: 'list'
    }/*, {
        id: 'grid',
        icon: 'grid'
    }*/]
}
