FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN go build -o /out/proxy-core .

FROM alpine:3.20
RUN adduser -D -H guardian
USER guardian
WORKDIR /app
COPY --from=build /out/proxy-core /usr/local/bin/proxy-core
EXPOSE 9090
ENTRYPOINT ["/usr/local/bin/proxy-core"]
