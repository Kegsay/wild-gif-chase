package main

import (
	"flag"
	"fmt"
	"image/gif"
	"image/jpeg"
	"io"
	"net/http"
	"path"
	"os"
	"regexp"
	"strings"
)

var (
	portFlag = flag.Int("port", 0, "Port to listen on")
	srcFlag = flag.String("src", "", "Source GIF directory")
)

var filenameRegexp = regexp.MustCompile(`^[a-zA-Z0-9\-_]+\.gif$`)

// GET /search?q=cat,dog,mouse
func handleSearch(w http.ResponseWriter, req *http.Request) {
	if req.Method != "GET" {
		w.WriteHeader(405)
		return
	}
	q := req.URL.Query()
	words := strings.Split(q.Get("q"), ",")
	fmt.Println(words)
	w.WriteHeader(200)
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
	fmt.Println(fname)
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
	fmt.Println("thumb",fname)

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


func main() {
	flag.Parse()

	http.HandleFunc("/search", handleSearch)
	http.HandleFunc("/files/", handleFiles)
	http.HandleFunc("/thumbs/", handleThumbs)

	fmt.Println("Listening on port", *portFlag)
	if err := http.ListenAndServe(fmt.Sprintf(":%d", *portFlag), nil); err != nil {
		panic(err)
	}
}