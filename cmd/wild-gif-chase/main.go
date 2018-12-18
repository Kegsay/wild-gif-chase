package main

import (
	"flag"
	"fmt"
	"image/gif"
	"image/jpeg"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
)

var (
	portFlag = flag.Int("port", 0, "Port to listen on")
	srcFlag  = flag.String("src", "", "Source GIF directory")
)

var filenameRegexp = regexp.MustCompile(`^[a-zA-Z0-9\-_]+\.gif$`)
var wordSplitRegexp = regexp.MustCompile(`[-_]`)

var (
	entryHTML   = ""
	resultsHTML = ""
	searchHTML  = ""
)

var (
	VarGIFFilename  = "$GIF_FILENAME"
	VarGIFSize      = "$GIF_SIZE"
	VarResultNumber = "$RESULT_NUMBER"
	VarNumResults   = "$NUM_RESULTS"
	VarWords        = "$WORDS"
	VarTotalGIFs    = "$NUM_GIF_FILES"
	VarResults      = "$RESULTS"
)

var (
	index     = make(map[string][]string) // word => filenames
	indexSize = 0
)

// GET /search?q=cat,dog,mouse
func handleSearch(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	w.WriteHeader(200)
	q := req.URL.Query()
	qs := strings.Split(q.Get("q"), ",")
	var words []string
	for _, qword := range qs {
		qword = strings.TrimSpace(qword)
		if len(qword) == 0 {
			continue
		}
		words = append(words, qword)
	}

	if len(words) == 0 {
		w.Write([]byte(templateify(searchHTML, map[string]string{
			VarTotalGIFs: fmt.Sprintf("%d", indexSize),
		})))
		return
	}

	var fnames []string
	for _, word := range words {
		fnames = append(fnames, index[word]...)
	}
	fmt.Println(words, "produced", len(fnames), "results")

	entriesHTML := make([]string, len(fnames))
	for i := range entriesHTML {
		entriesHTML[i] = templateify(entryHTML, map[string]string{
			VarGIFFilename:  fnames[i],
			VarResultNumber: fmt.Sprintf("%d", i+1),
		})
	}

	w.Write([]byte(templateify(resultsHTML, map[string]string{
		VarTotalGIFs:  fmt.Sprintf("%d", indexSize),
		VarWords:      q.Get("q"),
		VarNumResults: fmt.Sprintf("%d", len(fnames)),
		VarResults:    strings.Join(entriesHTML, "\n"),
	})))
}

// GET /files/the-filename
func handleFiles(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	fname, err := filenameFromPath(req.URL.Path)
	if err != nil {
		fmt.Println(err)
		w.WriteHeader(404)
		return
	}
	fmt.Println("file:", fname)
	r := readFile(fname)
	if r == nil {
		w.WriteHeader(404)
		return
	}
	w.WriteHeader(200)
	if _, err := io.Copy(w, r); err != nil {
		fmt.Println(err)
	}
}

// GET /thumbs/the-filename
func handleThumbs(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	fname, err := filenameFromPath(req.URL.Path)
	if err != nil {
		fmt.Println(err)
		w.WriteHeader(404)
		return
	}
	fmt.Println("thumb:", fname)

	f, err := os.Open(path.Join(*srcFlag, fname))
	if err != nil {
		fmt.Println(err)
		w.WriteHeader(404)
		return
	}
	// decode first image only
	img, err := gif.Decode(f)
	if err != nil {
		fmt.Println(err)
		w.WriteHeader(500)
		return
	}

	w.WriteHeader(200)
	if err := jpeg.Encode(w, img, nil); err != nil {
		fmt.Println(err)
		return
	}
}

func filenameFromPath(path string) (string, error) {
	segments := strings.SplitN(path, "/", -1)
	if len(segments) != 3 {
		return "", fmt.Errorf("bad number of paths")
	}
	if filenameRegexp.Match([]byte(segments[2])) {
		return segments[2], nil
	}
	return "", fmt.Errorf("bad filename")
}

func readFile(fname string) io.Reader {
	f, err := os.Open(path.Join(*srcFlag, fname))
	if err != nil {
		fmt.Println(err)
		return nil
	}
	return f
}

func indexFiles() error {
	files, err := ioutil.ReadDir(*srcFlag)
	if err != nil {
		return err
	}
	for _, f := range files {
		name := f.Name()
		words := wordSplitRegexp.Split(strings.TrimSuffix(name, ".gif"), -1)
		for _, word := range words {
			entries := index[word]
			entries = append(entries, name)
			index[word] = entries
		}
	}
	fmt.Println("Indexed", len(files), "files")
	indexSize = len(files)
	return nil
}

func loadTemplateHTML() {
	b, err := ioutil.ReadFile("templates/entry.html")
	if err != nil {
		panic(err)
	}
	entryHTML = string(b)

	b, err = ioutil.ReadFile("templates/results.html")
	if err != nil {
		panic(err)
	}
	resultsHTML = string(b)

	b, err = ioutil.ReadFile("templates/search.html")
	if err != nil {
		panic(err)
	}
	searchHTML = string(b)
}

func templateify(html string, data map[string]string) string {
	for k, v := range data {
		html = strings.Replace(html, k, v, -1)
	}
	return html
}

func main() {
	flag.Parse()
	loadTemplateHTML()

	http.HandleFunc("/search", handleSearch)
	http.HandleFunc("/files/", handleFiles)
	http.HandleFunc("/thumbs/", handleThumbs)

	if err := indexFiles(); err != nil {
		panic(err)
	}

	fmt.Println("Listening on port", *portFlag)
	if err := http.ListenAndServe(fmt.Sprintf(":%d", *portFlag), nil); err != nil {
		panic(err)
	}
}
