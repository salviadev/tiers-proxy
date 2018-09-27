var path = require('path');
var gulp = require('gulp');
var del = require('del');
var ts = require('gulp-typescript');
let tslint = require('gulp-tslint');



gulp.task('clean', () => {
    return del([
        'definitions/',
        'test/',
        'lib/',
        './test/**/*.js',
        './src/**/*.js',
        './src/**/*.d.ts',
        './index.js'
    ]);

});


gulp.task('ts', ['tslint'], () => {
    let tsProject = ts.createProject(path.resolve('./tsconfig.json'));
    let tsResult = gulp.src(['./src/**/*.ts', '!./src/test/**']).pipe(tsProject());
    tsResult.js.pipe(gulp.dest(path.resolve('./')));
});

gulp.task('tslint', ['clean'], () => {
    return gulp.src("src/**/*.ts")
        .pipe(tslint({
            formatter: "verbose"
        }))
        .pipe(tslint.report())
});


gulp.task('test', ['ts'], function () {
    var tsProject = ts.createProject(path.resolve('./tsconfig.json'));
    var tsResult = gulp.src(['./src/test/**']).pipe(tsProject());
    tsResult.js.pipe(gulp.dest(path.resolve('./test')))
});

gulp.task('build', ['test']);
gulp.task('default', ['build']);