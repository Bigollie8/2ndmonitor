//! Category news headlines via public RSS — no API key (0.8.6).
//!
//! Two fixed publishers per category (BBC + The Guardian), fetched off the
//! main thread and merged. RSS is XML and the app's HTTP-tile pipeline is
//! JSON-only, which is why this is a built-in command rather than a
//! declarative bundle — that and the fact that BROKER_COMMANDS is
//! deliberately empty, so bundles cannot invoke commands at all.
//!
//! The parser is a minimal hand-rolled item extractor rather than an XML
//! crate: it handles exactly the two shapes the live feeds emit (verified
//! against both on 2026-08-05 — BBC wraps titles in CDATA, the Guardian uses
//! entity-escaped text) and is unit-tested on real captured fragments. If a
//! publisher ever changes shape, the tests say so before users do.

use serde::Serialize;

/// Fetch timeout per feed. One slow publisher must not stall the tile.
const FEED_TIMEOUT_SECS: u64 = 10;
/// Cap on returned headlines after merging.
const MAX_HEADLINES: usize = 24;
/// Response body cap — the largest live feed is ~370 KB; 2 MB is generous.
const BODY_CAP: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct Headline {
    pub title: String,
    pub link: String,
    /// Publisher display name ("BBC" / "The Guardian").
    pub source: String,
    /// RFC 2822 pubDate exactly as the feed gave it; display-only.
    pub published: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NewsResult {
    pub headlines: Vec<Headline>,
    /// Non-null only when EVERY feed failed. One publisher down still returns
    /// the other's items with no error.
    pub error: Option<String>,
}

/// Category → (source name, feed URL) pairs. Fixed at compile time: the URLs
/// are part of the app's network surface, the same way `net:<host>` is fixed
/// at authoring time for declarative tiles.
fn feeds_for(category: &str) -> Option<[(&'static str, &'static str); 2]> {
    Some(match category {
        "top" => [
            ("BBC", "https://feeds.bbci.co.uk/news/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/international/rss"),
        ],
        "world" => [
            ("BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/world/rss"),
        ],
        "politics" => [
            ("BBC", "https://feeds.bbci.co.uk/news/politics/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/politics/rss"),
        ],
        "business" => [
            ("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/uk/business/rss"),
        ],
        "tech" => [
            ("BBC", "https://feeds.bbci.co.uk/news/technology/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/uk/technology/rss"),
        ],
        "science" => [
            ("BBC", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/science/rss"),
        ],
        "sports" => [
            ("BBC", "https://feeds.bbci.co.uk/sport/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/uk/sport/rss"),
        ],
        "entertainment" => [
            ("BBC", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"),
            ("The Guardian", "https://www.theguardian.com/uk/culture/rss"),
        ],
        _ => return None,
    })
}

#[tauri::command]
pub async fn fetch_news_headlines(category: String) -> Result<NewsResult, String> {
    let Some(feeds) = feeds_for(&category) else {
        return Err(format!("unknown news category {category:?}"));
    };
    tokio::task::spawn_blocking(move || {
        let mut per_source: Vec<Vec<Headline>> = Vec::new();
        let mut errors: Vec<String> = Vec::new();
        for (source, url) in feeds {
            match fetch_feed(source, url) {
                Ok(items) => per_source.push(items),
                Err(e) => errors.push(format!("{source}: {e}")),
            }
        }
        if per_source.is_empty() {
            return NewsResult { headlines: vec![], error: Some(errors.join("; ")) };
        }
        NewsResult { headlines: interleave(per_source), error: None }
    })
    .await
    .map_err(|e| format!("join error: {e}"))
}

fn fetch_feed(source: &str, url: &str) -> Result<Vec<Headline>, String> {
    let body = ureq::get(url)
        .set("User-Agent", "SecondMonitorHub (+news tile; RSS reader)")
        .timeout(std::time::Duration::from_secs(FEED_TIMEOUT_SECS))
        .call()
        .map_err(|e| e.to_string())?
        .into_reader();
    use std::io::Read;
    let mut text = String::new();
    body.take(BODY_CAP)
        .read_to_string(&mut text)
        .map_err(|e| format!("read: {e}"))?;
    Ok(parse_rss_items(&text)
        .into_iter()
        .map(|(title, link, published)| Headline {
            title,
            link,
            source: source.to_string(),
            published,
        })
        .collect())
}

/// Alternate sources item-by-item so the tile isn't one publisher's block
/// followed by the other's, then cap.
fn interleave(mut per_source: Vec<Vec<Headline>>) -> Vec<Headline> {
    let mut out = Vec::new();
    let mut idx = 0;
    while out.len() < MAX_HEADLINES {
        let mut any = false;
        for list in per_source.iter_mut() {
            if idx < list.len() && out.len() < MAX_HEADLINES {
                out.push(std::mem::replace(&mut list[idx], Headline {
                    title: String::new(), link: String::new(),
                    source: String::new(), published: None,
                }));
                any = true;
            }
        }
        if !any {
            break;
        }
        idx += 1;
    }
    out
}

/// Extract (title, link, pubDate) from every `<item>` block. Handles the two
/// live shapes: CDATA-wrapped text (BBC) and entity-escaped text (Guardian).
fn parse_rss_items(xml: &str) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<item>").or_else(|| rest.find("<item ")) {
        let after = &rest[start..];
        let Some(end) = after.find("</item>") else { break };
        let item = &after[..end];
        let title = tag_text(item, "title");
        let link = tag_text(item, "link");
        let published = tag_text(item, "pubDate");
        if let (Some(title), Some(link)) = (title, link) {
            if !title.is_empty() && !link.is_empty() {
                out.push((title, link, published));
            }
        }
        rest = &after[end + "</item>".len()..];
    }
    out
}

/// First `<tag>…</tag>` in `scope`, CDATA unwrapped, entities decoded, trimmed.
fn tag_text(scope: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = scope.find(&open)? + open.len();
    let end = scope[start..].find(&close)? + start;
    let raw = scope[start..end].trim();
    let inner = raw
        .strip_prefix("<![CDATA[")
        .and_then(|s| s.strip_suffix("]]>"))
        .unwrap_or(raw);
    Some(decode_entities(inner.trim()))
}

/// The five predefined XML entities plus the numeric apostrophe — everything
/// the two live feeds emit. Deliberately NOT a general entity decoder.
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
}

#[cfg(test)]
mod tests {
    use super::{decode_entities, interleave, parse_rss_items, Headline};

    // Captured from the live BBC politics feed, 2026-08-05: CDATA title, link
    // with an escaped ampersand.
    const BBC: &str = r#"<rss><channel>
      <title>BBC News</title>
      <item>  <title><![CDATA[Burnham 'looking into' conducting inquiry, says minister]]></title>
        <description><![CDATA[Ignored.]]></description>
        <link>https://www.bbc.co.uk/news/articles/cx2j?at_medium=RSS&amp;at_campaign=rss</link>
        <pubDate>Tue, 05 Aug 2026 06:00:00 GMT</pubDate>
      </item>
      <item><title><![CDATA[Second story]]></title><link>https://bbc.example/2</link></item>
    </channel></rss>"#;

    // Captured from the live Guardian politics feed: plain entity-escaped
    // title, no CDATA.
    const GUARDIAN: &str = r#"<rss><channel>
      <item> <title>Women must not feel pressure to have &#39;ideal birth&#39;, says minister</title>
        <link>https://www.theguardian.com/society/2026/aug/05/example</link>
        <description>&lt;p&gt;Exclusive&lt;/p&gt;</description>
      </item>
    </channel></rss>"#;

    #[test]
    fn parses_the_bbc_shape_cdata_and_escaped_link() {
        let items = parse_rss_items(BBC);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].0, "Burnham 'looking into' conducting inquiry, says minister");
        // &amp; in the link decodes; the channel-level <title> is not an item.
        assert_eq!(items[0].1, "https://www.bbc.co.uk/news/articles/cx2j?at_medium=RSS&at_campaign=rss");
        assert_eq!(items[0].2.as_deref(), Some("Tue, 05 Aug 2026 06:00:00 GMT"));
        assert_eq!(items[1].2, None);
    }

    #[test]
    fn parses_the_guardian_shape_plain_entities() {
        let items = parse_rss_items(GUARDIAN);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].0, "Women must not feel pressure to have 'ideal birth', says minister");
    }

    #[test]
    fn malformed_xml_yields_nothing_rather_than_panicking() {
        assert!(parse_rss_items("").is_empty());
        assert!(parse_rss_items("<item><title>unclosed").is_empty());
        assert!(parse_rss_items("<item></item>").is_empty()); // no title/link
        assert!(parse_rss_items("not xml at all").is_empty());
    }

    #[test]
    fn entities_decode_only_the_predefined_set() {
        assert_eq!(decode_entities("A &amp; B &lt;3 &quot;x&quot;"), "A & B <3 \"x\"");
        // Unknown entities pass through untouched rather than guessing.
        assert_eq!(decode_entities("&nbsp;stay"), "&nbsp;stay");
    }

    #[test]
    fn interleave_alternates_sources_and_caps() {
        let mk = |s: &str, n: usize| -> Vec<Headline> {
            (0..n).map(|i| Headline {
                title: format!("{s}{i}"), link: "l".into(),
                source: s.into(), published: None,
            }).collect()
        };
        let out = interleave(vec![mk("a", 3), mk("b", 2)]);
        let titles: Vec<&str> = out.iter().map(|h| h.title.as_str()).collect();
        assert_eq!(titles, ["a0", "b0", "a1", "b1", "a2"]);
        // Cap: 20 + 20 in, MAX_HEADLINES out.
        assert_eq!(interleave(vec![mk("a", 20), mk("b", 20)]).len(), super::MAX_HEADLINES);
    }
}
