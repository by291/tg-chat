use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use url::Host;

// Azure routes this otherwise public-looking address to its VM host services.
const AZURE_WIRESERVER: Ipv4Addr = Ipv4Addr::new(168, 63, 129, 16);
const BLOCKED_DNS_SUFFIXES: &[&str] =
    &["localhost", "local", "internal", "home.arpa", "onion", "invalid", "test"];

fn is_public_dns_name(domain: &str) -> bool {
    domain.contains('.')
        && !BLOCKED_DNS_SUFFIXES.iter().any(|suffix| {
            let prefix = domain.strip_suffix(suffix);
            domain == *suffix || prefix.is_some_and(|prefix| prefix.ends_with('.'))
        })
}

/// Check every resolved address before the connector can use it.
pub(crate) fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    if address == AZURE_WIRESERVER {
        return false;
    }

    // Reject special-use and documentation ranges, including shared carrier address space.
    !matches!(
        address.octets(),
        [0 | 10 | 127 | 224..=255, ..]
            | [100, 64..=127, ..]
            | [169, 254, ..]
            | [172, 16..=31, ..]
            | [192, 0, 0 | 2, _]
            | [192, 88, 99, _]
            | [192, 168, ..]
            | [198, 18 | 19, ..]
            | [198, 51, 100, _]
            | [203, 0, 113, _]
    )
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let is_global_unicast = matches!(segments, [0x2000..=0x3fff, ..]);
    // The global range also contains transition mechanisms and special-purpose allocations.
    let is_special_use = matches!(
        segments,
        [0x2001, 0..=0x01ff | 0x0db8, ..] | [0x2002, ..] | [0x3fff, 0..=0x0fff, ..]
    );

    is_global_unicast && !is_special_use
}

/// Reject known private or special-use hosts before attempting DNS.
pub(crate) fn is_public_host(host: &Host<&str>) -> bool {
    match host {
        Host::Ipv4(address) => is_public_ip((*address).into()),
        Host::Ipv6(address) => is_public_ip((*address).into()),
        Host::Domain(domain) => is_public_dns_name(domain.trim_end_matches('.')),
    }
}
