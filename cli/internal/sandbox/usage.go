package sandbox

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
 * Usage, as the plan behind Kimono's Claude credential reports it. Each model
 * response through the gateway carries the account's place in its 5-hour and
 * weekly windows (anthropic-ratelimit-unified-5h-* and -7d-*: a utilization
 * from 0 to 1 and a reset time). These headers are not documented, so they are
 * read defensively: a missing or odd value is simply not counted.
 *
 * Every rise between one response and the next is credited to the workspace
 * that made the request, and the turn reports what it was credited when it
 * ends, so the Portal can hold each person to their share. Two workspaces
 * talking at once blur the split a little; the account total stays exact.
 *
 * The plan only reports whole percents, so most turns see no rise at all and
 * whoever crosses the next step is credited all of it. Each turn therefore
 * also reports its weight: the tokens its responses used, priced by model
 * (lib/code/model.ts in the Portal shares the plan's rises out by weight).
 */

type usageWindow struct {
	Utilization float64 `json:"utilization"`
	Reset       int64   `json:"reset"` // Unix seconds
}

// usageReading is one response's view of the account.
type usageReading struct {
	FiveHour, Week *usageWindow
}

func readUsage(header http.Header) usageReading {
	window := func(name string) *usageWindow {
		raw := header.Get("anthropic-ratelimit-unified-" + name + "-utilization")
		if raw == "" {
			return nil
		}
		u, err := strconv.ParseFloat(raw, 64)
		if err != nil || u < 0 || u > 10 {
			return nil
		}
		reset, _ := strconv.ParseInt(header.Get("anthropic-ratelimit-unified-"+name+"-reset"), 10, 64)
		return &usageWindow{Utilization: u, Reset: reset}
	}
	return usageReading{FiveHour: window("5h"), Week: window("7d")}
}

// meter keeps the account's last reading and what each workspace has been credited this turn.
type meter struct {
	mu       sync.Mutex
	fiveHour *usageWindow
	week     *usageWindow
	credited map[string]*usageCredit
}

type usageCredit struct {
	FiveHour float64
	Week     float64
	// Weight is what the turn's responses cost, in dollars at API prices: the measure the plan's rises are shared out by.
	Weight float64
}

// credit records a reading for a workspace and returns how much of each window it used.
func (m *meter) credit(id string, reading usageReading) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.credited == nil {
		m.credited = map[string]*usageCredit{}
	}
	c := m.credited[id]
	if c == nil {
		c = &usageCredit{}
		m.credited[id] = c
	}
	c.FiveHour += rise(&m.fiveHour, reading.FiveHour)
	c.Week += rise(&m.week, reading.Week)
}

// rise is how far a window moved since the last reading: all of it after a reset, nothing if it fell.
func rise(last **usageWindow, now *usageWindow) float64 {
	if now == nil {
		return 0
	}
	before := *last
	copied := *now
	*last = &copied
	if before == nil {
		return 0
	}
	if now.Reset != before.Reset {
		return now.Utilization
	}
	if now.Utilization > before.Utilization {
		return now.Utilization - before.Utilization
	}
	return 0
}

// weigh adds a response's cost to what a workspace has used this turn.
func (m *meter) weigh(id string, weight float64) {
	if weight <= 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.credited == nil {
		m.credited = map[string]*usageCredit{}
	}
	c := m.credited[id]
	if c == nil {
		c = &usageCredit{}
		m.credited[id] = c
	}
	c.Weight += weight
}

// take hands back what a workspace was credited and starts it again from zero.
func (m *meter) take(id string) (usageCredit, *usageWindow, *usageWindow) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var got usageCredit
	if c := m.credited[id]; c != nil {
		got = *c
		delete(m.credited, id)
	}
	return got, m.fiveHour, m.week
}

// usageLine is what a turn reports when it ends.
func usageLine(credit usageCredit, fiveHour, week *usageWindow) map[string]any {
	line := map[string]any{"type": "kimono.usage", "five_hour": credit.FiveHour, "week": credit.Week, "weight": credit.Weight, "at": time.Now().UnixMilli()}
	if fiveHour != nil {
		line["five_hour_now"], line["five_hour_reset"] = fiveHour.Utilization, fiveHour.Reset
	}
	if week != nil {
		line["week_now"], line["week_reset"] = week.Utilization, week.Reset
	}
	return line
}

/* ── weight: what a response cost, from the usage the API reports in it ── */

type tokenUsage struct {
	Input      float64 `json:"input_tokens"`
	CacheWrite float64 `json:"cache_creation_input_tokens"`
	CacheRead  float64 `json:"cache_read_input_tokens"`
	Output     float64 `json:"output_tokens"`
}

// perMillionInput is a model's price for a million input tokens, in dollars; output is five times that.
func perMillionInput(model string) float64 {
	switch {
	case strings.Contains(model, "haiku"):
		return 1
	case strings.Contains(model, "sonnet"):
		return 3
	default: // opus, fable and anything newer: price it high rather than let it pass for little
		return 5
	}
}

func costOf(model string, u tokenUsage) float64 {
	return (u.Input + 1.25*u.CacheWrite + 0.1*u.CacheRead + 5*u.Output) * perMillionInput(model) / 1e6
}

// responseCost reads a model response's body (a JSON message, or a stream of events) for what it used.
func responseCost(body []byte) float64 {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		var message struct {
			Model string     `json:"model"`
			Usage tokenUsage `json:"usage"`
		}
		if json.Unmarshal(trimmed, &message) != nil {
			return 0
		}
		return costOf(message.Model, message.Usage)
	}
	/* A stream: message_start carries the model and input, message_delta the output so far (each larger than the last). */
	var model string
	var used tokenUsage
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if !bytes.HasPrefix(line, []byte("data:")) || !bytes.Contains(line, []byte(`"usage"`)) {
			continue
		}
		var event struct {
			Type    string `json:"type"`
			Message struct {
				Model string     `json:"model"`
				Usage tokenUsage `json:"usage"`
			} `json:"message"`
			Usage *tokenUsage `json:"usage"`
		}
		if json.Unmarshal(bytes.TrimSpace(line[5:]), &event) != nil {
			continue
		}
		switch event.Type {
		case "message_start":
			model, used = event.Message.Model, event.Message.Usage
		case "message_delta":
			if event.Usage != nil {
				if event.Usage.Output > used.Output {
					used.Output = event.Usage.Output
				}
				if event.Usage.Input > used.Input {
					used.Input = event.Usage.Input
				}
				if event.Usage.CacheWrite > used.CacheWrite {
					used.CacheWrite = event.Usage.CacheWrite
				}
				if event.Usage.CacheRead > used.CacheRead {
					used.CacheRead = event.Usage.CacheRead
				}
			}
		}
	}
	return costOf(model, used)
}

// most a response body is read for its usage; past it, the response still passes, only its weight is lost.
const weighLimit = 32 << 20

// weighedBody passes a response through as it is and, once it's done, weighs what it held.
type weighedBody struct {
	io.ReadCloser
	kept    bytes.Buffer
	gzipped bool
	done    func(float64)
	once    sync.Once
}

func (b *weighedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if n > 0 && b.kept.Len() < weighLimit {
		b.kept.Write(p[:n])
	}
	if err == io.EOF {
		b.finish()
	}
	return n, err
}

func (b *weighedBody) Close() error {
	b.finish()
	return b.ReadCloser.Close()
}

func (b *weighedBody) finish() {
	b.once.Do(func() {
		body := b.kept.Bytes()
		if b.gzipped {
			reader, err := gzip.NewReader(bytes.NewReader(body))
			if err != nil {
				return
			}
			body, err = io.ReadAll(io.LimitReader(reader, weighLimit))
			if err != nil && len(body) == 0 {
				return
			}
		}
		b.done(responseCost(body))
	})
}

// weighResponse has a model response weigh itself for a workspace as it is read.
func (m *meter) weighResponse(id string, response *http.Response) {
	if response.Body == nil || response.StatusCode >= 300 {
		return
	}
	encoding := strings.ToLower(response.Header.Get("Content-Encoding"))
	if encoding != "" && encoding != "identity" && encoding != "gzip" {
		return
	}
	response.Body = &weighedBody{ReadCloser: response.Body, gzipped: encoding == "gzip", done: func(weight float64) { m.weigh(id, weight) }}
}
