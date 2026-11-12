//! Location-number reading (coverage suggestions) on synthetic plates, and the coverage line in Image Comments.
use weldscope_core::markers::{self, Belt, Read};
use weldscope_core::shots;

/// A film strip on empty background with lead numbers (less radiation = lower values) at an even pitch.
fn plate(numbers: &[u32], turns: u32) -> (Vec<i32>, usize, usize) {
    let (w, h) = (700 * numbers.len() + 300, 600usize);
    let mut a = vec![0i32; w * h];
    let mut seed = 7u32;
    for y in 40..h - 40 { for x in 30..w - 30 {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        a[y * w + x] = 3000 + ((seed >> 16) % 21) as i32 - 10 + (x as i32 / 40) % 7;
    } }
    let (dh, dw, gap) = (70usize, 46usize, 12usize);
    for (i, n) in numbers.iter().enumerate() {
        let text = n.to_string();
        let total = text.len() * dw + (text.len() - 1) * gap;
        let x0 = 300 + i * 700 - total / 2;
        for (j, ch) in text.bytes().enumerate() {
            let bmp = markers::digit_bitmap(0, (ch - b'0') as usize);
            for y in 0..dh { for x in 0..dw {
                let v = bmp[(y * 28 / dh) * 20 + x * 20 / dw] as i32;
                a[(120 + y) * w + x0 + j * (dw + gap) + x] -= v * 80 / 255;
            } }
        }
    }
    // turn clockwise `turns` quarter turns, as a plate scanned sideways would be stored
    let (mut a, mut w, mut h) = (a, w, h);
    for _ in 0..turns {
        let mut b = vec![0i32; w * h];
        for y in 0..h { for x in 0..w { b[x * h + (h - 1 - y)] = a[y * w + x]; } }
        a = b; std::mem::swap(&mut w, &mut h);
    }
    (a, w, h)
}

#[test]
fn reads_a_number_belt_in_any_quarter_turn() {
    for turns in 0..4 {
        let (a, w, h) = plate(&[0, 7, 14, 21, 28, 35], turns);
        let belts = markers::find_belts(&a, w, h, None, 0.1);
        assert_eq!(markers::coverage_text(&belts), "0-35", "turned {turns}: {belts:?}");
        assert_eq!((belts[0].step, belts[0].reads, belts[0].wraps), (7, 6, false));
        assert!(belts[0].confidence > 0.99);
    }
}

#[test]
fn reads_three_digit_numbers_and_a_belt_that_passes_zero() {
    let (a, w, h) = plate(&[105, 112, 119, 126, 0, 7], 0);
    let belts = markers::find_belts(&a, w, h, None, 0.1);
    assert_eq!(markers::coverage_text(&belts), "105-7", "{belts:?}");
    assert!(belts[0].wraps);
}

#[test]
fn a_plate_without_numbers_suggests_nothing() {
    let (a, w, h) = plate(&[], 0);
    assert!(markers::find_belts(&a, w, h, None, 0.1).is_empty());
    assert!(markers::find_belts(&vec![0; 16], 4, 4, None, 0.1).is_empty());
}

fn rd(x: f64, value: u32, score: f64) -> Read { Read { x, y: 100.0, h: 70.0, value, score } }

#[test]
fn the_row_check_corrects_misreads_and_rejects_rows_that_are_not_a_belt() {
    // 42 misread as 47 and 63 as 65: the even pitch and constant step put them right, at lower confidence
    let row = [rd(0.0, 35, 0.6), rd(690.0, 47, 0.5), rd(1380.0, 49, 0.7), rd(2070.0, 56, 0.8), rd(2760.0, 65, 0.5), rd(3450.0, 70, 0.8)];
    let b = markers::fit_rows(&row);
    assert_eq!((b[0].first, b[0].last, b[0].step), (35, 70, 7));
    assert!(b[0].confidence < 0.8 && b[0].confidence > 0.5);
    // two numbers missed in the middle of a belt that passes zero
    let b = markers::fit_rows(&[rd(0.0, 105, 0.7), rd(690.0, 112, 0.7), rd(1380.0, 119, 0.7), rd(3450.0, 7, 0.6)]);
    assert_eq!((b[0].first, b[0].last, b[0].wraps), (105, 7, true));
    // a belt that starts just before zero
    let b = markers::fit_rows(&[rd(0.0, 126, 0.7), rd(690.0, 0, 0.7), rd(1380.0, 7, 0.7), rd(2070.0, 14, 0.7)]);
    assert_eq!((b[0].first, b[0].last, b[0].wraps), (126, 14, true));
    // uneven spacing, no common step, too few numbers, weak reads: no suggestion
    assert!(markers::fit_rows(&[rd(0.0, 0, 0.7), rd(500.0, 7, 0.7), rd(1700.0, 14, 0.7), rd(1900.0, 21, 0.7)]).is_empty());
    assert!(markers::fit_rows(&[rd(0.0, 3, 0.7), rd(690.0, 91, 0.7), rd(1380.0, 12, 0.7)]).is_empty());
    assert!(markers::fit_rows(&[rd(0.0, 0, 0.7), rd(690.0, 7, 0.7)]).is_empty());
    assert!(markers::fit_rows(&[rd(0.0, 0, 0.2), rd(690.0, 7, 0.2), rd(1380.0, 14, 0.2)]).is_empty());
    assert_eq!(markers::coverage_text(&[Belt { first: 0, last: 35, step: 7, confidence: 1.0, reads: 6, wraps: false, y: 0.0 }, Belt { first: 35, last: 70, step: 7, confidence: 1.0, reads: 6, wraps: false, y: 9.0 }]), "0-35, 35-70");
}

#[test]
fn coverage_is_one_line_of_image_comments() {
    assert_eq!(shots::coverage_in(""), "");
    assert_eq!((shots::coverage_start("35-70"), shots::coverage_start(" 0-35, 35-70"), shots::coverage_start("98-7"), shots::coverage_start("A 12.5 to 20"), shots::coverage_start("none"), shots::coverage_start("")), (Some(35.0), Some(0.0), Some(98.0), Some(12.5), None, None));
    assert_eq!(shots::coverage_in("Piece 2\r\ncoverage:  35-70 \r\nchecked"), "35-70");
    assert_eq!(shots::with_coverage("", "0-35"), "Coverage: 0-35");
    assert_eq!(shots::with_coverage("Piece 2", " 0-35 "), "Piece 2\r\nCoverage: 0-35");
    assert_eq!(shots::with_coverage("Piece 2\r\nCoverage: 0-35\r\nchecked", "35-70"), "Piece 2\r\nchecked\r\nCoverage: 35-70");
    assert_eq!(shots::with_coverage("Piece 2\nCoverage: 0-35", ""), "Piece 2");
    assert!(shots::coverage_problem("0-35\n1").is_some() && shots::coverage_problem(&"9".repeat(65)).is_some() && shots::coverage_problem("0-35").is_none());

    let bytes = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/industrex-j2k.dcm")).unwrap();
    let mut shot = shots::load(&bytes, "a.dcm", "", 1).unwrap();
    let before = shot.text(shots::COMMENTS);
    shots::set_coverage(&mut shot, "0-35").unwrap();
    assert_eq!(shot.coverage(), "0-35");
    assert!(shot.is_edited() && shot.text(shots::COMMENTS).starts_with(before.trim_end()));
    shots::set_coverage(&mut shot, "35-70").unwrap();
    assert_eq!((shot.coverage().as_str(), shot.text(shots::COMMENTS).matches("Coverage").count()), ("35-70", 1));
    assert!(shots::set_coverage(&mut shot, "a\nb").is_err());
    shots::set_coverage(&mut shot, "").unwrap();
    assert_eq!((shot.coverage(), shot.text(shots::COMMENTS).trim_end().to_string()), (String::new(), before.trim_end().to_string()));
    // the saved copy carries it
    shots::set_coverage(&mut shot, "70-105").unwrap();
    let copy = shots::build_meta_copy(&shot).unwrap();
    assert_eq!(shots::load(&copy.bytes, "b.dcm", "", 2).unwrap().coverage(), "70-105");
}
