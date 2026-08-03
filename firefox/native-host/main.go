package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const maxMessageBytes = 2 * 1024 * 1024

type bridgeState struct {
	Endpoint string `json:"endpoint"`
	Token    string `json:"token"`
}

type contextEnvelope struct {
	Version  int             `json:"version"`
	Source   string          `json:"source"`
	Prompt   string          `json:"prompt"`
	Metadata json.RawMessage `json:"metadata"`
}

type response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	for {
		payload, err := readMessage(reader)
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			_ = writeMessage(writer, response{Error: err.Error()})
			return
		}

		result := response{OK: true}
		if err := deliverEnvelope(payload); err != nil {
			result = response{Error: err.Error()}
		}
		if err := writeMessage(writer, result); err != nil {
			return
		}
	}
}

func readMessage(reader io.Reader) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	length := binary.LittleEndian.Uint32(header[:])
	if length > maxMessageBytes {
		return nil, fmt.Errorf("message is too large")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, fmt.Errorf("failed to read message: %w", err)
	}
	return payload, nil
}

func writeMessage(writer *bufio.Writer, value response) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := writer.Write(header[:]); err != nil {
		return err
	}
	if _, err := writer.Write(payload); err != nil {
		return err
	}
	return writer.Flush()
}

func deliverEnvelope(payload []byte) error {
	if len(payload) > maxMessageBytes {
		return fmt.Errorf("context envelope is too large")
	}
	var envelope contextEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return fmt.Errorf("invalid context envelope: %w", err)
	}
	if err := validateEnvelope(envelope); err != nil {
		return err
	}

	state, err := readBridgeState()
	if err != nil {
		return err
	}
	endpoint, err := parseBridgeEndpoint(state.Endpoint)
	if err != nil {
		return err
	}
	if strings.ContainsAny(state.Token, "\r\n") || state.Token == "" {
		return fmt.Errorf("invalid OMP bridge state")
	}

	req, err := http.NewRequest(http.MethodPost, endpoint+"/context", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to create OMP bridge request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+state.Token)
	client := &http.Client{
		Timeout:   10 * time.Second,
		Transport: &http.Transport{Proxy: nil},
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to reach OMP bridge: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("OMP bridge returned %d", res.StatusCode)
	}
	return nil
}

func validateEnvelope(envelope contextEnvelope) error {
	if envelope.Version != 1 || (envelope.Source != "vscode" && envelope.Source != "firefox" && envelope.Source != "ptyxis") || envelope.Prompt == "" {
		return fmt.Errorf("expected a version 1 context envelope")
	}
	if len(envelope.Metadata) == 0 {
		return nil
	}
	if string(envelope.Metadata) == "null" {
		return fmt.Errorf("expected object metadata")
	}
	var metadata map[string]interface{}
	if err := json.Unmarshal(envelope.Metadata, &metadata); err != nil || metadata == nil {
		return fmt.Errorf("expected object metadata")
	}
	if value, ok := metadata["url"]; ok {
		if _, ok := value.(string); !ok {
			return fmt.Errorf("expected string metadata URL")
		}
	}
	if value, ok := metadata["title"]; ok {
		if _, ok := value.(string); !ok {
			return fmt.Errorf("expected string metadata title")
		}
	}
	return nil
}

func readBridgeState() (bridgeState, error) {
	statePath := os.Getenv("OMP_CONTEXT_STATE_FILE")
	if statePath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return bridgeState{}, fmt.Errorf("failed to find home directory: %w", err)
		}
		statePath = filepath.Join(home, ".omp", "agent", "editor-context-bridge.json")
	}
	content, err := os.ReadFile(statePath)
	if err != nil {
		return bridgeState{}, fmt.Errorf("failed to read OMP bridge state: %w", err)
	}
	var state bridgeState
	if err := json.Unmarshal(content, &state); err != nil {
		return bridgeState{}, fmt.Errorf("invalid OMP bridge state: %w", err)
	}
	return state, nil
}

func parseBridgeEndpoint(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" || parsed.User != nil {
		return "", fmt.Errorf("invalid OMP bridge state")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("invalid OMP bridge state")
	}
	return "http://127.0.0.1:" + parsed.Port(), nil
}
