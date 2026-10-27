// Package tunnelcore adapts the pinned libbox API to a small native interface.
package tunnelcore

import (
	"encoding/json"
	"errors"
	"github.com/sagernet/sing-box/experimental/libbox"
	"os"
	"path/filepath"
	"sync"
)

const Version = "1.14.4"

type Platform interface {
	ApplyNetworkSettings(settings string) error
	StartMonitor(listener InterfaceListener) error
	StopMonitor() error
	Interfaces() (string, error)
}
type InterfaceListener interface {
	Update(name string, index int32, expensive bool, constrained bool)
}
type Engine struct {
	mu       sync.Mutex
	server   *libbox.CommandServer
	platform *adapter
}

func NewEngine(platform Platform, directory string) (*Engine, error) {
	if platform == nil {
		return nil, errors.New("missing platform")
	}
	for _, d := range []string{directory, filepath.Join(directory, "work"), filepath.Join(directory, "temp")} {
		if err := os.MkdirAll(d, 0700); err != nil {
			return nil, err
		}
	}
	if err := libbox.Setup(&libbox.SetupOptions{BasePath: directory, WorkingPath: filepath.Join(directory, "work"), TempPath: filepath.Join(directory, "temp"), LogMaxLines: 200, CrashReportSource: "CrossbowTunnel", AppVersion: "0.1.0", OomKillerEnabled: true}); err != nil {
		return nil, err
	}
	a := &adapter{native: platform}
	server, err := libbox.NewCommandServer(a, a)
	if err != nil {
		return nil, err
	}
	// The server object hosts the service. Do not call Start(): no control socket.
	return &Engine{server: server, platform: a}, nil
}
func (e *Engine) Start(config string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.server == nil {
		return errors.New("engine closed")
	}
	return e.server.StartOrReloadService(config, &libbox.OverrideOptions{})
}
func (e *Engine) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.server != nil {
		_ = e.server.CloseService()
		e.server.Close()
		e.server = nil
	}
	_ = e.platform.native.StopMonitor()
}
func Check(config string) error { return libbox.CheckConfig(config) }

type prefix struct {
	Address string `json:"address"`
	Mask    string `json:"mask"`
	Prefix  int32  `json:"prefix"`
}
type settings struct {
	MTU      int32    `json:"mtu"`
	DNS      []string `json:"dns"`
	IPv4     []prefix `json:"ipv4"`
	IPv6     []prefix `json:"ipv6"`
	Routes4  []prefix `json:"routes4"`
	Routes6  []prefix `json:"routes6"`
	Exclude4 []prefix `json:"exclude4"`
	Exclude6 []prefix `json:"exclude6"`
}

func prefixes(it libbox.RoutePrefixIterator) (out []prefix) {
	for it != nil && it.HasNext() {
		p := it.Next()
		out = append(out, prefix{p.Address(), p.Mask(), p.Prefix()})
	}
	return
}

type adapter struct{ native Platform }

func (a *adapter) OpenTun(o libbox.TunOptions) (int32, error) {
	if !o.GetAutoRoute() {
		return -1, errors.New("auto_route is required")
	}
	if o.IsHTTPProxyEnabled() {
		return -1, errors.New("HTTP proxy inbound unsupported")
	}
	dns, err := o.GetDNSServerAddress()
	if err != nil {
		return -1, err
	}
	s := settings{MTU: o.GetMTU(), IPv4: prefixes(o.GetInet4Address()), IPv6: prefixes(o.GetInet6Address()), Routes4: prefixes(o.GetInet4RouteAddress()), Routes6: prefixes(o.GetInet6RouteAddress()), Exclude4: prefixes(o.GetInet4RouteExcludeAddress()), Exclude6: prefixes(o.GetInet6RouteExcludeAddress())}
	for dns != nil && dns.HasNext() {
		s.DNS = append(s.DNS, dns.Next())
	}
	data, err := json.Marshal(s)
	if err != nil {
		return -1, err
	}
	if err = a.native.ApplyNetworkSettings(string(data)); err != nil {
		return -1, err
	}
	// Upstream socket-based utun lookup avoids private packetFlow KVC access.
	fd := libbox.GetTunnelFileDescriptor()
	if fd < 0 {
		return -1, errors.New("tunnel descriptor unavailable")
	}
	return fd, nil
}
func (*adapter) LocalDNSTransport() libbox.LocalDNSTransport { return nil }
func (*adapter) UsePlatformAutoDetectInterfaceControl() bool { return false }
func (*adapter) AutoDetectInterfaceControl(int32) error      { return nil }
func (*adapter) UnderNetworkExtension() bool                 { return true }
func (*adapter) IncludeAllNetworks() bool                    { return false }
func (*adapter) ReadWIFIState() *libbox.WIFIState            { return nil }
func (*adapter) ClearDNSCache()                              {}
func (*adapter) RegisterMyInterface(string)                  {}
func (*adapter) SendNotification(*libbox.Notification) error {
	return errors.New("system notifications unavailable")
}
func (*adapter) CancelNotification(string, int32) error { return nil }
func (*adapter) FindConnectionOwner(int32, string, int32, string, int32) (*libbox.ConnectionOwner, error) {
	return nil, errors.New("process rules unavailable")
}
func (*adapter) StartNeighborMonitor(libbox.NeighborUpdateListener) error {
	return errors.New("neighbor monitor unavailable")
}
func (*adapter) CloseNeighborMonitor(libbox.NeighborUpdateListener) error { return nil }
func (*adapter) UsePlatformShell() bool                                   { return false }
func (*adapter) CheckPlatformShell() error                                { return errors.New("shell unavailable") }
func (*adapter) OpenShellSession(*libbox.PlatformUser, string, libbox.StringIterator, string, int32, int32) (libbox.ShellSession, error) {
	return nil, errors.New("shell unavailable")
}
func (*adapter) LookupUser(string) (*libbox.PlatformUser, error) {
	return nil, errors.New("user lookup unavailable")
}
func (*adapter) LookupSFTPServer() (string, error)     { return "", errors.New("SFTP unavailable") }
func (*adapter) ReadSystemSSHHostKey() (string, error) { return "", errors.New("SSH unavailable") }
func (*adapter) TailscaleHostname() string             { return "Crossbow" }
func (*adapter) UsePlatformBridge() bool               { return false }
func (*adapter) CreateBridge(*libbox.BridgeOptions) (libbox.BridgeSession, error) {
	return nil, errors.New("bridge unavailable")
}
func (*adapter) ServiceStop() error   { return errors.New("use system VPN control") }
func (*adapter) ServiceReload() error { return errors.New("use app control") }
func (*adapter) GetSystemProxyStatus() (*libbox.SystemProxyStatus, error) {
	return &libbox.SystemProxyStatus{}, nil
}
func (*adapter) SetSystemProxyEnabled(bool) error { return errors.New("system proxy unavailable") }
func (*adapter) TriggerNativeCrash() error        { return errors.New("disabled") }
func (*adapter) WriteDebugMessage(string)         {}
func (*adapter) ConnectSSHAgent() (int32, error)  { return -1, errors.New("SSH unavailable") }

type listener struct {
	target libbox.InterfaceUpdateListener
}

func (l *listener) Update(name string, index int32, expensive bool, constrained bool) {
	l.target.UpdateDefaultInterface(name, index, expensive, constrained)
}
func (a *adapter) StartDefaultInterfaceMonitor(l libbox.InterfaceUpdateListener) error {
	return a.native.StartMonitor(&listener{l})
}
func (a *adapter) CloseDefaultInterfaceMonitor(libbox.InterfaceUpdateListener) error {
	return a.native.StopMonitor()
}

type networkInterface struct {
	Name      string   `json:"name"`
	Index     int32    `json:"index"`
	MTU       int32    `json:"mtu"`
	Flags     int32    `json:"flags"`
	Type      int32    `json:"type"`
	Addresses []string `json:"addresses"`
}
type stringIterator struct {
	values []string
	index  int
}

func (i *stringIterator) Len() int32    { return int32(len(i.values)) }
func (i *stringIterator) HasNext() bool { return i.index < len(i.values) }
func (i *stringIterator) Next() string  { v := i.values[i.index]; i.index++; return v }

type interfaceIterator struct {
	values []*libbox.NetworkInterface
	index  int
}

func (i *interfaceIterator) HasNext() bool { return i.index < len(i.values) }
func (i *interfaceIterator) Next() *libbox.NetworkInterface {
	v := i.values[i.index]
	i.index++
	return v
}
func (a *adapter) GetInterfaces() (libbox.NetworkInterfaceIterator, error) {
	raw, err := a.native.Interfaces()
	if err != nil {
		return nil, err
	}
	var items []networkInterface
	if err = json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, err
	}
	it := &interfaceIterator{}
	for _, n := range items {
		it.values = append(it.values, &libbox.NetworkInterface{Name: n.Name, Index: n.Index, MTU: n.MTU, Flags: n.Flags, Type: n.Type, Addresses: &stringIterator{values: n.Addresses}})
	}
	return it, nil
}
