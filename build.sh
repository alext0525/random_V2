#!/bin/sh
set -e
mkdir -p dist
GOOS=windows GOARCH=amd64 go build -ldflags "-H=windowsgui -s -w" -o dist/PDFToolkit.exe .
GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o dist/pdftoolkit .
