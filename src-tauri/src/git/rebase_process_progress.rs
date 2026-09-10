use std::time::{Duration, Instant};

const LINE_LIMIT: usize = 4 * 1024;
const INTERVAL: Duration = Duration::from_millis(100);

pub(super) struct Progress<'a> {
    callback: &'a mut dyn FnMut(&str),
    segment: Vec<u8>,
    pending: Option<String>,
    last_sent: Option<Instant>,
}

impl<'a> Progress<'a> {
    pub(super) fn new(callback: &'a mut dyn FnMut(&str)) -> Self {
        Self { callback, segment: Vec::new(), pending: None, last_sent: None }
    }

    fn complete_segment(&mut self) {
        if self.segment.is_empty() { return; }
        let mut text = String::from_utf8_lossy(&self.segment).into_owned();
        self.segment.clear();
        if text.len() > LINE_LIMIT {
            let mut end = LINE_LIMIT;
            while !text.is_char_boundary(end) { end -= 1; }
            text.truncate(end);
        }
        let line = text.trim();
        if !line.is_empty() { self.pending = Some(line.to_owned()); }
    }

    pub(super) fn push(&mut self, bytes: &[u8], now: Instant) {
        for &byte in bytes {
            if matches!(byte, b'\r' | b'\n') {
                self.complete_segment();
                self.tick(now);
            } else if self.segment.len() < LINE_LIMIT {
                self.segment.push(byte);
            }
        }
    }

    pub(super) fn tick(&mut self, now: Instant) {
        if self.last_sent.is_none_or(|sent| now.saturating_duration_since(sent) >= INTERVAL) {
            self.emit(now);
        }
    }

    fn emit(&mut self, now: Instant) {
        if let Some(line) = self.pending.take() {
            (self.callback)(&line);
            self.last_sent = Some(now);
        }
    }

    pub(super) fn finish(&mut self) {
        self.complete_segment();
        self.emit(Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_progress_keeps_the_latest_line_and_limits_invalid_utf8_expansion() {
        let mut lines = Vec::new();
        {
            let mut callback = |line: &str| lines.push(line.to_string());
            let mut progress = Progress::new(&mut callback);
            let now = Instant::now();
            progress.push(b"first\r\n", now);
            for index in 0..1000 { progress.push(format!("item {index}\r").as_bytes(), now + Duration::from_millis(1)); }
            progress.tick(now + INTERVAL);
            progress.push(&vec![0xff; LINE_LIMIT * 8], now + INTERVAL);
            progress.finish();
        }
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "first");
        assert_eq!(lines[1], "item 999");
        assert!(!lines[2].is_empty() && lines[2].len() <= LINE_LIMIT);
    }

    #[test]
    fn partial_utf8_and_carriage_returns_are_joined_before_reporting() {
        let mut lines = Vec::new();
        {
            let mut callback = |line: &str| lines.push(line.to_string());
            let mut progress = Progress::new(&mut callback);
            let now = Instant::now();
            let text = "接收对象 42%".as_bytes();
            progress.push(&text[..2], now);
            progress.push(&text[2..], now);
            progress.push(b"\r\n", now);
            progress.finish();
        }
        assert_eq!(lines, vec!["接收对象 42%"]);
    }
}
