var express = require("express");
var bodyParser = require("body-parser");
var morgan = require("morgan");
var compression = require("compression");

var Promise = require("bluebird");
var Datastore = require("nedb");
var fs = require("fs");
var nopt = require("nopt");
var path = require("path");
var gm = require("gm").subClass({ imageMagick: true });

var DB_PATH = "data/main.db";

var opts = nopt({
    "port": Number,
    "src": path,
    "help": Boolean
}, {
    "p": "--port",
    "s": "--src",
    "h": "--help"
});
var PORT = opts.port || 8000;
var LOAD_SRC = opts.src;
var HALP = opts.help || false;

if (HALP) {
    console.log("Usage: node index.js -p PORT -s path/to/gif/dir");
    return;
}
if (LOAD_SRC) {
    console.log("Removing database.");
    try { fs.unlinkSync(DB_PATH); } catch (e) {} // ignore; probably ENOENT
}

var template = {
    cache: {},
    vars: {
        "$NUM_GIF_FILES": 0
    },
    files: {
        "search.html": fs.readFileSync("templates/search.html", "utf8"),
        "results.html": fs.readFileSync("templates/results.html", "utf8"),
        "entry.html": fs.readFileSync("templates/entry.html", "utf8")
    }
}

function escapeRegExp(str) {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function replaceAll(str, find, replace) {
  return str.replace(new RegExp(escapeRegExp(find), 'g'), replace);
}

function fillTemplate(str, vars) {
    Object.keys(vars).forEach(function(v) {
        str = replaceAll(str, v, function(r) { return vars[v]; });
    });
    return str;
}

function invalidateTemplateCache() {
    template.cache = {};
    Object.keys(template.files).forEach(function(fname) {
        template.cache[fname] = (
            fillTemplate(template.files[fname], template.vars)
        );
    });
}

invalidateTemplateCache();

// WEB SERVER
// ============
var app = express();
app.use(compression());
app.use(bodyParser.json());
var accessLogStream = fs.createWriteStream(__dirname + '/data/access.log', {flags: 'a'})
app.use(morgan("combined", {stream: accessLogStream}));
app.get("/search", function(req, res) {
    var words = req.query.q ? req.query.q.toLowerCase().split(",") : [];
    words = words.map(function(w) { return w.trim(); }).filter(function(w) { return w && w.length > 0; });
    if (words.length === 0) {
        res.send(template.cache["search.html"]);
        return;
    }
    console.log("Words: %s", JSON.stringify(words));
    var gifs = findMatchingGifs(words).done(function(gifList) {
        console.log("Got gif list: %s", JSON.stringify(gifList));
        gifHtmlList = gifList.map(function(gif, index) {
            var gifSize = Math.floor(gif.bytes / 1024) + "KB";
            return fillTemplate(template.cache["entry.html"], {
                "$GIF_FILENAME": gif.filename,
                "$GIF_SIZE": gifSize,
                "$RESULT_NUMBER": index + 1
            });
        });

        res.send(fillTemplate(template.cache["results.html"], {
            "$WORDS": words,
            "$NUM_RESULTS": gifList.length,
            "$RESULTS": gifHtmlList.join("\n")
        }));
    }, function(err) {
        res.send("Error querying: %s", err);
    });
});
app.get("/files/:filename", function(req, res) {
    var fname = req.params.filename;
    if (!/^[a-zA-Z0-9\-_]+\.gif$/.test(fname)) {
        res.send("Bad gif file name");
        return;
    }
    findFile(fname).done(function(dbRes) {
        if (!dbRes) {
            res.send("Not found");
            return;
        }
        res.set("Cache-Control", "public, max-age=604800"); // 1 week 
        res.sendFile(dbRes.path);
    }, function(err) {
        res.send("Failed: " + err.message);
    });
});
app.get("/thumbs/:filename", function(req, res) {
    var fname = req.params.filename;
    if (!/^[a-zA-Z0-9\-_]+\.gif$/.test(fname)) {
        res.send("Bad gif thumb name");
        return;
    }
    findFile(fname, true).done(function(dbRes) {
        if (!dbRes) {
            res.send("Not found");
            return;
        }
        res.set("Cache-Control", "public, max-age=604800"); // 1 week 
        res.sendFile(dbRes.thumb);
    }, function(err) {
        res.send("Failed: " + err.message);
    });
});

if (!LOAD_SRC) {
    var server = app.listen(PORT, function() {
        console.log("Listening on port %s", PORT);
    });
}

// DATA STORE
// ==========
var db = new Datastore({
    filename: DB_PATH,
    autoload: true
});


db.count({}, function(err, count) {
    template.vars["$NUM_GIF_FILES"] = count;
    invalidateTemplateCache();
});

function findFile(filename) {
    var defer = Promise.defer();
    db.find({
        filename: filename
    }, function(err, docs) {
        if (err) {
            defer.reject(err);
            return;
        }
        defer.resolve(docs ? docs[0] : null);
    });
    return defer.promise;
}

function findMatchingGifs(words) {
    var defer = Promise.defer();
    var regex = words.map(function(w) { return "^" + escapeRegExp(w); }).join("|");
    db.find({
        words: {
            $regex: new RegExp(regex)
        }
    }, function(err, docs) {
        if (err) {
            defer.reject(err);
            return;
        }
        defer.resolve(docs);
    });
    return defer.promise;
}

// DATA DUMP
// =========
if (LOAD_SRC) {
    console.log("Loading gifs from: %s", LOAD_SRC);
    var WGC_DIR = path.join(LOAD_SRC, "/.wgc");
    var THUMBS_DIR = path.join(WGC_DIR, "/thumbs");
    var TAGS_DIR = path.join(WGC_DIR, "/tags");
    if (!fs.existsSync(WGC_DIR)) { fs.mkdirSync(WGC_DIR); }
    if (!fs.existsSync(THUMBS_DIR)) { fs.mkdirSync(THUMBS_DIR); }
    if (!fs.existsSync(TAGS_DIR)) { fs.mkdirSync(TAGS_DIR); }
    var files = fs.readdirSync(LOAD_SRC);
    files = files.filter(function(f) { return f.indexOf(".wgc") === -1; });

    var thumbGenQueue = {};
    var maxConcurrent = 20;
    function genThumb(gifPath, thumbPath) {
        // make a thumbnail
        thumbGenQueue[gifPath].processing = true;
        console.log("Generating thumbnail: %s", gifPath);
        gm(gifPath + "[0]").write(thumbPath, function(err) {
            delete thumbGenQueue[gifPath];
            if (!err) {
                console.log("Generated thumbnail: %s", gifPath);
            }
            else {
                console.error("Failed to generate thumbnail for %s : %s", gifPath, err);
            }
            checkGenThumbQueue();
        });
    }
    function queueThumb(gifPath, thumbPath) {
        thumbGenQueue[gifPath] = { thumb: thumbPath, processing: false };
    }
    function checkGenThumbQueue() {
        var queueKeys = Object.keys(thumbGenQueue);
        var numProcessing = queueKeys.filter(function(k) {
            return thumbGenQueue[k].processing;
        }).length;
        if (numProcessing >= maxConcurrent) { return; }
        var numToStart = maxConcurrent - numProcessing;
        var numStarted = 0;
        for (var i = 0; i < queueKeys.length; i++) {
            var entry = thumbGenQueue[queueKeys[i]];
            if (entry.processing) { continue; }
            genThumb(queueKeys[i], entry.thumb);
            numStarted += 1;
            if (numStarted >= numToStart) { break; }
        }
    }

    console.log("Found %s files. Processing...", files.length);
    db.insert(files.map(function(file) {
        var wordString = file.replace(".gif", "").toLowerCase();
        var words = wordString.split(/[-_]/g)
        var gifPath = path.join(LOAD_SRC, file);
        var thumbPath = path.join(THUMBS_DIR, file.replace(".gif", ".jpg"));
        var gifBytes = fs.statSync(gifPath).size;
        console.log("%s : %s bytes", file, gifBytes);
        // make a thumbnail
        queueThumb(gifPath, thumbPath);
        checkGenThumbQueue();

        return {
            filename: file,
            thumb: path.join(THUMBS_DIR, file.replace(".gif", ".jpg")),
            path: gifPath,
            bytes: gifBytes,
            words: words
        };
    }), function(err, docs) {
        if (err) {
            console.error(err);
        }
        else {
            console.log("Inserted %s files into database.", docs.length);
        }
    });
    fs.writeFileSync(path.join(TAGS_DIR, ".global"),
        "# You can create YAML files in this directory to add tags to your gifs. You can use this when searching.\n\n"+
        "# There are two types of files:\n" +
        "# LOCAL: A local file is named after the gif and consists of top-level key-value pairs.\n" +
        "#        // my-first-gif.yaml\n"+
        "#        type: Movie\n"+
        "#        film: Star Wars\n"+
        "#        person: Harrison Ford\n\n"+
        "# GLOBAL: You can only have 1 global file and it is called '.global'. It puts the gif name in the keys.\n" +
        "#       // .global\n"+
        "#       my-first-gif:\n"+
        "#           type: Movie\n"+
        "#           film: Star Wars\n\n"+
        "# All key names are valid. You can have some local files and a global file. Have fun!\n"
    );
}
