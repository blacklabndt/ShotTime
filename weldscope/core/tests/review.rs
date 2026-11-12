//! The interpreter's review of possible-indication marks and its file.
use weldscope_core::indications::Indication;
use weldscope_core::review::{self as rv, Mark, Review, ReviewFile, Verdict};

fn cand(x: f64, score: f32, class: usize) -> Indication { Indication { x0: x, y0: 100.0, x1: x + 16.0, y1: 116.0, score, finder: score, class } }

#[test]
fn shown_marks_follow_the_cut_off_and_keep_judged_ones() {
    let mut r = Review::default();
    r.merge_found(&[cand(0.0, 0.9, 1), cand(100.0, 0.4, 2), cand(200.0, 0.15, 6)]);
    assert_eq!(r.shown(0.31), vec![0, 1]);
    assert_eq!(r.marks[1].guess, "slag");
    r.marks[2].verdict = Verdict::NotIndication; // judged at a higher sensitivity: stays visible when turned down
    r.marks.push(Mark { x0: 300.0, y0: 100.0, x1: 330.0, y1: 110.0, manual: true, verdict: Verdict::Indication, kind: "undercut".into(), ..Default::default() });
    assert_eq!(r.shown(0.31), vec![0, 1, 2, 3], "strongest first, added by hand last");
    assert_eq!(r.counts(0.31), (1, 1, 2));
}

#[test]
fn searching_again_keeps_every_judgement() {
    let mut r = Review::default();
    r.merge_found(&[cand(0.0, 0.9, 1), cand(100.0, 0.4, 2)]);
    r.marks[0].verdict = Verdict::Indication; r.marks[0].kind = "slag".into();
    r.marks.push(Mark { x0: 300.0, y0: 100.0, x1: 330.0, y1: 110.0, manual: true, verdict: Verdict::Indication, kind: "crack".into(), ..Default::default() });
    r.merge_found(&[cand(2.0, 0.88, 1), cand(100.0, 0.41, 2), cand(500.0, 0.3, 1), cand(304.0, 0.5, 6)]);
    assert_eq!(r.marks.iter().filter(|m| m.verdict == Verdict::Indication && m.kind == "slag").count(), 1);
    assert_eq!(r.marks.len(), 5, "judged mark not repeated; a finder mark over a hand-added one is still listed");
    assert!(r.marks.iter().any(|m| m.manual && m.kind == "crack"));
    assert_eq!(r.marks.iter().filter(|m| !m.judged()).count(), 3);
}

#[test]
fn review_file_round_trip_and_safety() {
    let dir = std::env::temp_dir().join(format!("ws-review-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let path = dir.join("Edited").join(rv::FILE_NAME);
    assert_eq!(rv::load(&path).unwrap(), ReviewFile::default(), "a missing file is an empty review");
    let mut r = Review { file: "a.dcm".into(), sop: "1.2.3".into(), cols: 4000, rows: 600, px_mm: 0.1, sensitivity: 3, ..Default::default() };
    r.merge_found(&[cand(0.0, 0.9, 1), cand(100.0, 0.2, 2)]);
    r.marks[0].verdict = Verdict::NotIndication;
    assert!(r.worth_saving());
    let mut f = ReviewFile::default();
    f.reviews.insert(r.sop.clone(), r.for_file(0.31));
    rv::save(&path, &f).unwrap();
    let back = rv::load(&path).unwrap();
    assert_eq!(back, f);
    assert_eq!(back.reviews["1.2.3"].marks.len(), 1, "a faint mark that was never shown is not recorded");
    assert!(!path.with_extension("json.tmp").exists());
    // a damaged or newer file is refused, not replaced
    std::fs::write(&path, b"{ not json").unwrap();
    assert!(rv::load(&path).is_err());
    std::fs::write(&path, br#"{"version":2,"about":"","reviews":{}}"#).unwrap();
    assert!(rv::load(&path).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn nothing_to_save_until_something_is_judged() {
    let mut r = Review::default();
    r.merge_found(&[cand(0.0, 0.9, 1)]);
    assert!(!r.worth_saving());
}

#[test]
fn overlapping_candidates_are_all_kept() {
    let mut r = Review::default();
    r.merge_found(&[cand(0.0, 0.9, 1), cand(2.0, 0.8, 1), cand(4.0, 0.7, 2)]);
    assert_eq!(r.marks.len(), 3, "the list must match the finder's own ranked list");
}
