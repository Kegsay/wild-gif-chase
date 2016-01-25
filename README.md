# wild-gif-chase
Search through an existing GIF collection. Currently does prefix matching on
the filename of the GIF, and basic word matching based on `-` and `_` as separators.

## Requirements
 - ImageMagick for creating thumbnails of the GIFs.

## Install
```
$ npm install
```

## Setup
```
$ node index.js -s samples
```

## Running
```
$ node index.js -p 8000
// test it
$ curl -XGET "localhost:9000/search?q=cat"
```

## Coming features
 - Pure text file tag support in `.wgc/tags`

