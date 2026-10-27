package tunnelcore

import "testing"

type testPlatform struct{}

func (testPlatform) ApplyNetworkSettings(string) error    { return nil }
func (testPlatform) StartMonitor(InterfaceListener) error { return nil }
func (testPlatform) StopMonitor() error                   { return nil }
func (testPlatform) Interfaces() (string, error) {
	return `[{"name":"en0","index":5,"mtu":1500,"flags":65,"type":0,"addresses":["192.0.2.2/24"]}]`, nil
}
func TestInterfacesPreserveAddressAndFlags(t *testing.T) {
	a := &adapter{native: testPlatform{}}
	it, err := a.GetInterfaces()
	if err != nil {
		t.Fatal(err)
	}
	if !it.HasNext() {
		t.Fatal("missing interface")
	}
	v := it.Next()
	if v.Name != "en0" || v.Index != 5 || v.Flags != 65 || v.Addresses.Len() != 1 || v.Addresses.Next() != "192.0.2.2/24" || it.HasNext() {
		t.Fatal("interface mapping lost data")
	}
}
func TestPinnedConfigValidation(t *testing.T) {
	good := `{"dns":{"servers":[{"type":"udp","tag":"local","server":"223.5.5.5"}],"final":"local"},"inbounds":[{"type":"tun","tag":"crossbow-tun","address":["172.19.0.1/30","fdfe:dcba:9876::1/126"],"auto_route":true,"strict_route":true,"mtu":1500,"stack":"gvisor"}],"outbounds":[{"type":"direct","tag":"direct"}],"route":{"auto_detect_interface":true,"rules":[{"protocol":"dns","action":"hijack-dns"}],"final":"direct"}}`
	if err := Check(good); err != nil {
		t.Fatal(err)
	}
	if err := Check(`{"outbounds":[{"type":"not-a-protocol"}]}`); err == nil {
		t.Fatal("unknown protocol accepted")
	}
}
