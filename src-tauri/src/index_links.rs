use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use unicode_normalization::UnicodeNormalization;

pub(super) struct WikiRef {
    pub target: String,
    pub heading: Option<String>,
    pub block: Option<String>,
    pub alias: Option<String>,
}

/// 只接受 Markdown parser 识别出的 wiki-link，代码、转义及 HTML 注释不形成链接。
pub(super) fn extract_wiki_links(content: &str) -> Vec<WikiRef> {
    let options = Options::ENABLE_WIKILINKS | Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_MATH;
    Parser::new_ext(content, options).into_offset_iter().filter_map(|(event, range)| {
        match event {
            Event::Start(Tag::Link { link_type: LinkType::WikiLink { .. }, .. })
            | Event::Start(Tag::Image { link_type: LinkType::WikiLink { .. }, .. }) => {}
            _ => return None,
        }
        let raw = content.get(range)?;
        let raw = raw.strip_prefix('!').unwrap_or(raw);
        let inner = raw.strip_prefix("[[")?.strip_suffix("]]")?;
        parse_wiki_ref(inner)
    }).collect()
}

fn parse_wiki_ref(inner: &str) -> Option<WikiRef> {
    if inner.contains(['\n', '\r']) { return None; }
    let (spec, alias) = match inner.find('|') {
        Some(p) => (&inner[..p], Some(inner[p + 1..].trim().to_string())),
        None => (inner, None),
    };
    let hash = spec.find('#');
    let caret = spec.find('^');
    let target_end = [hash, caret].iter().filter_map(|x| *x).min().unwrap_or(spec.len());
    let target: String = spec[..target_end].trim().nfc().collect();
    if target.is_empty() { return None; }
    let heading = hash.map(|h| {
        let end = caret.filter(|c| *c > h).unwrap_or(spec.len());
        spec[h + 1..end].trim().nfc().collect()
    });
    let block = caret.map(|c| spec[c + 1..].trim().nfc().collect());
    Some(WikiRef { target, heading, block, alias })
}
