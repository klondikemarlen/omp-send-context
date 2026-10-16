package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolveBridgeStatePrefersRegistryOwnerOverStalePointer(t *testing.T) {
	older := discoveryServer(t, "older")
	newestReceived := make(chan struct{}, 1)
	newest := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/health" {
			_ = json.NewEncoder(writer).Encode(map[string]string{"instanceId": "newest"})
			return
		}
		newestReceived <- struct{}{}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer newest.Close()
	statePath := discoveryStatePath(t)
	writeDiscoveryState(t, statePath, "older", older.URL, 10, os.Getpid())
	writeDiscoveryState(t, statePath+".d/newest.json", "newest", newest.URL, 20, os.Getpid())
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	state, err := resolveBridgeState()
	if err != nil {
		t.Fatal(err)
	}
	if state.InstanceID != "newest" {
		t.Fatalf("selected instance = %q, want newest", state.InstanceID)
	}
	if err := deliverEnvelope([]byte(`{"version":1,"source":"firefox","prompt":"selected text"}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-newestReceived:
	default:
		t.Fatal("newest registry owner did not receive the context")
	}
}

func TestDeliverEnvelopeDoesNotTreatInactivePointerAsNewActivity(t *testing.T) {
	// Arrange
	background := discoveryServer(t, "background")
	received := make(chan string, 1)
	active := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/health" {
			_ = json.NewEncoder(writer).Encode(map[string]string{"instanceId": "active"})
			return
		}
		var envelope contextEnvelope
		if err := json.NewDecoder(request.Body).Decode(&envelope); err != nil {
			t.Error(err)
		}
		received <- envelope.Prompt
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer active.Close()
	statePath := discoveryStatePath(t)
	writeDiscoveryState(t, statePath, "background", background.URL, 0, os.Getpid())
	writeDiscoveryState(t, statePath+".d/background.json", "background", background.URL, 0, os.Getpid())
	writeDiscoveryState(t, statePath+".d/active.json", "active", active.URL, 20, os.Getpid())
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	// Act
	err := deliverEnvelope([]byte(`{"version":1,"source":"firefox","prompt":"zero-startup-does-not-steal"}`))

	// Assert
	if err != nil {
		t.Fatal(err)
	}
	select {
	case prompt := <-received:
		if prompt != "zero-startup-does-not-steal" {
			t.Fatalf("active prompt = %q", prompt)
		}
	default:
		t.Fatal("inactive startup stole Firefox delivery from the active console")
	}
}

func TestResolveBridgeStatePromotesAfterReusedOwner(t *testing.T) {
	older := discoveryServer(t, "fallback")
	reused := discoveryServer(t, "another-instance")
	statePath := discoveryStatePath(t)
	writeDiscoveryState(t, statePath, "fallback", older.URL, 10, os.Getpid())
	writeDiscoveryState(t, statePath+".d/latest.json", "latest", reused.URL, 20, os.Getpid())
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	state, err := resolveBridgeState()
	if err != nil {
		t.Fatal(err)
	}
	if state.InstanceID != "fallback" {
		t.Fatalf("selected instance = %q, want fallback", state.InstanceID)
	}
}

func TestResolveBridgeStatePromotesAfterDeadOwner(t *testing.T) {
	older := discoveryServer(t, "fallback")
	statePath := discoveryStatePath(t)
	writeDiscoveryState(t, statePath, "fallback", older.URL, 10, os.Getpid())
	writeDiscoveryState(t, statePath+".d/latest.json", "latest", "http://127.0.0.1:1", 20, 1<<30)
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	state, err := resolveBridgeState()
	if err != nil {
		t.Fatal(err)
	}
	if state.InstanceID != "fallback" {
		t.Fatalf("selected instance = %q, want fallback", state.InstanceID)
	}
}

func TestResolveBridgeStateStopsAfterAmbiguousLatestOwnerFailure(t *testing.T) {
	older := discoveryServer(t, "fallback")
	ambiguous := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer ambiguous.Close()
	statePath := discoveryStatePath(t)
	writeDiscoveryState(t, statePath, "fallback", older.URL, 10, os.Getpid())
	writeDiscoveryState(t, statePath+".d/latest.json", "latest", ambiguous.URL, 20, os.Getpid())
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	if _, err := resolveBridgeState(); err == nil {
		t.Fatal("resolveBridgeState() unexpectedly fell back after an ambiguous health failure")
	}
}

func TestResolveBridgeStateTracksLifecycleDisappearanceAndReappearance(t *testing.T) {
	first := discoveryServer(t, "first")
	second := discoveryServer(t, "second")
	statePath := discoveryStatePath(t)
	registryPath := filepath.Join(statePath+".d", "first.json")
	if err := os.MkdirAll(filepath.Dir(registryPath), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OMP_CONTEXT_STATE_FILE", statePath)

	writeDiscoveryState(t, registryPath, "first", first.URL, 30, os.Getpid())
	state, err := resolveBridgeState()
	if err != nil || state.Endpoint != first.URL {
		t.Fatalf("initial owner = %#v, error = %v", state, err)
	}
	if err := os.Remove(registryPath); err != nil {
		t.Fatal(err)
	}
	state, err = resolveBridgeState()
	if err == nil || state.InstanceID != "" {
		t.Fatalf("disappeared owner = %#v, error = %v; want no owner", state, err)
	}
	writeDiscoveryState(t, filepath.Join(statePath+".d", "second.json"), "second", second.URL, 40, os.Getpid())
	state, err = resolveBridgeState()
	if err != nil || state.Endpoint != second.URL {
		t.Fatalf("reappeared owner = %#v, error = %v", state, err)
	}
}

func TestParseBridgeEndpointRejectsNonCanonicalEndpoints(t *testing.T) {
	for _, endpoint := range []string{"http://user@127.0.0.1:80", "http://127.0.0.1:80/path", "http://127.0.0.1:80?query", "http://127.0.0.1:80#fragment", "http://localhost:80", "http://127.0.0.1:0"} {
		if _, err := parseBridgeEndpoint(endpoint); err == nil {
			t.Errorf("parseBridgeEndpoint(%q) unexpectedly succeeded", endpoint)
		}
	}
}

func discoveryServer(t *testing.T, instanceID string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/health" {
			_ = json.NewEncoder(writer).Encode(map[string]string{"instanceId": instanceID})
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	return server
}

func discoveryStatePath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "editor-context-bridge.json")
}

func writeDiscoveryState(t *testing.T, path, instanceID, endpoint string, claimedAt float64, pid int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	state := bridgeState{Endpoint: endpoint, Token: "test-token", InstanceID: instanceID, PID: pid, ClaimedAt: &claimedAt, UpdatedAt: time.Now().Format(time.RFC3339Nano)}
	content, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
}
