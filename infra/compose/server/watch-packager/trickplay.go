package main

// The scrubber's pictures, made once per file (Jellyfin calls it trickplay):
// one small frame every ten seconds, laid out ten by ten on JPEG sheets. A
// player loads the sheets and shows a tile as the pointer moves, so hovering
// costs no video work at all.
//
// Each frame is its own seek rather than one pass over the file: a seek
// reads about one keyframe (half a megabyte) where a pass reads everything
// between two pictures. A few run at once, at the lowest CPU priority. The
// decoder runs on one thread and nothing is skipped: with frame threads or
// keyframes only, ffmpeg holds the first picture back until it has read on
// to the next keyframe, ten seconds and megabytes later.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"io"
	"log"
	"math"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	trickCols    = 10
	trickRows    = 10
	trickWorkers = 4
	/* Frames past this aren't made: eight hours at the usual ten seconds. */
	trickMost = 2880
)

/* One file's sheets at a time. */
var tricking = make(chan struct{}, 1)

type trickBody struct {
	Input    string  `json:"input"`
	Interval float64 `json:"interval"`
	Width    int     `json:"width"`
}

type trickResult struct {
	Interval float64  `json:"interval"`
	Width    int      `json:"width"`
	Height   int      `json:"height"`
	Cols     int      `json:"cols"`
	Rows     int      `json:"rows"`
	Count    int      `json:"count"`
	Sheets   []string `json:"sheets"`
	Ms       int64    `json:"ms"`
}

func handleTrickplay(w http.ResponseWriter, r *http.Request) {
	var body trickBody
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil || !strings.HasPrefix(body.Input, "http") {
		http.Error(w, "bad input", http.StatusBadRequest)
		return
	}
	if body.Interval < 2 || body.Interval > 120 {
		body.Interval = 10
	}
	if body.Width < 80 || body.Width > 640 {
		body.Width = 320
	}
	respondLater(w, r, func() (any, error) { return trickplay(r.Context(), body) })
}

func trickplay(parent context.Context, body trickBody) (*trickResult, error) {
	select {
	case tricking <- struct{}{}:
	case <-parent.Done():
		return nil, parent.Err()
	}
	defer func() { <-tricking }()
	started := time.Now()
	ctx, cancel := context.WithTimeout(parent, 45*time.Minute)
	defer cancel()
	local := localInput(body.Input)
	duration, err := durationOf(ctx, local)
	if err != nil {
		return nil, err
	}
	if duration < 60 {
		return nil, fmt.Errorf("only %.0f seconds long", duration)
	}
	count := min(int(math.Ceil(duration/body.Interval)), trickMost)
	frames := make([][]byte, count)
	jobs := make(chan int)
	var failed, streak atomic.Int64
	var group sync.WaitGroup
	for range trickWorkers {
		group.Add(1)
		go func() {
			defer group.Done()
			for k := range jobs {
				/* The middle of the stretch the tile stands for; the keyframe before it is what comes out. */
				at := math.Min((float64(k)+0.5)*body.Interval, math.Max(0, duration-1))
				frame, err := frameAt(ctx, local, at, body.Width)
				if err != nil && ctx.Err() == nil {
					time.Sleep(time.Second)
					frame, err = frameAt(ctx, local, at, body.Width)
				}
				if err != nil {
					failed.Add(1)
					/* A source that stopped answering: no use asking for the rest. */
					if streak.Add(1) >= 12 {
						cancel()
					}
					continue
				}
				streak.Store(0)
				frames[k] = frame
			}
		}()
	}
feed:
	for k := range count {
		select {
		case jobs <- k:
		case <-ctx.Done():
			break feed
		}
	}
	close(jobs)
	group.Wait()
	if err := parent.Err(); err != nil {
		return nil, err
	}
	if n := int(failed.Load()); ctx.Err() != nil || n*4 > count {
		return nil, fmt.Errorf("%d of %d frames couldn't be read", n, count)
	}
	result := &trickResult{Interval: body.Interval, Cols: trickCols, Rows: trickRows, Count: count}
	if result.Sheets, result.Width, result.Height, err = tile(frames); err != nil {
		return nil, err
	}
	result.Ms = time.Since(started).Milliseconds()
	log.Printf("trickplay: %d frames on %d sheets (%d missing) in %s", count, len(result.Sheets), failed.Load(), time.Since(started).Round(time.Second))
	return result, nil
}

func durationOf(ctx context.Context, local string) (float64, error) {
	ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffprobePath, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1",
		"-probesize", "5M", "-analyzeduration", "0", local)
	errs := &tail{}
	cmd.Stderr = errs
	out, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe couldn't read it: %v %s", err, lastLine(errs.String()))
	}
	duration, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if duration <= 0 {
		return 0, errors.New("the file doesn't say how long it is")
	}
	return duration, nil
}

/* One frame near `at` as a JPEG `width` wide. */
func frameAt(parent context.Context, local string, at float64, width int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, 90*time.Second)
	defer cancel()
	cmd := lowPriority(ctx, ffmpegPath, "-nostdin", "-hide_banner", "-v", "error", "-threads", "1", "-noaccurate_seek",
		"-ss", strconv.FormatFloat(at, 'f', 3, 64), "-i", local, "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1",
		"-vf", fmt.Sprintf("scale=%d:-2", width), "-fps_mode", "passthrough", "-q:v", "5", "-c:v", "mjpeg", "-f", "image2pipe", "-")
	errs := &tail{}
	cmd.Stderr = errs
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%v %s", err, lastLine(errs.String()))
	}
	if len(out) == 0 {
		return nil, errors.New("no frame")
	}
	return out, nil
}

/* Lays the frames out on sheets, left to right and top to bottom; a frame that couldn't be read stays black. */
func tile(frames [][]byte) (sheets []string, width, height int, err error) {
	for _, f := range frames {
		if f == nil {
			continue
		}
		if c, cerr := jpeg.DecodeConfig(bytes.NewReader(f)); cerr == nil {
			width, height = c.Width, c.Height
			break
		}
	}
	if width == 0 {
		return nil, 0, 0, errors.New("no frame could be read")
	}
	per := trickCols * trickRows
	for from := 0; from < len(frames); from += per {
		part := frames[from:min(from+per, len(frames))]
		rows := (len(part) + trickCols - 1) / trickCols
		sheet := image.NewRGBA(image.Rect(0, 0, width*trickCols, height*rows))
		draw.Draw(sheet, sheet.Bounds(), image.Black, image.Point{}, draw.Src)
		for i, f := range part {
			if f == nil {
				continue
			}
			img, derr := jpeg.Decode(bytes.NewReader(f))
			if derr != nil {
				continue
			}
			at := image.Pt((i%trickCols)*width, (i/trickCols)*height)
			draw.Draw(sheet, image.Rectangle{Min: at, Max: at.Add(image.Pt(width, height))}, img, img.Bounds().Min, draw.Src)
		}
		var out bytes.Buffer
		if err := jpeg.Encode(&out, sheet, &jpeg.Options{Quality: 72}); err != nil {
			return nil, 0, 0, err
		}
		sheets = append(sheets, base64.StdEncoding.EncodeToString(out.Bytes()))
	}
	return sheets, width, height, nil
}
