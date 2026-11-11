use std::{future::ready, net::SocketAddr};

use reqwest::Url;
use reqwest::header::{CONTENT_TYPE, LOCATION};

use super::{FetchError, PageResponse, fetch_with, parse_html, read_page};

const PUBLIC_ADDRESS: &str = "8.8.8.8:443";
const HTML: &str = r#"
    <title>Fallback title</title>
    <meta property="og:title" content="  A &amp; B  ">
    <meta property="og:site_name" content=" Test Site ">
    <meta name="description" content=" Plain summary ">
    <img src="https://images.example/thumbnail.png">
"#;

#[tokio::test]
async fn returns_bounded_text_metadata_from_one_document_request() {
    let mut requests = Vec::new();
    let html = fetch_with(
        "https://public.example/start",
        |_, _| ready(Ok(vec![PUBLIC_ADDRESS.parse().unwrap()])),
        |url, addresses| {
            requests.push((url, addresses));
            ready(Ok(PageResponse::Html(HTML.as_bytes().to_vec())))
        },
    )
    .await
    .unwrap();

    let preview = parse_html(&html).unwrap();
    assert_eq!(preview.title, "A & B");
    assert_eq!(preview.summary, "Plain summary");
    assert_eq!(preview.site_name, "Test Site");
    assert_eq!(
        requests,
        [(
            Url::parse("https://public.example/start").unwrap(),
            vec![PUBLIC_ADDRESS.parse::<SocketAddr>().unwrap()],
        )],
    );
}

#[tokio::test]
async fn rejects_a_hostname_if_any_dns_answer_is_nonpublic() {
    let outcome = fetch_with(
        "https://public.example/",
        |_, _| ready(Ok(vec![PUBLIC_ADDRESS.parse().unwrap(), "[::1]:443".parse().unwrap()])),
        |_, _| async { panic!("a mixed address set must never reach the connector") },
    )
    .await;

    assert_eq!(outcome.unwrap_err(), FetchError::Rejected);
}

#[tokio::test]
async fn resolves_the_same_hostname_again_before_following_a_redirect() {
    let mut answers =
        [vec![PUBLIC_ADDRESS.parse().unwrap()], vec!["[fd00::1]:443".parse().unwrap()]].into_iter();
    let mut requested_paths = Vec::new();
    let outcome = fetch_with(
        "https://public.example/start",
        |_, _| ready(Ok(answers.next().unwrap())),
        |url, _| {
            requested_paths.push(url.path().to_owned());
            ready(Ok(PageResponse::Redirect("/redirected".to_owned())))
        },
    )
    .await;

    assert_eq!(outcome.unwrap_err(), FetchError::Rejected);
    assert_eq!(requested_paths, ["/start"]);
}

#[tokio::test]
async fn rejects_nonpublic_literals_and_nondefault_ports_before_network_io() {
    for url in [
        "http://127.0.0.1/",
        "http://100.64.0.1/",
        "http://169.254.1.1/",
        "http://168.63.129.16/",
        "http://[::ffff:127.0.0.1]/",
        "http://[64:ff9b::7f00:1]/",
        "http://[2001:db8::1]/",
        "https://public.example:8443/",
        "https://user:password@public.example/",
        "file:///example",
    ] {
        let outcome = fetch_with(
            url,
            |_, _| ready(Err(FetchError::Unavailable)),
            |_, _| ready(Err(FetchError::Unavailable)),
        )
        .await;
        assert_eq!(outcome.unwrap_err(), FetchError::Rejected, "{url}");
    }
}

#[tokio::test]
async fn never_follows_more_than_three_redirects() {
    let mut requests = 0;
    let outcome = fetch_with(
        "https://public.example/start",
        |_, _| ready(Ok(vec![PUBLIC_ADDRESS.parse().unwrap()])),
        |_, _| {
            requests += 1;
            ready(Ok(PageResponse::Redirect("/redirected".to_owned())))
        },
    )
    .await;

    assert_eq!(outcome.unwrap_err(), FetchError::Unavailable);
    assert_eq!(requests, 4);
}

#[tokio::test]
async fn rejects_a_document_larger_than_512_kib_even_without_content_length() {
    let body = vec![b' '; 512 * 1024 + 1];
    let response =
        axum::http::Response::builder().header(CONTENT_TYPE, "text/html").body(body).unwrap();

    assert!(matches!(read_page(response.into()).await, Err(FetchError::Unavailable)));
}

#[tokio::test]
async fn accepts_an_html_response_at_the_size_limit() {
    let body = vec![b' '; 512 * 1024];
    let response = axum::http::Response::builder()
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .body(body)
        .unwrap();

    assert!(matches!(read_page(response.into()).await, Ok(PageResponse::Html(_))));
}

#[tokio::test]
async fn extracts_a_relative_redirect_without_reading_its_body_as_html() {
    let response = axum::http::Response::builder()
        .status(302)
        .header(LOCATION, "/redirected")
        .body(Vec::<u8>::new())
        .unwrap();

    assert!(matches!(
        read_page(response.into()).await,
        Ok(PageResponse::Redirect(location)) if location == "/redirected"
    ));
}

#[test]
fn does_not_publish_a_card_with_only_a_site_name() {
    let outcome = parse_html(br#"<meta property="og:site_name" content="Site">"#);

    assert_eq!(outcome.unwrap_err(), FetchError::Unavailable);
}

#[test]
fn bounds_display_fields_without_splitting_unicode() {
    let site_name = "站".repeat(101);
    let title = "题".repeat(201);
    let summary = "文".repeat(501);
    let html = format!(
        r#"
        <meta property="og:site_name" content="{site_name}">
        <title>{title}</title>
        <meta name="description" content="{summary}">
        "#
    );

    let preview = parse_html(html.as_bytes()).unwrap();

    assert_eq!(preview.site_name, "站".repeat(100));
    assert_eq!(preview.title, "题".repeat(200));
    assert_eq!(preview.summary, "文".repeat(500));
}
