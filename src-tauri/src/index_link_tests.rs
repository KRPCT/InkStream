use super::extract_wiki_links;

fn targets(content: &str) -> Vec<String> {
    extract_wiki_links(content).into_iter().map(|r| r.target).collect()
}

#[test]
fn wiki_links_exclude_fenced_and_indented_code() {
    let markdown = "[[正文]]\n\n```md\n[[示例]]\n```\n\n~~~\n[[另一个示例]]\n~~~\n\n    [[缩进代码]]\n";
    assert_eq!(targets(markdown), vec!["正文"]);
}

#[test]
fn wiki_links_exclude_inline_code_escaped_openers_and_comments() {
    let markdown = "[[正文]] `[[代码]]` ``[[另一代码]]`` \\[[转义]] <!-- [[注释]] -->\n<!--\n[[多行注释]]\n-->\n[[仍是正文]]";
    assert_eq!(targets(markdown), vec!["正文", "仍是正文"]);
}

#[test]
fn wiki_link_targets_keep_nfc_and_existing_heading_alias_fields() {
    let refs = extract_wiki_links("[[Cafe\u{301}#章节^block|别名]] [[中文目录/页]]");
    assert_eq!(refs.len(), 2);
    assert_eq!(refs[0].target, "Café");
    assert_eq!(refs[0].heading.as_deref(), Some("章节"));
    assert_eq!(refs[0].block.as_deref(), Some("block"));
    assert_eq!(refs[0].alias.as_deref(), Some("别名"));
}

#[test]
fn local_equation_anchors_do_not_create_file_edges() {
    let refs = extract_wiki_links("[[#eq:energy]] [[#章节]] [[#^block]] [[paper#章节^block|原文]]");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].target, "paper");
    assert_eq!(refs[0].heading.as_deref(), Some("章节"));
    assert_eq!(refs[0].block.as_deref(), Some("block"));
    assert_eq!(refs[0].alias.as_deref(), Some("原文"));
}
