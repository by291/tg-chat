use std::{future::Future, io, net::SocketAddr};

use reqwest::{
    Client, Response, StatusCode, Url,
    dns::{Name, Resolve as DnsResolve, Resolving},
    header::{ACCEPT, ACCEPT_ENCODING, CONTENT_ENCODING, CONTENT_TYPE, LOCATION},
};
use serde::Serialize;
use url::Host;

use crate::link_preview_address::{is_public_host, is_public_ip};

#[path = "metadata.rs"]
mod metadata;

const MAX_REDIRECTS: usize = 3;
const MAX_HTML_BYTES: usize = 512 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum FetchError {
    Rejected,
    Unavailable,
}

#[derive(Debug, Default, Serialize)]
pub(super) struct Preview {
    pub(super) site_name: String,
    pub(super) title: String,
    pub(super) summary: String,
}

enum PageResponse {
    Redirect(String),
    Html(Vec<u8>),
}

struct RejectUnpinnedHost;

impl DnsResolve for RejectUnpinnedHost {
    fn resolve(&self, _name: Name) -> Resolving {
        Box::pin(async { Err(io::Error::other("Preview address was not pinned").into()) })
    }
}

/// Downloads the bounded HTML of a public web page.
pub(super) async fn fetch_html(url: &str) -> Result<Vec<u8>, FetchError> {
    fetch_with(url, resolve_domain, get_page).await
}

/// Parses bounded display metadata from the fetched HTML.
pub(super) fn parse_html(html: &[u8]) -> Result<Preview, FetchError> {
    metadata::extract(html)
}

async fn fetch_with<Resolve, Resolved, Get, Received>(
    url: &str,
    mut resolve: Resolve,
    mut get: Get,
) -> Result<Vec<u8>, FetchError>
where
    Resolve: FnMut(String, u16) -> Resolved,
    Resolved: Future<Output = Result<Vec<SocketAddr>, FetchError>>,
    Get: FnMut(Url, Vec<SocketAddr>) -> Received,
    Received: Future<Output = Result<PageResponse, FetchError>>,
{
    let mut url = Url::parse(url).map_err(|_| FetchError::Rejected)?;
    for redirect_count in 0..=MAX_REDIRECTS {
        url.set_fragment(None);

        // Resolve and validate every hop, including same-host redirects, before any connection.
        let addresses = validated_addresses(&url, &mut resolve).await?;
        match get(url.clone(), addresses).await? {
            PageResponse::Html(html) => return Ok(html),
            PageResponse::Redirect(location) if redirect_count < MAX_REDIRECTS => {
                url = url.join(&location).map_err(|_| FetchError::Rejected)?;
            }
            PageResponse::Redirect(_) => return Err(FetchError::Unavailable),
        }
    }

    Err(FetchError::Unavailable)
}

async fn validated_addresses<Resolve, Resolved>(
    url: &Url,
    resolve: &mut Resolve,
) -> Result<Vec<SocketAddr>, FetchError>
where
    Resolve: FnMut(String, u16) -> Resolved,
    Resolved: Future<Output = Result<Vec<SocketAddr>, FetchError>>,
{
    let has_credentials = !url.username().is_empty() || url.password().is_some();
    if !matches!(url.scheme(), "http" | "https") || url.port().is_some() || has_credentials {
        return Err(FetchError::Rejected);
    }

    let port = url.port_or_known_default().ok_or(FetchError::Rejected)?;
    let host = url.host().ok_or(FetchError::Rejected)?;
    if !is_public_host(&host) {
        return Err(FetchError::Rejected);
    }

    let addresses = match host {
        Host::Ipv4(address) => vec![SocketAddr::new(address.into(), port)],
        Host::Ipv6(address) => vec![SocketAddr::new(address.into(), port)],
        Host::Domain(domain) => resolve(domain.trim_end_matches('.').to_owned(), port).await?,
    };

    // A mixed DNS answer is unsafe even if the connector would try its public address first.
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(FetchError::Rejected);
    }

    Ok(addresses)
}

async fn resolve_domain(domain: String, port: u16) -> Result<Vec<SocketAddr>, FetchError> {
    // A fully qualified lookup prevents local DNS search suffixes from changing the name.
    let absolute_name = format!("{domain}.");
    let addresses = tokio::net::lookup_host((absolute_name, port))
        .await
        .map_err(|_| FetchError::Unavailable)?;

    Ok(addresses.collect())
}

async fn get_page(url: Url, addresses: Vec<SocketAddr>) -> Result<PageResponse, FetchError> {
    let client = pinned_client(&url, &addresses)?;
    let request = client.get(url).header(ACCEPT, "text/html");
    let request = request.header(ACCEPT_ENCODING, "identity");
    let response = request.send().await.map_err(|_| FetchError::Unavailable)?;

    read_page(response).await
}

fn pinned_client(url: &Url, addresses: &[SocketAddr]) -> Result<Client, FetchError> {
    let client = Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none());
    let client = client.retry(reqwest::retry::never()).no_gzip().no_brotli();
    let client = client.no_zstd().no_deflate().dns_resolver(RejectUnpinnedHost);

    // Keep the original hostname for TLS verification and Host while disabling DNS fallback.
    let client = match url.domain() {
        Some(domain) => client.resolve_to_addrs(domain, addresses),
        None => client,
    };

    client.build().map_err(|_| FetchError::Unavailable)
}

async fn read_page(mut response: Response) -> Result<PageResponse, FetchError> {
    let status = response.status();
    if matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    ) {
        let location = response.headers().get(LOCATION).ok_or(FetchError::Unavailable)?;
        let location = location.to_str().map_err(|_| FetchError::Unavailable)?;
        return Ok(PageResponse::Redirect(location.to_owned()));
    }

    if !status.is_success() || !has_plain_html(&response) {
        return Err(FetchError::Unavailable);
    }

    let mut html = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| FetchError::Unavailable)? {
        // The streaming count also covers responses without a Content-Length header.
        if chunk.len() > MAX_HTML_BYTES - html.len() {
            return Err(FetchError::Unavailable);
        }

        html.extend_from_slice(&chunk);
    }

    Ok(PageResponse::Html(html))
}

fn has_plain_html(response: &Response) -> bool {
    let headers = response.headers();
    let encodings = headers.get_all(CONTENT_ENCODING);
    let is_identity =
        encodings.iter().all(|encoding| encoding.as_bytes().eq_ignore_ascii_case(b"identity"));
    let content_type = headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok());
    let media_type = content_type.and_then(|value| value.split(';').next());

    is_identity && media_type.is_some_and(|value| value.trim().eq_ignore_ascii_case("text/html"))
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
