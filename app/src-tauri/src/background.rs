//! Throttle background sampling while retaining prompt native-window resume.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

static CONTENT_EDITING: AtomicBool = AtomicBool::new(false);
static CONTENT_REVISION: AtomicU64 = AtomicU64::new(0);

/// App-driven installs/removals/saves must not wait for the idle scan interval.
pub fn content_changed() { CONTENT_REVISION.fetch_add(1, Ordering::Relaxed); }
pub fn content_revision() -> u64 { CONTENT_REVISION.load(Ordering::Relaxed) }

#[tauri::command]
pub fn set_content_editing(active: bool) {
    CONTENT_EDITING.store(active, Ordering::Relaxed);
}

pub fn content_interval() -> u64 {
    if CONTENT_EDITING.load(Ordering::Relaxed) { 2 } else { 10 }
}

pub struct WorkSchedule {
    last: Instant,
    was_visible: bool,
}

impl WorkSchedule {
    pub fn new() -> Self {
        Self { last: Instant::now(), was_visible: true }
    }

    pub fn due(&mut self, visible: bool, foreground_secs: u64, background_secs: u64) -> bool {
        self.due_at(Instant::now(), visible, foreground_secs, background_secs)
    }

    fn due_at(&mut self, now: Instant, visible: bool, foreground_secs: u64, background_secs: u64) -> bool {
        let resumed = visible && !self.was_visible;
        self.was_visible = visible;
        let interval = Duration::from_secs(if visible { foreground_secs } else { background_secs });
        if resumed || now.duration_since(self.last) >= interval {
            self.last = now;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_work_is_throttled_and_resume_does_not_wait_for_the_background_interval() {
        let mut schedule = WorkSchedule::new();
        let start = schedule.last;
        for second in 1..5 {
            assert!(!schedule.due_at(start + Duration::from_secs(second), false, 1, 5));
        }
        assert!(schedule.due_at(start + Duration::from_secs(5), false, 1, 5));
        assert!(schedule.due_at(start + Duration::from_secs(6), true, 1, 5));
        assert!(!schedule.due_at(start + Duration::from_millis(6500), true, 1, 5));
    }

    #[test]
    fn entering_authoring_mode_uses_the_shorter_deadline() {
        let mut schedule = WorkSchedule::new();
        let start = schedule.last;
        assert!(!schedule.due_at(start + Duration::from_secs(3), true, 10, 30));
        assert!(schedule.due_at(start + Duration::from_secs(4), true, 2, 30));
    }
}
