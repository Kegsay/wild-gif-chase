FROM golang:alpine

RUN apk --no-cache add ca-certificates
WORKDIR /go/src/github.com/Kegsay/wild-gif-chase

ADD . /go/src/github.com/Kegsay/wild-gif-chase

RUN go build ./cmd/wild-gif-chase

CMD ./wild-gif-chase --port 443 --src ./samples

EXPOSE 443

