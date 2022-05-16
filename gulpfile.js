const concat = require('gulp-concat')
const cssMinify = require('gulp-css')
const gulp = require('gulp')
const less = require('gulp-less')
const path = require('path')
const shell = require('gulp-shell')
const uglify = require('gulp-uglify-es').default

const clientDir = 'src/client'
const buildDir = 'build/client'


// Compile Less, concatenate, minify and copy Css.

gulp.task('compile-copy-styles', () => {
    return gulp.src(clientDir + '/less/**/*.less')
    .pipe(less({
        paths: [ path.join(__dirname, 'less', 'includes') ]
    }))
	.pipe(concat('style.min.css'))
	.pipe(cssMinify())
	.pipe(gulp.dest(buildDir + '/css/'))
})


// Compile and bundle Marko files.

if (process.platform === 'win32') {
	gulp.task('compile-marko', shell.task('webpack.cmd --config webpack.config.js --env.production'))
} else {
	gulp.task('compile-marko', shell.task('./node_modules/.bin/webpack --config webpack.config.js --env.production'))
}


// Uglify and copy Js

gulp.task('copy-js', () => {
	return gulp.src(clientDir + '/js/*.js')
	//.pipe(concat('scripts.min.js'))
	.pipe(uglify())
	.pipe(gulp.dest(buildDir + '/js/'))
})


// Uglify and copy Locales

gulp.task('copy-locales', () => {
	return gulp.src(clientDir + '/locales/*.js')
	//.pipe(concat('scripts.min.js'))
	.pipe(uglify())
	.pipe(gulp.dest(buildDir + '/locales/'))
})


// Copy Assets.

gulp.task('copy-assets', () => {
	return gulp.src(clientDir + '/assets/**/*')
	.pipe(gulp.dest(buildDir + '/assets/'))
})


// Execute compile tasks.

gulp.task('compile', gulp.parallel('compile-marko'))


// Execute copy tasks.

gulp.task('copy', gulp.parallel('compile-copy-styles', 'copy-js', 'copy-locales', 'copy-assets'))


// Compile webapp to /build.

gulp.task('build', gulp.series('compile', 'copy'))
