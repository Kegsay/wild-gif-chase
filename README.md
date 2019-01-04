# Wild GIF Chase
Scans a directory for GIF files and create an index which can be searched. Results
are exposed via an HTTP server.

Currently this does prefix matching on the filename of the GIF, and basic word
matching based on `-` and `_` as separators.

Features:
 - Thumbnails and indexes GIFs
 - Provides search functionality based on the filename of the GIF.
 - Exposed as vanilla HTML (no Javascript; displays correctly on mobile browsers)

Coming soon:
 - Arbitrary tagging support as plain old text files
 - Better compression over the wire (maybe.)

## Building
```
$ go build ./cmd/wild-gif-chase
```

## Running
```
$ ./wild-gif-chase --port 1234 --src ./samples
```

then visit http://localhost:1234/search

## Rationale
 - GIFs are great to use for responses when chatting.
 - Timing is everything; the conversation moves on.
 - Need a quick way to find the "right" GIF. Can't remember the filename.
 - Need a way to search through GIFs, tag GIFs with arbitrary metadata and expose
   it all via an HTTP server.
 - Enter Wild GIF Chase.

### No EXIF/XMP for tagging?
 - No. I want to add tags using a text editor. Tags are done as separate files.
 - GIFs are huge. Let's not make them bigger with metadata :)

