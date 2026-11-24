package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestTrickplay(t *testing.T) {
	bin, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg isn't installed")
	}
	probe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe isn't installed")
	}
	ffmpegPath, ffprobePath = bin, probe
	path := filepath.Join(t.TempDir(), "long.mkv")
	make := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=24", "-t", "125", "-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-y", path)
	if out, err := make.CombinedOutput(); err != nil {
		t.Fatalf("making the sample: %v %s", err, out)
	}
	var asked int
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked++
		f, err := os.Open(path)
		if err != nil {
			t.Error(err)
			return
		}
		defer f.Close()
		http.ServeContent(w, r, "long.mkv", time.Time{}, f)
	}))
	defer source.Close()
	if inputs.addr == "" {
		startInputProxy()
	}
	got, err := trickplay(context.Background(), trickBody{Input: source.URL, Interval: 10, Width: 160})
	if err != nil {
		t.Fatal(err)
	}
	if got.Count != 13 || got.Width != 160 || got.Height != 90 || len(got.Sheets) != 1 {
		t.Fatalf("got %d frames of %dx%d on %d sheets", got.Count, got.Width, got.Height, len(got.Sheets))
	}
	raw, err := base64.StdEncoding.DecodeString(got.Sheets[0])
	if err != nil {
		t.Fatal(err)
	}
	sheet, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	/* Thirteen frames: two rows, ten wide. */
	if b := sheet.Bounds(); b.Dx() != 1600 || b.Dy() != 180 {
		t.Fatalf("the sheet is %dx%d", b.Dx(), b.Dy())
	}
	/* The last frame is a picture, the space after it black. */
	bright := func(x, y int) uint32 { r, g, b, _ := sheet.At(x, y).RGBA(); return (r + g + b) >> 8 }
	var last, empty uint32
	for x := 0; x < 160; x += 8 {
		last += bright(2*160+x, 90+45)
		empty += bright(5*160+x, 90+45)
	}
	if last < 400 || empty > 200 {
		t.Fatalf("the last frame's brightness is %d and the empty tile's %d", last, empty)
	}
}
