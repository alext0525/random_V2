// PDF Toolkit: a tiny launcher that serves the embedded web app on localhost
// and opens it in the default browser. All file processing happens in the
// browser; files never leave the machine.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed web
var webFS embed.FS

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func main() {
	// Windows may map these from the registry incorrectly; pin them.
	for ext, t := range map[string]string{
		".js": "text/javascript", ".css": "text/css", ".html": "text/html",
		".svg": "image/svg+xml", ".json": "application/json",
	} {
		_ = mime.AddExtensionType(ext, t)
	}

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot listen:", err)
		os.Exit(1)
	}

	var mu sync.Mutex
	var byeTimer *time.Timer
	cancelBye := func() {
		mu.Lock()
		defer mu.Unlock()
		if byeTimer != nil {
			byeTimer.Stop()
			byeTimer = nil
		}
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	// Page load/reload cancels a pending shutdown; closing the tab schedules one.
	mux.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) {
		cancelBye()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/api/bye", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if byeTimer == nil {
			byeTimer = time.AfterFunc(4*time.Second, func() { os.Exit(0) })
		}
		w.WriteHeader(http.StatusNoContent)
	})

	url := "http://" + ln.Addr().String() + "/"
	// If the browser never connects, don't linger forever.
	time.AfterFunc(2*time.Minute, func() {
		if !connected.Load() {
			os.Exit(0)
		}
	})
	go openBrowser(url)
	fmt.Println("PDF Toolkit running at", url)
	_ = http.Serve(ln, noCache(markConnected(mux)))
}

var connected atomic.Bool

func markConnected(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connected.Store(true)
		h.ServeHTTP(w, r)
	})
}

func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}
