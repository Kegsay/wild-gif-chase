FROM golang:alpine

RUN apk --no-cache add ca-certificates
WORKDIR /go/src/github.com/Kegsay/wild-gif-chase

ADD . /go/src/github.com/Kegsay/wild-gif-chase

RUN go build ./cmd/wild-gif-chase

ENV LE_HOST

CMD ./wild-gif-chase --src ./samples

EXPOSE 8080
EXPOSE 4443

