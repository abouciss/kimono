package sandbox

import (
	"io"
	"math"
	"net/http"
	"strings"
	"testing"
)

func headers(fiveHour, fiveReset, week, weekReset string) http.Header {
	h := http.Header{}
	if fiveHour != "" {
		h.Set("anthropic-ratelimit-unified-5h-utilization", fiveHour)
		h.Set("anthropic-ratelimit-unified-5h-reset", fiveReset)
	}
	if week != "" {
		h.Set("anthropic-ratelimit-unified-7d-utilization", week)
		h.Set("anthropic-ratelimit-unified-7d-reset", weekReset)
	}
	return h
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestUsageIsCreditedToTheWorkspaceThatMadeTheRequest(t *testing.T) {
	var m meter
	m.credit("a", readUsage(headers("0.10", "100", "0.20", "900"))) // first reading: a baseline, nobody's
	m.credit("a", readUsage(headers("0.15", "100", "0.21", "900")))
	m.credit("b", readUsage(headers("0.25", "100", "0.23", "900")))
	m.credit("a", readUsage(headers("0.24", "100", "0.23", "900"))) // fell: counts as nothing
	a, five, week := m.take("a")
	b, _, _ := m.take("b")
	if !near(a.FiveHour, .05) || !near(a.Week, .01) || !near(b.FiveHour, .10) || !near(b.Week, .02) {
		t.Fatalf("a=%+v b=%+v", a, b)
	}
	if five.Utilization != .24 || week.Reset != 900 {
		t.Fatalf("last reading %+v %+v", five, week)
	}
	if again, _, _ := m.take("a"); again.FiveHour != 0 {
		t.Fatalf("take should start again from zero, got %+v", again)
	}
}

func TestANewWindowCreditsWhatItHasUsedSoFar(t *testing.T) {
	var m meter
	m.credit("a", readUsage(headers("0.90", "100", "", "")))
	m.credit("a", readUsage(headers("0.03", "200", "", "")))
	if got, _, _ := m.take("a"); !near(got.FiveHour, .03) {
		t.Fatalf("got %+v", got)
	}
}

func TestMissingOrOddUsageHeadersCountForNothing(t *testing.T) {
	var m meter
	m.credit("a", readUsage(http.Header{}))
	m.credit("a", readUsage(headers("lots", "100", "-1", "900")))
	if got, five, week := m.take("a"); got.FiveHour != 0 || got.Week != 0 || five != nil || week != nil {
		t.Fatalf("got %+v %v %v", got, five, week)
	}
}

func TestAStreamedResponseWeighsWhatItUsed(t *testing.T) {
	stream := "event: message_start\n" +
		`data: {"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":1000,"cache_creation_input_tokens":2000,"cache_read_input_tokens":10000,"output_tokens":1}}}` + "\n\n" +
		"event: content_block_delta\n" + `data: {"type":"content_block_delta","delta":{"text":"hi"}}` + "\n\n" +
		"event: message_delta\n" + `data: {"type":"message_delta","usage":{"output_tokens":400}}` + "\n\n"
	// (1000 + 1.25*2000 + 0.1*10000 + 5*400) * $5 / 1M
	if got := responseCost([]byte(stream)); !near(got, 6500*5/1e6) {
		t.Fatalf("got %v", got)
	}
	message := `{"model":"claude-haiku-5-5","usage":{"input_tokens":1000000,"output_tokens":0}}`
	if got := responseCost([]byte(message)); !near(got, 1) {
		t.Fatalf("got %v", got)
	}
}

func TestAResponseIsWeighedForItsWorkspaceOnceRead(t *testing.T) {
	var m meter
	body := `{"model":"claude-sonnet-5-5","usage":{"input_tokens":1000000,"output_tokens":0}}`
	response := &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
	m.weighResponse("a", response)
	if _, err := io.ReadAll(response.Body); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if got, _, _ := m.take("a"); !near(got.Weight, 3) {
		t.Fatalf("got %+v", got)
	}
}
