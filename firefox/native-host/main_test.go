package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeliverEnvelopeUsesAuthenticatedLoopbackBridge(t *testing.T) {
	var received []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("authorization = %q", got)
		}
		var err error
		received, err = io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read request body: %v", err)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	statePath := filepath.Join(t.TempDir(), "bridge.json")
	state := `{"endpoint":"` + server.URL + `","token":"test-token"}`
	if err := os.WriteFile(statePath, []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	payload := []byte(`{"version":1,"source":"firefox","prompt":"selected text","metadata":{"url":"https://example.com","title":"Example"}}`)
	if err := deliverEnvelope(payload); err != nil {
		t.Fatal(err)
	}
	if string(received) != string(payload) {
		t.Fatalf("bridge body = %s, want %s", received, payload)
	}
}
func TestValidateEnvelopeRejectsInvalidMetadata(t *testing.T) {
	for _, metadata := range []string{`null`, `42`, `[]`, `{"url":42}`} {
		t.Run(metadata, func(t *testing.T) {
			var envelope contextEnvelope
			payload := `{"version":1,"source":"firefox","prompt":"text","metadata":` + metadata + `}`
			if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
				t.Fatal(err)
			}
			if err := validateEnvelope(envelope); err == nil {
				t.Fatalf("validateEnvelope(%s) unexpectedly succeeded", metadata)
			}
		})
	}
}

func TestReadMessageUsesLittleEndianLengthPrefix(t *testing.T) {
	payload := []byte(`{"version":1}`)
	input := append(make([]byte, 4), payload...)
	binary.LittleEndian.PutUint32(input[:4], uint32(len(payload)))
	got, err := readMessage(bufio.NewReader(strings.NewReader(string(input))))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("payload = %s, want %s", got, payload)
	}
}
