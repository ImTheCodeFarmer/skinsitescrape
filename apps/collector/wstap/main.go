// wstap: a websocket client that looks like Chrome on the wire.
//
// Cloudflare's managed challenge on some sites scores the TLS ClientHello and
// the HTTP/1.1 upgrade request. Off-the-shelf clients (Node, curl-impersonate)
// fail that check; this program uses uTLS to send Chrome's exact ClientHello
// and writes the upgrade request byte-for-byte in Chrome's header order.
//
// Usage:
//
//	wstap -url wss://host/socket.io/?EIO=4&transport=websocket [-proxy http://u:p@host:port] [-origin https://host]
//	wstap -fp [-proxy ...]        print our JA4 as seen by tls.peet.ws, for comparison with a real browser
//
// Flags/env: -cookie / WS_COOKIE (e.g. "cf_clearance=..."), -ua / WS_UA. A clearance cookie is only
// needed on low-reputation egress IPs (residential proxy pools); it is bound to the IP and UA that
// minted it and lasts a year. Direct from a clean IP, the fingerprint alone passes.
//
// Output: one JSON object per line on stdout: {"t":<unix ms>,"d":"<text frame>"}.
// Input:  one text frame per line on stdin, sent verbatim.
// Engine.IO keepalive ("2" -> "3") and the namespace connect ("40") are handled here.
package main

import (
	"bufio"
	"bytes"
	"compress/flate"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/gobwas/ws"
	"github.com/gobwas/ws/wsutil"
	tls "github.com/refraction-networking/utls"
)

// Cloudflare cross-checks the User-Agent's OS against the TCP/IP stack it sees,
// so the platform token must match the host we run on. Chrome's TLS fingerprint
// is the same on every OS, so only this string changes.
var userAgent = map[string]string{
	"darwin":  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
	"windows": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
}[runtime.GOOS]

func init() {
	if userAgent == "" {
		userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
	}
}

// chromeSpec reproduces Chrome 152's ClientHello for a websocket (HTTP/1.1-only)
// connection, as captured on 2026-09-15: 16 extensions incl. unknown 51764,
// GREASE + MLDSA entries in signature_algorithms, no ALPS.
func chromeSpec() *tls.ClientHelloSpec {
	spec := &tls.ClientHelloSpec{
		TLSVersMin: tls.VersionTLS12,
		TLSVersMax: tls.VersionTLS13,
		CipherSuites: []uint16{
			tls.GREASE_PLACEHOLDER,
			tls.TLS_AES_128_GCM_SHA256, tls.TLS_AES_256_GCM_SHA384, tls.TLS_CHACHA20_POLY1305_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256, tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384, tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305, tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA, tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
			tls.TLS_RSA_WITH_AES_128_GCM_SHA256, tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_RSA_WITH_AES_128_CBC_SHA, tls.TLS_RSA_WITH_AES_256_CBC_SHA,
		},
		CompressionMethods: []byte{0},
		Extensions: []tls.TLSExtension{
			&tls.UtlsGREASEExtension{},
			&tls.SNIExtension{},
			&tls.ExtendedMasterSecretExtension{},
			&tls.RenegotiationInfoExtension{Renegotiation: tls.RenegotiateOnceAsClient},
			&tls.SupportedCurvesExtension{Curves: []tls.CurveID{tls.GREASE_PLACEHOLDER, tls.X25519MLKEM768, tls.X25519, tls.CurveP256, tls.CurveP384}},
			&tls.SupportedPointsExtension{SupportedPoints: []byte{0}},
			&tls.SessionTicketExtension{},
			&tls.ALPNExtension{AlpnProtocols: []string{"http/1.1"}},
			&tls.StatusRequestExtension{},
			&tls.SignatureAlgorithmsExtension{SupportedSignatureAlgorithms: []tls.SignatureScheme{
				tls.SignatureScheme(0x8a8a),                                                           // GREASE
				tls.SignatureScheme(0x0904), tls.SignatureScheme(0x0905), tls.SignatureScheme(0x0906), // ML-DSA
				tls.ECDSAWithP256AndSHA256, tls.PSSWithSHA256, tls.PKCS1WithSHA256,
				tls.ECDSAWithP384AndSHA384, tls.PSSWithSHA384, tls.PKCS1WithSHA384,
				tls.PSSWithSHA512, tls.PKCS1WithSHA512,
			}},
			&tls.SCTExtension{},
			&tls.KeyShareExtension{KeyShares: []tls.KeyShare{
				{Group: tls.GREASE_PLACEHOLDER, Data: []byte{0}},
				{Group: tls.X25519MLKEM768},
				{Group: tls.X25519},
			}},
			&tls.PSKKeyExchangeModesExtension{Modes: []uint8{tls.PskModeDHE}},
			&tls.SupportedVersionsExtension{Versions: []uint16{tls.GREASE_PLACEHOLDER, tls.VersionTLS13, tls.VersionTLS12}},
			&tls.UtlsCompressCertExtension{Algorithms: []tls.CertCompressionAlgo{tls.CertCompressionBrotli}},
			&tls.GREASEEncryptedClientHelloExtension{
				CandidateCipherSuites: []tls.HPKESymmetricCipherSuite{
					{KdfId: 0x0001, AeadId: 0x0001}, // HKDF-SHA256 / AES-128-GCM
					{KdfId: 0x0001, AeadId: 0x0003}, // HKDF-SHA256 / ChaCha20-Poly1305
				},
				CandidatePayloadLens: []uint16{128, 160, 192, 224},
			},
			&tls.GenericExtension{Id: 51764, Data: []byte{0x00, 0x00}}, // trust_anchors (draft TAI): empty id list. An empty body is rejected by BoringSSL.
			&tls.UtlsGREASEExtension{},
		},
	}
	// Diagnostics: WSTAP_VARIANT=nomlkem | noech | notai | noshuffle | preset133
	switch os.Getenv("WSTAP_VARIANT") {
	case "nomlkem":
		for _, e := range spec.Extensions {
			if ks, ok := e.(*tls.KeyShareExtension); ok {
				ks.KeyShares = []tls.KeyShare{{Group: tls.GREASE_PLACEHOLDER, Data: []byte{0}}, {Group: tls.X25519}}
			}
		}
	case "noech":
		kept := spec.Extensions[:0]
		for _, e := range spec.Extensions {
			if _, ok := e.(*tls.GREASEEncryptedClientHelloExtension); !ok {
				kept = append(kept, e)
			}
		}
		spec.Extensions = kept
	case "notai":
		kept := spec.Extensions[:0]
		for _, e := range spec.Extensions {
			if g, ok := e.(*tls.GenericExtension); !ok || g.Id != 51764 {
				kept = append(kept, e)
			}
		}
		spec.Extensions = kept
	case "noshuffle":
		return spec
	case "preset133":
		s, _ := tls.UTLSIdToSpec(tls.HelloChrome_133)
		return &s
	}
	// Chrome permutes extension order per connection (SNI/GREASE positions are pinned).
	spec.Extensions = tls.ShuffleChromeTLSExtensions(spec.Extensions)
	return spec
}

func dial(target string, port int, proxy *url.URL, timeout time.Duration) (net.Conn, error) {
	if proxy == nil {
		return net.DialTimeout("tcp", fmt.Sprintf("%s:%d", target, port), timeout)
	}
	pport := proxy.Port()
	if pport == "" {
		pport = "80"
	}
	c, err := net.DialTimeout("tcp", net.JoinHostPort(proxy.Hostname(), pport), timeout)
	if err != nil {
		return nil, fmt.Errorf("proxy dial: %w", err)
	}
	c.SetDeadline(time.Now().Add(timeout))
	req := fmt.Sprintf("CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\n", target, port, target, port)
	if proxy.User != nil {
		pw, _ := proxy.User.Password()
		req += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(proxy.User.Username()+":"+pw)) + "\r\n"
	}
	req += "\r\n"
	if _, err := c.Write([]byte(req)); err != nil {
		return nil, err
	}
	br := bufio.NewReader(c)
	line, err := br.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("proxy response: %w", err)
	}
	if !strings.Contains(line, " 200") {
		return nil, fmt.Errorf("proxy CONNECT failed: %s", strings.TrimSpace(line))
	}
	for {
		l, err := br.ReadString('\n')
		if err != nil || l == "\r\n" || l == "\n" {
			break
		}
	}
	if br.Buffered() > 0 {
		return nil, fmt.Errorf("unexpected data after CONNECT")
	}
	c.SetDeadline(time.Time{})
	return c, nil
}

func tlsConn(raw net.Conn, host string) (*tls.UConn, error) {
	uc := tls.UClient(raw, &tls.Config{ServerName: host, NextProtos: []string{"http/1.1"}}, tls.HelloCustom)
	if err := uc.ApplyPreset(chromeSpec()); err != nil {
		return nil, err
	}
	if err := uc.Handshake(); err != nil {
		return nil, fmt.Errorf("tls handshake: %w", err)
	}
	return uc, nil
}

func readHTTPHead(r *bufio.Reader) (status string, headers map[string]string, err error) {
	status, err = r.ReadString('\n')
	if err != nil {
		return
	}
	headers = map[string]string{}
	for {
		l, e := r.ReadString('\n')
		if e != nil {
			return status, headers, e
		}
		l = strings.TrimRight(l, "\r\n")
		if l == "" {
			return strings.TrimSpace(status), headers, nil
		}
		if i := strings.Index(l, ":"); i > 0 {
			headers[strings.ToLower(strings.TrimSpace(l[:i]))] = strings.TrimSpace(l[i+1:])
		}
	}
}

func fingerprint(proxy *url.URL) error {
	raw, err := dial("tls.peet.ws", 443, proxy, 20*time.Second)
	if err != nil {
		return err
	}
	c, err := tlsConn(raw, "tls.peet.ws")
	if err != nil {
		return err
	}
	req := "GET /api/all HTTP/1.1\r\nHost: tls.peet.ws\r\nConnection: close\r\nUser-Agent: " + userAgent + "\r\nAccept: */*\r\n\r\n"
	c.Write([]byte(req))
	br := bufio.NewReader(c)
	status, _, err := readHTTPHead(br)
	if err != nil {
		return err
	}
	body, _ := io.ReadAll(br)
	// chunked or not, the JSON is findable
	i := bytes.IndexByte(body, '{')
	var j struct {
		TLS struct {
			JA4        string `json:"ja4"`
			JA3        string `json:"ja3"`
			Extensions []struct {
				Name string `json:"name"`
			} `json:"extensions"`
		} `json:"tls"`
	}
	if i < 0 || json.Unmarshal(bytes.TrimSpace(body[i:]), &j) != nil {
		// chunked encoding leaves size lines; strip them crudely
		clean := bytes.Buffer{}
		for _, ln := range bytes.Split(body[i:], []byte("\r\n")) {
			if len(ln) == 0 || isHex(ln) {
				continue
			}
			clean.Write(ln)
		}
		if err := json.Unmarshal(clean.Bytes(), &j); err != nil {
			return fmt.Errorf("%s: parse body: %w", status, err)
		}
	}
	fmt.Printf("status: %s\nja4: %s\nja3: %s\nextensions (%d):", status, j.TLS.JA4, j.TLS.JA3, len(j.TLS.Extensions))
	for _, e := range j.TLS.Extensions {
		fmt.Printf(" %s;", strings.Fields(e.Name)[0])
	}
	fmt.Println()
	return nil
}

func isHex(b []byte) bool {
	for _, c := range b {
		if !strings.ContainsRune("0123456789abcdefABCDEF", rune(c)) {
			return false
		}
	}
	return true
}

func emit(w *bufio.Writer, data string) {
	b, _ := json.Marshal(map[string]any{"t": time.Now().UnixMilli(), "d": data})
	w.Write(b)
	w.WriteByte('\n')
	w.Flush()
}

func main() {
	rawURL := flag.String("url", "", "websocket URL")
	proxyStr := flag.String("proxy", os.Getenv("PROXY_URL"), "http proxy url")
	origin := flag.String("origin", "", "Origin header (default: scheme+host of url)")
	fp := flag.Bool("fp", false, "print our TLS fingerprint via tls.peet.ws and exit")
	cookie := flag.String("cookie", os.Getenv("WS_COOKIE"), "Cookie header value (e.g. cf_clearance=...)")
	ua := flag.String("ua", os.Getenv("WS_UA"), "override User-Agent (must match the browser that minted the cookie)")
	flag.Parse()

	var proxy *url.URL
	if *proxyStr != "" {
		p, err := url.Parse(*proxyStr)
		if err != nil {
			fatal(2, "bad proxy url: %v", err)
		}
		proxy = p
	}
	if *ua != "" {
		userAgent = *ua
	}
	if *fp {
		if err := fingerprint(proxy); err != nil {
			fatal(2, "fingerprint: %v", err)
		}
		return
	}
	if *rawURL == "" {
		fatal(2, "-url is required")
	}
	u, err := url.Parse(*rawURL)
	if err != nil {
		fatal(2, "bad url: %v", err)
	}
	host := u.Hostname()
	port := 443
	if u.Port() != "" {
		fmt.Sscanf(u.Port(), "%d", &port)
	}
	if *origin == "" {
		*origin = "https://" + host
	}

	raw, err := dial(host, port, proxy, 20*time.Second)
	if err != nil {
		fatal(3, "dial: %v", err)
	}
	conn, err := tlsConn(raw, host)
	if err != nil {
		fatal(3, "%v", err)
	}

	keyBytes := make([]byte, 16)
	rand.Read(keyBytes)
	key := base64.StdEncoding.EncodeToString(keyBytes)
	path := u.RequestURI()
	// Chrome's exact header order for a websocket upgrade.
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"Connection: Upgrade\r\n" +
		"Pragma: no-cache\r\n" +
		"Cache-Control: no-cache\r\n" +
		"User-Agent: " + userAgent + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Origin: " + *origin + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Accept-Encoding: gzip, deflate, br, zstd\r\n" +
		"Accept-Language: en-US,en;q=0.9\r\n" +
		cookieLine(*cookie) +
		"Sec-WebSocket-Key: " + key + "\r\n" +
		"Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n" +
		"\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		fatal(3, "write upgrade: %v", err)
	}
	br := bufio.NewReader(conn)
	status, headers, err := readHTTPHead(br)
	if err != nil {
		fatal(3, "read upgrade response: %v", err)
	}
	if !strings.Contains(status, " 101") {
		fatal(4, "upgrade refused: %s cf-mitigated=%q cf-ray=%q ua=%q proxy=%v", status, headers["cf-mitigated"], headers["cf-ray"], userAgent, proxy != nil)
	}
	deflate := strings.Contains(headers["sec-websocket-extensions"], "permessage-deflate")
	fmt.Fprintf(os.Stderr, "connected: %s deflate=%v\n", status, deflate)

	out := bufio.NewWriter(os.Stdout)
	send := func(s string) error { return wsutil.WriteClientText(conn, []byte(s)) }

	// stdin -> frames
	go func() {
		sc := bufio.NewScanner(os.Stdin)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		for sc.Scan() {
			if line := strings.TrimSpace(sc.Text()); line != "" {
				if err := send(line); err != nil {
					fatal(5, "send: %v", err)
				}
			}
		}
	}()

	// frames -> stdout, with per-message inflate if the server negotiated it
	rw := io.ReadWriter(struct {
		io.Reader
		io.Writer
	}{br, conn})
	var msg bytes.Buffer
	var compressed bool
	// permessage-deflate with context takeover (the default we offer, as Chrome
	// does): the server's LZ77 window persists across messages, so each message
	// may back-reference the previous ones' plaintext. Inflating each message
	// with the last 32 KiB of decompressed output as the dictionary reproduces
	// that window. Servers that use no_context_takeover never reference it, so
	// the same code handles both.
	var window []byte
	for {
		hdr, err := ws.ReadHeader(rw)
		if err != nil {
			fatal(5, "read: %v", err)
		}
		payload := make([]byte, hdr.Length)
		if _, err := io.ReadFull(rw, payload); err != nil {
			fatal(5, "read payload: %v", err)
		}
		if hdr.Masked {
			ws.Cipher(payload, hdr.Mask, 0)
		}
		switch hdr.OpCode {
		case ws.OpPing:
			ws.WriteFrame(rw, ws.MaskFrame(ws.NewPongFrame(payload)))
			continue
		case ws.OpClose:
			fatal(6, "server closed: %q", string(payload))
		case ws.OpText, ws.OpBinary:
			msg.Reset()
			compressed = hdr.Rsv1()
		}
		msg.Write(payload)
		if !hdr.Fin {
			continue
		}
		data := msg.Bytes()
		if compressed && deflate {
			fr := flate.NewReaderDict(bytes.NewReader(append(append([]byte{}, data...), 0x00, 0x00, 0xff, 0xff)), window)
			inflated, err := io.ReadAll(fr)
			if err != nil && err != io.ErrUnexpectedEOF && len(inflated) == 0 {
				fatal(5, "inflate: %v", err)
			}
			window = append(window, inflated...)
			if len(window) > 32768 {
				window = append([]byte(nil), window[len(window)-32768:]...)
			}
			data = inflated
		}
		s := string(data)
		// engine.io keepalive + socket.io namespace connect
		if s == "2" {
			send("3")
		} else if strings.HasPrefix(s, "0{") {
			send("40")
		}
		emit(out, s)
	}
}

func cookieLine(c string) string {
	if c == "" {
		return ""
	}
	return "Cookie: " + c + "\r\n"
}

func fatal(code int, format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(code)
}
