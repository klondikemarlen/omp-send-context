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
	"strconv"
	"strings"
	"testing"
)

func TestDeliverEnvelopeUsesAuthenticatedLoopbackBridge(t *testing.T) {
	var received []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/health" {
			_, _ = writer.Write([]byte(`{"instanceId":"test-instance"}`))
			return
		}
		if got := request.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("authorization = %q", got)
		}
		if got := request.Header.Get("X-OMP-Instance-Id"); got != "test-instance" {
			t.Errorf("instance id = %q", got)
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
	state := `{"endpoint":"` + server.URL + `","token":"test-token","instanceId":"test-instance","pid":` + strconv.Itoa(os.Getpid()) + `,"claimedAt":1}`
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

func TestDeliverEnvelopeDoesNotFollowRedirects(t *testing.T) {
	redirectTargetCalled := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirectTargetCalled = true
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/health" {
			_, _ = writer.Write([]byte(`{"instanceId":"redirect-instance"}`))
			return
		}
		http.Redirect(writer, request, target.URL+"/context", http.StatusFound)
	}))
	defer source.Close()
	statePath := filepath.Join(t.TempDir(), "bridge.json")
	state := `{"endpoint":"` + source.URL + `","token":"test-token","instanceId":"redirect-instance","pid":` + strconv.Itoa(os.Getpid()) + `,"claimedAt":1}`
	if err := os.WriteFile(statePath, []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	payload := []byte(`{"version":1,"source":"firefox","prompt":"selected text"}`)
	if err := deliverEnvelope(payload); err == nil || !strings.Contains(err.Error(), "302") {
		t.Fatalf("deliverEnvelope() error = %v, want bridge status 302", err)
	}
	if redirectTargetCalled {
		t.Fatal("redirect destination received the context")
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
