const path = require('path')
const nodeExternals = require('webpack-node-externals')
const webpack = require('webpack')
const CSSExtractPlugin = require('mini-css-extract-plugin')
const IgnoreEmitPlugin = require('ignore-emit-webpack-plugin')
const MarkoPlugin = require('@marko/webpack/plugin').default
const SpawnServerPlugin = require('spawn-server-webpack-plugin')

const markoPlugin = new MarkoPlugin()
const spawnedServer = new SpawnServerPlugin({ args: ['--inspect'] })

module.exports = env => {
    const baseConfig = {
        devtool: env.production ? '' : 'source-map',
        mode: env.production ? 'production' : 'development',
        module: {
            rules: [
                {
                    test: /\.marko$/,
                    loader: '@marko/webpack/loader',
                    //use: ['cache-loader', '@marko/webpack/loader']
                },
                {
                    test: /\.(less|css)$/,
                    use: [
                        CSSExtractPlugin.loader,
                        'css-loader',
                        {
    						loader: 'less-loader',
    						options: {
    							javascriptEnabled: true
    						}
    					},
    					{
    						loader: 'style-resources-loader',
    						options: {
    						    patterns: [
                                    //path.resolve(__dirname, 'src/client/less/fonts.less'),
    						        path.resolve(__dirname, 'src/client/less/theme.less'),
    								path.resolve(__dirname, 'src/client/less/utils.less')
    						    ]
    						}
    					}
                    ]
                },
                {
                    test: /\.svg$/,
                    loader: 'svg-inline-loader?idPrefix=[sha512:hash:hex:5]-'
                }
            ]
        },
        output: {
            publicPath: '/'
        },
        resolve: {
            alias:{
    			'~': path.resolve(__dirname, 'src'),
                '@client': path.resolve(__dirname, 'src/client'),
                '@server': path.resolve(__dirname, 'src/server')
    		},
            extensions: ['.js', '.marko'],
            modules: [
                //path.resolve(__dirname, '/'),
                path.resolve(__dirname, 'src/client'),
                './node_modules'
            ]
        },
        stats: 'minimal'
    }

    const serverConfig = {
        ...baseConfig,
        entry: './src/server/index.js',
        externals: [nodeExternals()],
        name: 'Server',
        optimization: {
            minimize: false
        },
        output: {
            ...baseConfig.output,
            filename: 'main.js',
            libraryTarget: 'commonjs2',
            path: path.join(__dirname, 'build/server')
        },
        plugins: [
            new webpack.DefinePlugin({
                'process.browser': undefined,
                'process.env.BUNDLE': true
            }),
            new webpack.BannerPlugin({
                banner: 'require("source-map-support").install();',
                raw: true
            }),
            /*new CSSExtractPlugin({
                filename: '[name].[contenthash:8].css'
            }),*/
            new IgnoreEmitPlugin(/\.(css(\.map)?|jpg|jpeg|gif|png)$/),
            markoPlugin.server
        ],
        target: 'async-node'
    }

    const browserConfig = {
        ...baseConfig,
        name: 'Browser',
        output: {
            ...baseConfig.output,
            filename: '[name].[contenthash:8].js',
            path: path.join(__dirname, 'build/client')
        },
        plugins: [
            new webpack.DefinePlugin({
                'process.browser': true,
                COMPONENTS_DIR: JSON.stringify('~/client/components')
            }),
            new CSSExtractPlugin({
                filename: '[name].[contenthash:8].css'
            }),
            markoPlugin.browser
        ],
        target: 'web'
    }

    if(env.production) {
        const OptimizeCssAssetsPlugin = require('optimize-css-assets-webpack-plugin')
        const CleanPlugin = require('clean-webpack-plugin')

        browserConfig.plugins.push(new OptimizeCssAssetsPlugin(), new CleanPlugin())
        browserConfig.optimization = {
            minimize: true,
            splitChunks: {
                chunks: 'all',
                maxInitialRequests: 3
            }
        }

        serverConfig.plugins.push(new CleanPlugin())
    }
    else {
        serverConfig.plugins.push(spawnedServer)
        browserConfig.performance = {
            hints: false
        }

        browserConfig.devServer = {
            ...spawnedServer.devServerConfig,
            contentBase: false,
            host: '0.0.0.0',
            overlay: true,
            stats: 'minimal',
        }
    }

    return [browserConfig, serverConfig]
}
