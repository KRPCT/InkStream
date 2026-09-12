//! Strict validation shared by conflict snapshot admission and resolution publishing.
fn marker(line: &str) -> Option<(u8, usize)> {
    let first = *line.as_bytes().first()?;
    if !b"<|=>".contains(&first) { return None; }
    let width = line.bytes().take_while(|byte| *byte == first).count();
    if width < 7 { return None; }
    let rest = &line.as_bytes()[width..];
    if !rest.is_empty() && (first == b'=' || !matches!(rest[0], b' ' | b'\t')) { return None; }
    Some((first, width))
}

pub(super) fn validate(content: &str) -> Result<usize, String> {
    let boundary = content.lines().any(|line| marker(line).is_some_and(|(kind, _)| kind != b'='));
    let mut active: Option<(usize, u8)> = None;
    let mut count = 0;
    for (line_number, line) in content.lines().enumerate() {
        let Some((kind, width)) = marker(line) else { continue; };
        let invalid = || format!("第 {} 行冲突标记损坏或顺序不完整，未允许写入/暂存。", line_number + 1);
        match active {
            None if kind == b'<' => active = Some((width, b'<')),
            None if kind == b'=' && !boundary => {},
            None => return Err(invalid()),
            Some((expected, _)) if expected != width => return Err(invalid()),
            Some((_, b'<')) if kind == b'|' => active = Some((width, b'|')),
            Some((_, b'<' | b'|')) if kind == b'=' => active = Some((width, b'=')),
            Some((_, b'=')) if kind == b'>' => { active = None; count += 1; },
            _ => return Err(invalid()),
        }
    }
    if active.is_some() { return Err("冲突标记未完整结束，未允许写入/暂存。".into()); }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::validate;
    #[test]
    fn complete_and_damaged_markers_keep_their_distinct_write_admission() {
        assert_eq!(validate("<<<<<<< a\r\nours\r\n||||||| base\r\nbase\r\n=======\r\ntheirs\r\n>>>>>>> b\r\n").unwrap(), 1);
        assert_eq!(validate("heading\n=======\nordinary <<<<<<< text\n<<<<<<<literal\n").unwrap(), 0);
        for source in ["<<<<<<< a\nx\n", "<<<<<<< a\nx\n>>>>>>> b\n", "<<<<<<< a\nx\n========\ny\n>>>>>>> b\n", "<<<<<<< a\n<<<<<<< a\n=======\nx\n>>>>>>> b\n", "=======\nx\n>>>>>>> b\n"] {
            assert!(validate(source).is_err(), "{source}");
        }
    }
}
