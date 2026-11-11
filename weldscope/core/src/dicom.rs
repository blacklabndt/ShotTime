//! DICOM / DICONDE file reading and writing. Values are held as little-endian bytes so a file can be written
//! back without loss. Output is always Explicit VR Little Endian, except compressed (encapsulated) files whose
//! image data is unchanged (or re-encoded), which keep their compressed transfer syntax.
//!
//! Ported from the browser prototype (diconde-editor/dicom.js), whose output the owner confirmed opens in
//! INDUSTREX 7.2.1. Keep the two in step when changing rules here.

use regex::Regex;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::OnceLock;

pub const TS_IMPLICIT_LE: &str = "1.2.840.10008.1.2";
pub const TS_EXPLICIT_LE: &str = "1.2.840.10008.1.2.1";
pub const TS_DEFLATED: &str = "1.2.840.10008.1.2.1.99";
pub const TS_EXPLICIT_BE: &str = "1.2.840.10008.1.2.2";
pub const TS_J2K_LOSSLESS: &str = "1.2.840.10008.1.2.4.90";

pub fn ts_name(ts: &str) -> &str {
    match ts {
        "1.2.840.10008.1.2" => "Implicit VR Little Endian",
        "1.2.840.10008.1.2.1" => "Explicit VR Little Endian",
        "1.2.840.10008.1.2.1.99" => "Deflated Explicit VR Little Endian",
        "1.2.840.10008.1.2.2" => "Explicit VR Big Endian",
        "1.2.840.10008.1.2.4.50" => "JPEG Baseline",
        "1.2.840.10008.1.2.4.51" => "JPEG Extended",
        "1.2.840.10008.1.2.4.57" => "JPEG Lossless",
        "1.2.840.10008.1.2.4.70" => "JPEG Lossless SV1",
        "1.2.840.10008.1.2.4.80" => "JPEG-LS Lossless",
        "1.2.840.10008.1.2.4.81" => "JPEG-LS Near-Lossless",
        "1.2.840.10008.1.2.4.90" => "JPEG 2000 Lossless",
        "1.2.840.10008.1.2.4.91" => "JPEG 2000",
        "1.2.840.10008.1.2.5" => "RLE Lossless",
        "1.2.840.10008.1.2.4.201" => "HTJ2K Lossless",
        "1.2.840.10008.1.2.4.202" => "HTJ2K Lossless RPCL",
        "1.2.840.10008.1.2.4.203" => "HTJ2K",
        other => other,
    }
}

const UNDEF: u32 = 0xFFFF_FFFF;
const ITEM: u32 = 0xFFFE_E000;
const ITEM_DELIM: u32 = 0xFFFE_E00D;
const SEQ_DELIM: u32 = 0xFFFE_E0DD;
pub const PIXEL: u32 = 0x7FE0_0010;
pub const IMPL_UID: &str = "2.25.233198034562290651734618273591028374211";
pub const IMPL_NAME: &str = "WELDSCOPE_2";

const LONG_VRS: &[&str] = &["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "SV", "UC", "UN", "UR", "UT", "UV"];
const STRING_VRS: &[&str] = &["AE", "AS", "CS", "DA", "DS", "DT", "IS", "LO", "LT", "PN", "SH", "ST", "TM", "UC", "UI", "UR", "UT"];
const SINGLE_TEXT: &[&str] = &["LT", "ST", "UT", "UR"]; // backslash is ordinary text here

pub fn is_string_vr(vr: &str) -> bool { STRING_VRS.contains(&vr) }
pub fn is_single_text(vr: &str) -> bool { SINGLE_TEXT.contains(&vr) }
fn is_long_vr(vr: &str) -> bool { LONG_VRS.contains(&vr) }
fn num_size(vr: &str) -> Option<usize> {
    match vr { "US" | "SS" => Some(2), "UL" | "SL" | "FL" => Some(4), "FD" | "SV" | "UV" => Some(8), _ => None }
}
fn swap_size(vr: &str) -> Option<usize> {
    match vr { "US" | "SS" | "OW" | "AT" => Some(2), "UL" | "SL" | "FL" | "OF" | "OL" => Some(4), "FD" | "OD" | "SV" | "UV" | "OV" => Some(8), _ => None }
}
fn max_len(vr: &str) -> Option<usize> {
    match vr {
        "AE" => Some(16), "AS" => Some(4), "CS" => Some(16), "DA" => Some(8), "DS" => Some(16), "DT" => Some(26), "IS" => Some(12),
        "LO" => Some(64), "LT" => Some(10240), "PN" => Some(64), "SH" => Some(16), "ST" => Some(1024), "TM" => Some(16), "UI" => Some(64),
        _ => None,
    }
}

/// Two-letter value representation.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Vr(pub [u8; 2]);
impl Vr {
    pub fn new(s: &str) -> Vr { let b = s.as_bytes(); Vr([b[0], b[1]]) }
    pub fn as_str(&self) -> &str { std::str::from_utf8(&self.0).unwrap_or("UN") }
}
impl fmt::Debug for Vr { fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { write!(f, "{}", self.as_str()) } }
impl fmt::Display for Vr { fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { write!(f, "{}", self.as_str()) } }

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Bytes(Vec<u8>),
    Items(Vec<Dataset>),
    /// Encapsulated pixel data: the Basic Offset Table item, then the fragments, byte for byte.
    Fragments(Vec<Vec<u8>>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Element { pub tag: u32, pub vr: Vr, pub value: Value }
impl Element {
    pub fn bytes(&self) -> Option<&[u8]> { if let Value::Bytes(b) = &self.value { Some(b) } else { None } }
    pub fn items(&self) -> Option<&Vec<Dataset>> { if let Value::Items(i) = &self.value { Some(i) } else { None } }
    pub fn items_mut(&mut self) -> Option<&mut Vec<Dataset>> { if let Value::Items(i) = &mut self.value { Some(i) } else { None } }
    pub fn fragments(&self) -> Option<&Vec<Vec<u8>>> { if let Value::Fragments(f) = &self.value { Some(f) } else { None } }
    pub fn raw(tag: u32, vr: &str, b: Vec<u8>) -> Element { Element { tag, vr: Vr::new(vr), value: Value::Bytes(b) } }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Dataset { pub el: BTreeMap<u32, Element> }

#[derive(Clone, Debug, PartialEq)]
pub struct DicomFile { pub meta: Dataset, pub ds: Dataset, pub transfer_syntax: String }
impl DicomFile {
    pub fn encapsulated(&self) -> bool { self.ds.el.get(&PIXEL).map_or(false, |p| p.fragments().is_some()) }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DicomError(pub String);
impl fmt::Display for DicomError { fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str(&self.0) } }
impl std::error::Error for DicomError {}
pub type Result<T> = std::result::Result<T, DicomError>;
fn err<T>(s: impl Into<String>) -> Result<T> { Err(DicomError(s.into())) }

// ---------------------------------------------------------------- dictionary
// Data dictionary: tag, VR, keyword. Names only help display; explicit-VR files supply their own VR.
const DICT_SRC: &str = "00020000 UL FileMetaInformationGroupLength|00020001 OB FileMetaInformationVersion|00020002 UI MediaStorageSOPClassUID|00020003 UI MediaStorageSOPInstanceUID|00020010 UI TransferSyntaxUID|00020012 UI ImplementationClassUID|00020013 SH ImplementationVersionName|00020016 AE SourceApplicationEntityTitle
00080005 CS SpecificCharacterSet|00080008 CS ImageType|00080012 DA InstanceCreationDate|00080013 TM InstanceCreationTime|00080016 UI SOPClassUID|00080018 UI SOPInstanceUID|00080020 DA StudyDate|00080021 DA SeriesDate|00080022 DA AcquisitionDate|00080023 DA ContentDate|00080030 TM StudyTime|00080031 TM SeriesTime|00080032 TM AcquisitionTime|00080033 TM ContentTime|00080050 SH AccessionNumber|00080060 CS Modality|00080064 CS ConversionType|00080070 LO Manufacturer|00080080 LO InstitutionName|00080081 ST InstitutionAddress|00080090 PN ReferringPhysicianName|00081010 SH StationName|00081030 LO StudyDescription|0008103E LO SeriesDescription|00081040 LO InstitutionalDepartmentName|00081050 PN PerformingPhysicianName|00081070 PN OperatorsName|00081090 LO ManufacturerModelName|00081150 UI ReferencedSOPClassUID|00081155 UI ReferencedSOPInstanceUID|00082111 ST DerivationDescription|00082112 SQ SourceImageSequence
00100010 PN PatientName|00100020 LO PatientID|00100021 LO IssuerOfPatientID|00100030 DA PatientBirthDate|00100040 CS PatientSex|00101000 LO OtherPatientIDs|00101001 PN OtherPatientNames|00102160 SH EthnicGroup|00104000 LT PatientComments
00140025 ST ComponentManufacturingProcedure|00140028 ST ComponentManufacturer|00140030 DS MaterialThickness|00140032 DS MaterialPipeDiameter|00140034 DS MaterialIsolationDiameter|00140042 ST MaterialGrade|00140044 ST MaterialPropertiesDescription|00140046 LT MaterialNotes|00140050 CS ComponentShape|00140052 CS CurvatureType|00140054 DS OuterDiameter|00140056 DS InnerDiameter|00142002 SQ EvaluatorSequence|00142004 IS EvaluatorNumber|00142006 PN EvaluatorName|00143011 DS InternalDetectorFrameTime|00143012 DS NumberOfFramesIntegrated|00143099 LT CalibrationNotes
00180015 CS BodyPartExamined|00180060 DS KVP|00181000 LO DeviceSerialNumber|00181004 LO PlateID|00181020 LO SoftwareVersions|00181110 DS DistanceSourceToDetector|00181111 DS DistanceSourceToPatient|00181150 IS ExposureTime|00181151 IS XRayTubeCurrent|00181152 IS Exposure|00181164 DS ImagerPixelSpacing|00181400 LO AcquisitionDeviceProcessingDescription
0020000D UI StudyInstanceUID|0020000E UI SeriesInstanceUID|00200010 SH StudyID|00200011 IS SeriesNumber|00200012 IS AcquisitionNumber|00200013 IS InstanceNumber|00200020 CS PatientOrientation|00204000 LT ImageComments
00280002 US SamplesPerPixel|00280004 CS PhotometricInterpretation|00280006 US PlanarConfiguration|00280008 IS NumberOfFrames|00280010 US Rows|00280011 US Columns|00280030 DS PixelSpacing|00280034 IS PixelAspectRatio|00280100 US BitsAllocated|00280101 US BitsStored|00280102 US HighBit|00280103 US PixelRepresentation|00280106 US SmallestImagePixelValue|00280107 US LargestImagePixelValue|00281040 CS PixelIntensityRelationship|00281041 SS PixelIntensityRelationshipSign|00281050 DS WindowCenter|00281051 DS WindowWidth|00281052 DS RescaleIntercept|00281053 DS RescaleSlope|00281054 LO RescaleType|00282110 CS LossyImageCompression|00282112 DS LossyImageCompressionRatio|00282114 CS LossyImageCompressionMethod
00321060 LO RequestedProcedureDescription|00400244 DA PerformedProcedureStepStartDate|00400254 LO PerformedProcedureStepDescription|00080068 CS PresentationIntentType|00080100 SH CodeValue|00080102 SH CodingSchemeDesignator|00080104 LO CodeMeaning|00081048 PN PhysiciansOfRecord|00081060 PN NameOfPhysiciansReadingStudy
00141010 ST ActualEnvironmentalConditions|00141020 DA ExpiryDate|00141040 ST EnvironmentalConditions|001440A0 LO ImageQualityIndicatorType|001440A1 LO ImageQualityIndicatorMaterial|001440A2 LO ImageQualityIndicatorSize|00140101 CS SecondaryApprovalStatus|00140102 DA SecondaryReviewDate|00140103 TM SecondaryReviewTime|00143040 SQ DarkCurrentSequence|00143050 OB DarkCurrentCounts|00143060 SQ GainCorrectionReferenceSequence|00143070 OB AirCounts|00143080 OB BadPixelImage
00180010 LO ContrastBolusAgent|00181153 IS ExposureInuAs|00181160 SH FilterType|00181180 SH CollimatorGridName|00181190 DS FocalSpots|00181260 SH PlateType|00181261 LO PhosphorType|00181402 CS CassetteOrientation|00181403 CS CassetteSize|00181404 US ExposuresOnPlate|00185101 CS ViewPosition|00186000 DS Sensitivity|00187004 CS DetectorType|00187005 CS DetectorConfiguration|00187006 LT DetectorDescription|00187008 LT DetectorMode|0018700A SH DetectorID|0018700C DA DateOfLastDetectorCalibration|0018702A LO DetectorManufacturerName|0018702B LO DetectorManufacturerModelName
00200052 UI FrameOfReferenceUID|00280120 US PixelPaddingValue|00280301 CS BurnedInAnnotation|00324000 LT StudyComments|00380300 LO CurrentPatientLocation|00880200 SQ IconImageSequence|20500020 CS PresentationLUTShape|300E0002 CS ApprovalStatus|300E0004 DA ReviewDate|300E0005 TM ReviewTime|300E0008 PN ReviewerName|7FE00010 OW PixelData";

pub struct DictEntry { pub vr: &'static str, pub keyword: &'static str }

pub fn dict() -> &'static BTreeMap<u32, DictEntry> {
    static D: OnceLock<BTreeMap<u32, DictEntry>> = OnceLock::new();
    D.get_or_init(|| {
        let mut m = BTreeMap::new();
        for s in DICT_SRC.split(|c| c == '|' || c == '\n') {
            let mut p = s.trim().split(' ');
            let (t, vr, kw) = (p.next().unwrap(), p.next().unwrap(), p.next().unwrap());
            m.insert(u32::from_str_radix(t, 16).unwrap(), DictEntry { vr, keyword: kw });
        }
        m
    })
}

/// DICONDE (ASTM E2339) names for reused DICOM tags, as listed in Carestream's INDUSTREX DICOM/DICONDE
/// Conformance Statement (rev. 10.0, 2017).
pub fn nde_name(t: u32) -> Option<&'static str> {
    Some(match t {
        0x00100010 => "Component Name", 0x00100020 => "Component ID Number", 0x00100021 => "Component ID Issuer",
        0x00100030 => "Component Manufacturing Date", 0x00101000 => "Other Component IDs", 0x00101001 => "Other Component Names",
        0x00102160 => "Material Name", 0x00104000 => "Component Notes", 0x00380300 => "Volume Description",
        0x00080090 => "Component Owner Name", 0x00081048 => "Inspecting Company Name", 0x00081060 => "Certifying Inspector Name",
        0x00081050 => "Inspector Name", 0x00081070 => "Operator Name", 0x00180015 => "Part Examined", 0x00324000 => "Examination Notes",
        0x00080080 => "Company Name", 0x00080081 => "Company Address", 0x00081040 => "Department", 0x00200020 => "Component Orientation",
        _ => return None,
    })
}

pub fn tag_hex(t: u32) -> String { format!("({:04X},{:04X})", t >> 16, t & 0xFFFF) }
pub fn hex8(t: u32) -> String { format!("{:08x}", t) }

fn words(kw: &str) -> String {
    static R1: OnceLock<Regex> = OnceLock::new();
    static R2: OnceLock<Regex> = OnceLock::new();
    let s = R1.get_or_init(|| Regex::new("([a-z])([A-Z])").unwrap()).replace_all(kw, "$1 $2").into_owned();
    let s = R2.get_or_init(|| Regex::new("([A-Z]+)([A-Z][a-z])").unwrap()).replace_all(&s, "$1 $2").into_owned();
    s.replace("I Ds", "IDs")
}

#[derive(Clone, Debug)]
pub struct TagInfo { pub vr: Option<&'static str>, pub keyword: &'static str, pub dicom_name: String, pub nde_name: &'static str, pub name: String }

pub fn tag_info(t: u32) -> TagInfo {
    let d = dict().get(&t);
    let dicom = match d { Some(d) => words(d.keyword), None => if (t >> 16) & 1 == 1 { "Private tag".into() } else { "Unknown tag".into() } };
    let nde = nde_name(t).unwrap_or("");
    TagInfo { vr: d.map(|d| d.vr), keyword: d.map_or("", |d| d.keyword), name: if nde.is_empty() { dicom.clone() } else { nde.to_string() }, dicom_name: dicom, nde_name: nde }
}

pub fn parse_tag(s: &str) -> Option<u32> {
    static R: OnceLock<Regex> = OnceLock::new();
    let s = s.trim();
    if let Some(m) = R.get_or_init(|| Regex::new(r"(?i)^\(?\s*([0-9a-f]{4})\s*,?\s*([0-9a-f]{4})\s*\)?$").unwrap()).captures(s) {
        return Some((u32::from_str_radix(&m[1], 16).unwrap() << 16) | u32::from_str_radix(&m[2], 16).unwrap());
    }
    dict().iter().find(|(_, d)| d.keyword.eq_ignore_ascii_case(s)).map(|(t, _)| *t)
}

pub fn find_tags_by_text(q: &str) -> Vec<u32> {
    let q = q.to_lowercase();
    dict().iter().filter(|(t, d)| {
        let i = tag_info(**t);
        format!("{} {} {} {}", i.name, i.dicom_name, d.keyword, tag_hex(**t)).to_lowercase().contains(&q)
    }).map(|(t, _)| *t).collect()
}

// ---------------------------------------------------------------- reading
struct Reader<'a> { b: std::borrow::Cow<'a, [u8]>, p: usize, le: bool }
impl<'a> Reader<'a> {
    fn need(&self, n: usize) -> Result<()> {
        if self.p + n > self.b.len() { return err("File ends unexpectedly (truncated or not a DICOM file)."); }
        Ok(())
    }
    fn u16(&mut self) -> Result<u16> {
        self.need(2)?;
        let a = [self.b[self.p], self.b[self.p + 1]];
        self.p += 2;
        Ok(if self.le { u16::from_le_bytes(a) } else { u16::from_be_bytes(a) })
    }
    fn u32(&mut self) -> Result<u32> {
        self.need(4)?;
        let a = [self.b[self.p], self.b[self.p + 1], self.b[self.p + 2], self.b[self.p + 3]];
        self.p += 4;
        Ok(if self.le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) })
    }
    fn tag(&mut self) -> Result<u32> { let g = self.u16()? as u32; let e = self.u16()? as u32; Ok((g << 16) | e) }
    fn bytes(&mut self, n: usize) -> Result<Vec<u8>> { self.need(n)?; let v = self.b[self.p..self.p + n].to_vec(); self.p += n; Ok(v) }
}

fn swap_bytes(b: &mut [u8], size: usize) { for c in b.chunks_exact_mut(size) { c.reverse(); } }

fn read_dataset(r: &mut Reader, explicit: bool, end: usize, until_item_delim: bool, stop_group: Option<u16>) -> Result<Dataset> {
    let mut ds = Dataset::default();
    while r.p < end {
        let start = r.p;
        if let Some(g) = stop_group { if r.p + 2 <= end && u16::from_le_bytes([r.b[r.p], r.b[r.p + 1]]) != g { break; } }
        let tag = r.tag()?;
        if tag == ITEM_DELIM { r.u32()?; if until_item_delim { return Ok(ds); } continue; }
        if tag == SEQ_DELIM { r.u32()?; continue; }
        let (mut vr, len): (String, u32);
        if explicit && (tag >> 16) != 0xFFFE {
            r.need(2)?;
            let (c0, c1) = (r.b[r.p], r.b[r.p + 1]);
            if c0.is_ascii_uppercase() && c1.is_ascii_uppercase() {
                vr = String::from_utf8(vec![c0, c1]).unwrap();
                r.p += 2;
                if is_long_vr(&vr) { r.p += 2; len = r.u32()?; } else { len = r.u16()? as u32; }
            } else { vr = tag_info(tag).vr.unwrap_or("UN").to_string(); len = r.u32()?; }
        } else {
            len = r.u32()?;
            vr = tag_info(tag).vr.unwrap_or("UN").to_string();
        }
        let value;
        if vr == "SQ" || (len == UNDEF && vr == "UN" && tag != PIXEL) {
            let items_explicit = if vr == "SQ" { explicit } else { false };
            let saved = r.le;
            if vr == "UN" { r.le = true; }
            vr = "SQ".into();
            value = Value::Items(read_sequence(r, items_explicit, len)?);
            r.le = saved;
        } else if tag == PIXEL && len == UNDEF {
            vr = "OB".into();
            let mut frags = Vec::new();
            loop {
                let t = r.tag()?; let l = r.u32()?;
                if t == SEQ_DELIM { break; }
                if t != ITEM { return err("Damaged compressed image data."); }
                frags.push(r.bytes(l as usize)?);
            }
            value = Value::Fragments(frags);
        } else {
            if len == UNDEF { return err(format!("Unsupported undefined length at {}.", tag_hex(tag))); }
            let mut v = r.bytes(len as usize)?;
            if !r.le { if let Some(s) = swap_size(&vr) { swap_bytes(&mut v, s); } }
            value = Value::Bytes(v);
        }
        if r.p <= start { return err("Parser made no progress."); }
        ds.el.insert(tag, Element { tag, vr: Vr::new(&vr), value });
    }
    Ok(ds)
}

fn read_sequence(r: &mut Reader, explicit: bool, len: u32) -> Result<Vec<Dataset>> {
    let end = if len == UNDEF { r.b.len() } else { r.p + len as usize };
    let mut items = Vec::new();
    while r.p < end {
        let t = r.tag()?; let l = r.u32()?;
        if t == SEQ_DELIM { break; }
        if t != ITEM { return err(format!("Damaged sequence item at byte {}.", r.p - 8)); }
        let blen = r.b.len();
        items.push(if l == UNDEF { read_dataset(r, explicit, blen, true, None)? } else { let e = r.p + l as usize; read_dataset(r, explicit, e, false, None)? });
    }
    Ok(items)
}

pub fn parse(bytes: &[u8]) -> Result<DicomFile> {
    let mut r = Reader { b: std::borrow::Cow::Borrowed(bytes), p: 0, le: true };
    let has_preamble = bytes.len() >= 132 && &bytes[128..132] == b"DICM";
    let mut meta = Dataset::default();
    let mut ts: String;
    if has_preamble {
        r.p = 132;
        meta = read_dataset(&mut r, true, bytes.len(), false, Some(0x0002))?;
        ts = get_string(&meta, 0x00020010);
        if ts.is_empty() { ts = TS_EXPLICIT_LE.into(); }
    } else {
        if bytes.len() < 8 { return err("Not a DICOM file."); }
        // No preamble: guess the encoding from the first element.
        ts = if bytes[4].is_ascii_uppercase() && bytes[5].is_ascii_uppercase() { TS_EXPLICIT_LE.into() } else { TS_IMPLICIT_LE.into() };
        let g = u16::from_le_bytes([bytes[0], bytes[1]]);
        if g == 0x0002 {
            meta = read_dataset(&mut r, true, bytes.len(), false, Some(0x0002))?;
            let t = get_string(&meta, 0x00020010);
            if !t.is_empty() { ts = t; }
        } else if g > 0x7FE0 || g == 0 { return err("Not a DICOM file."); }
    }
    let explicit = ts != TS_IMPLICIT_LE;
    let ds = if ts == TS_DEFLATED {
        use std::io::Read;
        let mut out = Vec::new();
        flate2::read::DeflateDecoder::new(&bytes[r.p..]).read_to_end(&mut out).map_err(|e| DicomError(format!("The deflated data could not be read ({e}).")))?;
        let mut body = Reader { b: std::borrow::Cow::Owned(out), p: 0, le: true };
        let n = body.b.len();
        read_dataset(&mut body, explicit, n, false, None)?
    } else {
        if ts == TS_EXPLICIT_BE { r.le = false; }
        read_dataset(&mut r, explicit, bytes.len(), false, None)?
    };
    if ds.el.is_empty() { return err("No DICOM data found in this file."); }
    Ok(DicomFile { meta, ds, transfer_syntax: ts })
}

// ---------------------------------------------------------------- value conversion
/// How text is stored: no Specific Character Set (plain ASCII only), Latin-1 (or another declared single-byte
/// set), or UTF-8 (ISO_IR 192).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Charset { Ascii, Latin1, Utf8 }

pub fn latin1(b: &[u8]) -> String { b.iter().map(|&c| c as char).collect() }
fn trim_end_nul_space(s: &str) -> &str { s.trim_end_matches(|c| c == '\0' || c == ' ') }

pub fn charset_is_utf8(ds: &Dataset) -> bool {
    ds.el.get(&0x00080005).and_then(|e| e.bytes()).map_or(false, |b| latin1(b).contains("ISO_IR 192"))
}
pub fn charset_mode(ds: &Dataset) -> Charset {
    match ds.el.get(&0x00080005).and_then(|e| e.bytes()) {
        Some(b) if !trim_end_nul_space(&latin1(b)).is_empty() => if charset_is_utf8(ds) { Charset::Utf8 } else { Charset::Latin1 },
        _ => Charset::Ascii,
    }
}

/// Replaces characters the file's character set cannot hold (used for text the editor writes itself).
pub fn fold_text(s: &str, mode: Charset) -> String {
    if mode == Charset::Utf8 { return s.to_string(); }
    let mut out = String::new();
    for ch in s.chars() {
        match ch {
            '\u{2010}'..='\u{2015}' => out.push('-'),
            '\u{2018}' | '\u{2019}' => out.push('\''),
            '\u{201C}' | '\u{201D}' => out.push('"'),
            '\u{00B0}' if mode == Charset::Ascii => out.push_str(" deg"),
            '\u{00D7}' if mode == Charset::Ascii => out.push('x'),
            c => out.push(c),
        }
    }
    let max = if mode == Charset::Ascii { 127 } else { 255 };
    out.chars().map(|c| if c as u32 > max { '?' } else { c }).collect()
}

// Windows-1252 differs from Latin-1 in 0x80–0x9F; text is shown as Windows-1252 (as browsers do).
const CP1252: [char; 32] = ['\u{20AC}', '\u{81}', '\u{201A}', '\u{192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}', '\u{2C6}', '\u{2030}', '\u{160}', '\u{2039}', '\u{152}', '\u{8D}', '\u{17D}', '\u{8F}',
    '\u{90}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}', '\u{2DC}', '\u{2122}', '\u{161}', '\u{203A}', '\u{153}', '\u{9D}', '\u{17E}', '\u{178}'];
pub fn decode_text(b: &[u8], utf8: bool) -> String {
    if utf8 { return String::from_utf8_lossy(b).into_owned(); }
    b.iter().map(|&c| if (0x80..0xA0).contains(&c) { CP1252[(c - 0x80) as usize] } else { c as char }).collect()
}
fn encode_text(s: &str, mode: Charset) -> Result<Vec<u8>> {
    if mode == Charset::Utf8 { return Ok(s.as_bytes().to_vec()); }
    let mut out = Vec::with_capacity(s.len());
    for ch in s.chars() {
        let mut c = ch as u32;
        if c > 255 { if let Some(i) = CP1252.iter().position(|&x| x == ch) { c = 0x80 + i as u32; } }
        if mode == Charset::Ascii && c > 127 {
            return err(format!("\"{ch}\" needs a character set: this file has no Specific Character Set (0008,0005), so only plain ASCII is allowed. Set it to ISO_IR 100 (Latin-1) or ISO_IR 192 (UTF-8) first."));
        }
        if c > 255 { return err(format!("\"{ch}\" cannot be stored in this file's character set.")); }
        out.push(c as u8);
    }
    Ok(out)
}
fn trim_value(s: &str, vr: &str) -> String {
    let s = s.trim_end_matches('\0');
    if is_single_text(vr) { s.trim_end_matches(' ').to_string() } else { s.split('\\').map(|v| v.trim_matches(' ')).collect::<Vec<_>>().join("\\") }
}

pub fn editable(vr: &str) -> bool { is_string_vr(vr) || num_size(vr).is_some() || vr == "AT" }

fn fmt_f64(v: f64) -> String {
    if v.is_nan() { "NaN".into() } else if v.is_infinite() { if v > 0.0 { "Infinity".into() } else { "-Infinity".into() } } else { format!("{v}") }
}

fn group_thousands(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() { if i > 0 && (s.len() - i) % 3 == 0 { out.push(','); } out.push(c); }
    out
}

pub fn value_to_text(el: &Element, utf8: bool) -> String {
    match &el.value {
        Value::Items(i) => format!("{} item{}", i.len(), if i.len() == 1 { "" } else { "s" }),
        Value::Fragments(f) => format!("Compressed image data, {} fragment(s)", f.len()),
        Value::Bytes(b) => {
            let vr = el.vr.as_str();
            if is_string_vr(vr) { return trim_value(&decode_text(b, utf8 && vr != "UI"), vr); }
            if let Some(n) = num_size(vr) {
                let out: Vec<String> = b.chunks_exact(n).map(|c| match vr {
                    "US" => u16::from_le_bytes([c[0], c[1]]).to_string(),
                    "SS" => i16::from_le_bytes([c[0], c[1]]).to_string(),
                    "UL" => u32::from_le_bytes(c.try_into().unwrap()).to_string(),
                    "SL" => i32::from_le_bytes(c.try_into().unwrap()).to_string(),
                    "FL" => fmt_f64(f32::from_le_bytes(c.try_into().unwrap()) as f64),
                    "FD" => fmt_f64(f64::from_le_bytes(c.try_into().unwrap())),
                    "SV" => i64::from_le_bytes(c.try_into().unwrap()).to_string(),
                    _ => u64::from_le_bytes(c.try_into().unwrap()).to_string(),
                }).collect();
                return out.join("\\");
            }
            if vr == "AT" {
                return b.chunks_exact(4).map(|c| tag_hex(((u16::from_le_bytes([c[0], c[1]]) as u32) << 16) | u16::from_le_bytes([c[2], c[3]]) as u32)).collect::<Vec<_>>().join("\\");
            }
            format!("Binary data, {} bytes", group_thousands(b.len()))
        }
    }
}

fn re(pat: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex { cell.get_or_init(|| Regex::new(pat).unwrap()) }

/// Returns an error message, or None when the text is acceptable for the VR.
pub fn validate(vr: &str, text: &str) -> Option<String> {
    static FLOAT: OnceLock<Regex> = OnceLock::new();
    static INT: OnceLock<Regex> = OnceLock::new();
    if num_size(vr).is_some() {
        if text.trim().is_empty() { return None; }
        for v in text.split('\\') {
            let s = v.trim();
            if vr == "FL" || vr == "FD" {
                if !re(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$", &FLOAT).is_match(s) { return Some(format!("\"{s}\" is not a number.")); }
                continue;
            }
            if !re(r"^[-+]?\d+$", &INT).is_match(s) { return Some(format!("\"{s}\" is not a whole number.")); }
            let n: f64 = s.parse().unwrap_or(f64::NAN);
            let lim = match vr { "US" => Some((0.0, 65535.0)), "SS" => Some((-32768.0, 32767.0)), "UL" => Some((0.0, 4294967295.0)), "SL" => Some((-2147483648.0, 2147483647.0)), _ => None };
            if let Some((lo, hi)) = lim { if n < lo || n > hi { return Some(format!("{s} is outside {}–{}.", lo as i64, hi as i64)); } }
        }
        return None;
    }
    if vr == "AT" {
        for v in text.split('\\') { if !v.trim().is_empty() && parse_tag(v).is_none() { return Some(format!("\"{v}\" is not a tag like (0010,0010).")); } }
        return None;
    }
    if !is_string_vr(vr) { return Some("This value cannot be edited as text.".into()); }
    if (text.contains('\r') || text.contains('\n')) && !["LT", "ST", "UT"].contains(&vr) { return Some("Line breaks are only allowed in long text fields.".into()); }
    let vals: Vec<&str> = if is_single_text(vr) { vec![text] } else { text.split('\\').collect() };
    static TM: OnceLock<Regex> = OnceLock::new();
    static DT: OnceLock<Regex> = OnceLock::new();
    static DS: OnceLock<Regex> = OnceLock::new();
    static IS: OnceLock<Regex> = OnceLock::new();
    static UI: OnceLock<Regex> = OnceLock::new();
    static CS: OnceLock<Regex> = OnceLock::new();
    static AS: OnceLock<Regex> = OnceLock::new();
    for v in vals {
        if v.is_empty() { continue; }
        let len = v.chars().count();
        if vr == "PN" { if v.split('=').any(|g| g.chars().count() > 64) { return Some("Each name group must be 64 characters or fewer.".into()); } }
        else if let Some(max) = max_len(vr) { if len > max && !["DA", "TM", "DT"].contains(&vr) { return Some(format!("Each value must be {max} characters or fewer ({len} given).")); } }
        match vr {
            "DA" => if !(v.len() == 8 && v.bytes().all(|c| c.is_ascii_digit()) && valid_date(v)) { return Some("Use a date like 20261111 (YYYYMMDD).".into()); },
            "TM" => if !re(r"^([01]\d|2[0-3])([0-5]\d([0-5]\d(\.\d{1,6})?)?)?$", &TM).is_match(v) { return Some("Use a time like 143000 (HHMMSS).".into()); },
            "DT" => if !re(r"^\d{4}(\d{2}(\d{2}(\d{2}(\d{2}(\d{2}(\.\d{1,6})?)?)?)?)?)?([+-]\d{4})?$", &DT).is_match(v) { return Some("Use a date-time like 20261111143000.".into()); },
            "DS" => if !re(r"^ *[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)? *$", &DS).is_match(v) { return Some(format!("\"{v}\" is not a decimal number.")); },
            "IS" => if !re(r"^ *[-+]?\d+ *$", &IS).is_match(v) || v.trim().parse::<f64>().map_or(true, |n| n.abs() > 2147483647.0) { return Some(format!("\"{v}\" is not a whole number.")); },
            "UI" => if !re(r"^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$", &UI).is_match(v) { return Some("A UID is digits separated by dots.".into()); },
            "CS" => if !re(r"^[A-Z0-9 _]*$", &CS).is_match(v) { return Some("Code strings use capital letters, digits, spaces and underscores.".into()); },
            "AS" => if !re(r"^\d{3}[DWMY]$", &AS).is_match(v) { return Some("Use an age like 005Y.".into()); },
            _ => {}
        }
    }
    None
}
fn valid_date(s: &str) -> bool {
    let (y, m, d): (i32, u32, u32) = (s[0..4].parse().unwrap_or(0), s[4..6].parse().unwrap_or(0), s[6..8].parse().unwrap_or(0));
    chrono::NaiveDate::from_ymd_opt(y, m, d).is_some()
}

pub fn text_to_bytes(vr: &str, text: &str, mode: Charset) -> Result<Vec<u8>> {
    let up;
    let text = if vr == "CS" { up = text.to_uppercase(); up.as_str() } else { text };
    if let Some(e) = validate(vr, text) { return err(e); }
    if let Some(n) = num_size(vr) {
        if text.trim().is_empty() { return Ok(Vec::new()); }
        let mut b = Vec::with_capacity(n * 4);
        for v in text.split('\\') {
            let s = v.trim();
            match vr {
                "US" => b.extend((s.parse::<i64>().unwrap() as u16).to_le_bytes()),
                "SS" => b.extend((s.parse::<i64>().unwrap() as i16).to_le_bytes()),
                "UL" => b.extend((s.parse::<i64>().unwrap() as u32).to_le_bytes()),
                "SL" => b.extend((s.parse::<i64>().unwrap() as i32).to_le_bytes()),
                "FL" => b.extend((s.parse::<f64>().unwrap() as f32).to_le_bytes()),
                "FD" => b.extend(s.parse::<f64>().unwrap().to_le_bytes()),
                "SV" => b.extend(s.parse::<i64>().map_err(|_| DicomError(format!("\"{s}\" is out of range.")))?.to_le_bytes()),
                _ => b.extend(s.trim_start_matches('+').parse::<u64>().map_err(|_| DicomError(format!("\"{s}\" is out of range.")))?.to_le_bytes()),
            }
        }
        return Ok(b);
    }
    if vr == "AT" {
        let mut b = Vec::new();
        for v in text.split('\\').filter(|v| !v.trim().is_empty()) {
            let t = parse_tag(v).unwrap();
            b.extend(((t >> 16) as u16).to_le_bytes()); b.extend(((t & 0xFFFF) as u16).to_le_bytes());
        }
        return Ok(b);
    }
    encode_text(text, if vr == "UI" { Charset::Ascii } else { mode })
}

pub fn get_string(ds: &Dataset, tag: u32) -> String {
    match ds.el.get(&tag) { Some(el) if el.bytes().is_some() => value_to_text(el, charset_is_utf8(ds)), _ => String::new() }
}
pub fn get_number_at(ds: &Dataset, tag: u32, index: usize) -> Option<f64> {
    let s = get_string(ds, tag);
    let v = s.split('\\').nth(index)?;
    let v = v.trim();
    if v.is_empty() { return None; }
    v.parse::<f64>().ok()
}
pub fn get_number(ds: &Dataset, tag: u32) -> Option<f64> { get_number_at(ds, tag, 0) }

impl Dataset {
    pub fn get(&self, tag: u32) -> Option<&Element> { self.el.get(&tag) }
    pub fn has(&self, tag: u32) -> bool { self.el.contains_key(&tag) }
    pub fn string(&self, tag: u32) -> String { get_string(self, tag) }
    pub fn number(&self, tag: u32) -> Option<f64> { get_number(self, tag) }
    pub fn remove(&mut self, tag: u32) -> bool { self.el.remove(&tag).is_some() }
    /// Sets (creating if needed) an element from text. `vr` defaults to the existing VR, then the dictionary.
    /// Text is encoded in this data set's own character set.
    pub fn set_text(&mut self, tag: u32, text: &str, vr: Option<&str>) -> Result<()> {
        let mode = charset_mode(self);
        self.set_text_cs(tag, text, vr, mode)
    }
    pub fn set_text_cs(&mut self, tag: u32, text: &str, vr: Option<&str>, mode: Charset) -> Result<()> {
        let vr: String = match vr { Some(v) => v.to_string(), None => match self.el.get(&tag) { Some(e) => e.vr.as_str().to_string(), None => match tag_info(tag).vr { Some(v) => v.to_string(), None => return err(format!("Choose a VR for {}.", tag_hex(tag))) } } };
        let value = text_to_bytes(&vr, text, mode)?;
        self.el.insert(tag, Element { tag, vr: Vr::new(&vr), value: Value::Bytes(value) });
        Ok(())
    }
}

pub fn new_uid() -> String {
    let mut b = [0u8; 16];
    getrandom::getrandom(&mut b).expect("random numbers");
    b[6] = (b[6] & 0x0F) | 0x40; b[8] = (b[8] & 0x3F) | 0x80; // RFC 4122 v4, as PS3.5 B.2 expects for 2.25 UIDs
    format!("2.25.{}", u128::from_be_bytes(b))
}

// ---------------------------------------------------------------- writing
fn padded(el_vr: &str, v: &[u8]) -> Vec<u8> {
    let mut o = v.to_vec();
    if o.len() & 1 == 1 { o.push(if is_string_vr(el_vr) && el_vr != "UI" { 0x20 } else { 0 }); }
    o
}
fn w16(w: &mut Vec<u8>, v: u16) { w.extend(v.to_le_bytes()); }
fn w32(w: &mut Vec<u8>, v: u32) { w.extend(v.to_le_bytes()); }
fn wtag(w: &mut Vec<u8>, t: u32) { w16(w, (t >> 16) as u16); w16(w, (t & 0xFFFF) as u16); }

fn write_dataset(w: &mut Vec<u8>, ds: &Dataset) -> Result<()> {
    for (t, el) in &ds.el { if (t & 0xFFFF) != 0 || (t >> 16) == 0x0002 { write_element(w, el)?; } }
    Ok(())
}
fn write_element(w: &mut Vec<u8>, el: &Element) -> Result<()> {
    wtag(w, el.tag);
    match &el.value {
        Value::Items(items) => {
            w.extend(b"SQ"); w16(w, 0); w32(w, UNDEF);
            for it in items { wtag(w, ITEM); w32(w, UNDEF); write_dataset(w, it)?; wtag(w, ITEM_DELIM); w32(w, 0); }
            wtag(w, SEQ_DELIM); w32(w, 0);
        }
        Value::Fragments(frags) => {
            w.extend(b"OB"); w16(w, 0); w32(w, UNDEF);
            for f in frags { let p = padded("OB", f); wtag(w, ITEM); w32(w, p.len() as u32); w.extend(&p); }
            wtag(w, SEQ_DELIM); w32(w, 0);
        }
        Value::Bytes(b) => {
            let vr = el.vr.as_str();
            let v = padded(vr, b);
            w.extend(vr.as_bytes());
            if is_long_vr(vr) { w16(w, 0); w32(w, v.len() as u32); } else {
                if v.len() > 0xFFFF { return err(format!("{} is too long for VR {}.", tag_hex(el.tag), vr)); }
                w16(w, v.len() as u16);
            }
            w.extend(&v);
        }
    }
    Ok(())
}

fn build_meta(file: &DicomFile, ts: &str) -> Result<Dataset> {
    let mut meta = Dataset::default();
    let (ds, old) = (&file.ds, &file.meta);
    meta.el.insert(0x00020001, Element::raw(0x00020001, "OB", vec![0, 1]));
    let pick = |a: String, b: String, c: &dyn Fn() -> String| if !a.is_empty() { a } else if !b.is_empty() { b } else { c() };
    meta.set_text_cs(0x00020002, &pick(get_string(ds, 0x00080016), get_string(old, 0x00020002), &|| "1.2.840.10008.5.1.4.1.1.7".into()), Some("UI"), Charset::Ascii)?;
    meta.set_text_cs(0x00020003, &pick(get_string(ds, 0x00080018), get_string(old, 0x00020003), &new_uid), Some("UI"), Charset::Ascii)?;
    meta.set_text_cs(0x00020010, ts, Some("UI"), Charset::Ascii)?;
    meta.set_text_cs(0x00020012, IMPL_UID, Some("UI"), Charset::Ascii)?;
    meta.set_text_cs(0x00020013, IMPL_NAME, Some("SH"), Charset::Ascii)?;
    let ae = get_string(old, 0x00020016);
    if !ae.is_empty() { meta.set_text_cs(0x00020016, &ae, Some("AE"), Charset::Latin1)?; }
    let mut body = Vec::new();
    write_dataset(&mut body, &meta)?;
    meta.el.insert(0x00020000, Element::raw(0x00020000, "UL", (body.len() as u32).to_le_bytes().to_vec()));
    Ok(meta)
}

pub fn write(file: &DicomFile) -> Result<Vec<u8>> {
    let ts = if file.encapsulated() { file.transfer_syntax.clone() } else { TS_EXPLICIT_LE.to_string() };
    let meta = build_meta(file, &ts)?;
    let mut w = vec![0u8; 128];
    w.extend(b"DICM");
    write_dataset(&mut w, &meta)?;
    write_dataset(&mut w, &file.ds)?;
    Ok(w)
}

// ---------------------------------------------------------------- image access
/// A greyscale image: every frame as i32 values (whatever the stored bit depth). `min`/`max` are the storable
/// pixel range for Bits Stored and the sign.
#[derive(Clone, Debug, PartialEq)]
pub struct Image {
    pub rows: usize,
    pub cols: usize,
    pub frames: Vec<Vec<i32>>,
    pub bits_allocated: u16,
    pub bits_stored: u16,
    pub signed: bool,
    pub photometric: String,
    pub min: i32,
    pub max: i32,
    pub slope: f64,
    pub intercept: f64,
    pub padding: Option<i32>,
    pub window_center: Option<f64>,
    pub window_width: Option<f64>,
}
impl Image {
    /// Same pixel description with new size and frames.
    pub fn with_frames(&self, rows: usize, cols: usize, frames: Vec<Vec<i32>>) -> Image {
        Image { rows, cols, frames, bits_allocated: self.bits_allocated, bits_stored: self.bits_stored, signed: self.signed, photometric: self.photometric.clone(),
            min: self.min, max: self.max, slope: self.slope, intercept: self.intercept, padding: self.padding, window_center: self.window_center, window_width: self.window_width }
    }
    pub fn monochrome1(&self) -> bool { self.photometric == "MONOCHROME1" }
    pub fn bytes_len(&self) -> usize { self.frames.iter().map(|f| f.len() * 4).sum() }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ImageError { pub message: String, pub compressed: bool }
impl fmt::Display for ImageError { fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str(&self.message) } }
fn ierr<T>(m: impl Into<String>) -> std::result::Result<T, ImageError> { Err(ImageError { message: m.into(), compressed: false }) }

pub fn get_image(file: &DicomFile) -> std::result::Result<Image, ImageError> {
    let ds = &file.ds;
    let px = match ds.el.get(&PIXEL) { Some(p) => p, None => return ierr("This file has no image data.") };
    let value = match &px.value {
        Value::Fragments(_) => return Err(ImageError { message: format!("The image is compressed ({}). Metadata can be edited, but image tools need an uncompressed file.", ts_name(&file.transfer_syntax)), compressed: true }),
        Value::Bytes(b) => b,
        Value::Items(_) => return ierr("This file has no image data."),
    };
    let num = |t| get_number(ds, t);
    let rows = num(0x00280010).unwrap_or(0.0) as usize;
    let cols = num(0x00280011).unwrap_or(0.0) as usize;
    let spp = num(0x00280002).filter(|v| *v != 0.0).unwrap_or(1.0) as u32;
    let ba = num(0x00280100).filter(|v| *v != 0.0).unwrap_or(16.0) as u16;
    let bs = num(0x00280101).filter(|v| *v != 0.0).unwrap_or(ba as f64) as u16;
    let pr = num(0x00280103).unwrap_or(0.0) != 0.0;
    let frames = (num(0x00280008).unwrap_or(1.0) as usize).max(1);
    let mut photometric = get_string(ds, 0x00280004);
    if photometric.is_empty() { photometric = "MONOCHROME2".into(); }
    if rows == 0 || cols == 0 { return ierr("Image size (Rows/Columns) is missing."); }
    if spp != 1 || !(photometric == "MONOCHROME1" || photometric == "MONOCHROME2") { return ierr("Only greyscale images can be processed. Metadata can still be edited."); }
    if ![8u16, 16, 32].contains(&ba) { return ierr(format!("{ba}-bit images are not supported by the image tools.")); }
    if bs == 0 || bs > ba { return ierr(format!("Bits Stored ({bs}) does not fit Bits Allocated ({ba}).")); }
    if ba == 32 && !pr && bs == 32 { return ierr("32-bit unsigned images are not supported by the image tools."); }
    let n = rows * cols;
    let bpp = (ba / 8) as usize;
    if value.len() < n * frames * bpp { return ierr("Image data is shorter than the image size says."); }
    let (min, max): (i64, i64) = if pr { (-(1i64 << (bs - 1)), (1i64 << (bs - 1)) - 1) } else { (0, (1i64 << bs) - 1) };
    let mask: u32 = if bs >= 32 { u32::MAX } else { (1u32 << bs) - 1 };
    let mut out = Vec::with_capacity(frames);
    for f in 0..frames {
        let src = &value[f * n * bpp..(f + 1) * n * bpp];
        let mut a = Vec::with_capacity(n);
        for c in src.chunks_exact(bpp) {
            let raw: u32 = match bpp { 1 => c[0] as u32, 2 => u16::from_le_bytes([c[0], c[1]]) as u32, _ => u32::from_le_bytes([c[0], c[1], c[2], c[3]]) };
            let v: i64 = if bs < ba {
                let mut v = (raw & mask) as i64;
                if pr && v > max { v -= 1i64 << bs; }
                v
            } else if pr {
                match bpp { 1 => raw as u8 as i8 as i64, 2 => raw as u16 as i16 as i64, _ => raw as i32 as i64 }
            } else { raw as i64 };
            a.push(v as i32);
        }
        out.push(a);
    }
    let fin = |t| get_number(ds, t).filter(|v| v.is_finite());
    let padding = fin(0x00280120).filter(|v| v.fract() == 0.0).map(|v| v as i32);
    Ok(Image { rows, cols, frames: out, bits_allocated: ba, bits_stored: bs, signed: pr, photometric, min: min as i32, max: max as i32,
        slope: fin(0x00281053).unwrap_or(1.0), intercept: fin(0x00281052).unwrap_or(0.0), padding, window_center: fin(0x00281050), window_width: fin(0x00281051) })
}

pub fn set_image(file: &mut DicomFile, img: &Image, swap_spacing: bool) -> Result<()> {
    let ds = &mut file.ds;
    let bpp = (img.bits_allocated / 8) as usize;
    let mut bytes = Vec::with_capacity(img.rows * img.cols * bpp * img.frames.len());
    for f in &img.frames {
        for &v in f {
            match bpp { 1 => bytes.push(v as u8), 2 => bytes.extend((v as u16).to_le_bytes()), _ => bytes.extend((v as u32).to_le_bytes()) }
        }
    }
    ds.set_text(0x00280010, &img.rows.to_string(), Some("US"))?;
    ds.set_text(0x00280011, &img.cols.to_string(), Some("US"))?;
    if img.frames.len() > 1 || ds.has(0x00280008) { ds.set_text(0x00280008, &img.frames.len().to_string(), Some("IS"))?; }
    // Smallest/Largest Image Pixel Value: INDUSTREX writes both, so keep them, recalculated for the new pixels.
    if ds.has(0x00280106) || ds.has(0x00280107) {
        let (mut lo, mut hi) = (i32::MAX, i32::MIN);
        for f in &img.frames { for &v in f { lo = lo.min(v); hi = hi.max(v); } }
        let vr = if img.signed { "SS" } else { "US" };
        if img.bits_allocated <= 16 { ds.set_text(0x00280106, &lo.to_string(), Some(vr))?; ds.set_text(0x00280107, &hi.to_string(), Some(vr))?; }
        else { ds.remove(0x00280106); ds.remove(0x00280107); }
    }
    if swap_spacing {
        for t in [0x00280030u32, 0x00181164] {
            let s = get_string(ds, t);
            let p: Vec<&str> = s.split('\\').collect();
            if p.len() == 2 { let v = format!("{}\\{}", p[1], p[0]); ds.set_text(t, &v, None)?; }
        }
    }
    ds.el.insert(PIXEL, Element { tag: PIXEL, vr: Vr::new(if img.bits_allocated > 8 { "OW" } else { "OB" }), value: Value::Bytes(bytes) });
    Ok(())
}

/// Image attributes needed to decode compressed pixel data.
#[derive(Clone, Copy, Debug)]
pub struct Geometry { pub rows: usize, pub cols: usize, pub frames: usize, pub bits_allocated: u16, pub bits_stored: u16, pub signed: bool, pub samples_per_pixel: u32 }
pub fn image_geometry(file: &DicomFile) -> Geometry {
    let ds = &file.ds;
    let ba = get_number(ds, 0x00280100).filter(|v| *v != 0.0).unwrap_or(16.0) as u16;
    Geometry { rows: get_number(ds, 0x00280010).unwrap_or(0.0) as usize, cols: get_number(ds, 0x00280011).unwrap_or(0.0) as usize,
        frames: (get_number(ds, 0x00280008).unwrap_or(1.0) as usize).max(1), bits_allocated: ba,
        bits_stored: get_number(ds, 0x00280101).filter(|v| *v != 0.0).unwrap_or(ba as f64) as u16,
        signed: get_number(ds, 0x00280103).unwrap_or(0.0) != 0.0, samples_per_pixel: get_number(ds, 0x00280002).filter(|v| *v != 0.0).unwrap_or(1.0) as u32 }
}
/// An editable image from decoded frames (raw little-endian bytes), leaving the file's compressed data alone.
pub fn image_from_frames(file: &DicomFile, frame_bytes: &[Vec<u8>]) -> std::result::Result<Image, ImageError> {
    let all: Vec<u8> = frame_bytes.concat();
    let mut ds = file.ds.clone();
    ds.el.insert(PIXEL, Element { tag: PIXEL, vr: Vr::new("OW"), value: Value::Bytes(all) });
    get_image(&DicomFile { meta: file.meta.clone(), ds, transfer_syntax: TS_EXPLICIT_LE.into() })
}
/// Stores compressed frames (one codestream per frame) with a Basic Offset Table entry per frame, as INDUSTREX
/// writes it, and the transfer syntax they use.
pub fn set_encapsulated(file: &mut DicomFile, codestreams: Vec<Vec<u8>>, ts: &str) {
    let mut bot = Vec::with_capacity(4 * codestreams.len());
    let mut off = 0u32;
    for c in &codestreams { bot.extend(off.to_le_bytes()); off += 8 + c.len() as u32 + (c.len() as u32 & 1); }
    let mut frags = vec![bot];
    frags.extend(codestreams);
    file.ds.el.insert(PIXEL, Element { tag: PIXEL, vr: Vr::new("OB"), value: Value::Fragments(frags) });
    file.transfer_syntax = ts.to_string();
}

// ---------------------------------------------------------------- INDUSTREX private data
// Carestream INDUSTREX private block in group 0033. Element meanings come from INDUSTREX 7.2.1 files (HPX-PRO,
// creator "CSH_NDT") checked against the Conformance Statement rev. 10.0 (2017): xx10 version, xx40/xx52 internal
// data, xx50 JPEG preview, xx70 XML presentation state (display settings plus a mirror of ~200 DICONDE fields),
// xx71 presentation flag, xx72 display processing settings. INDUSTREX regenerates xx40/xx50/xx52/xx70 when it
// changes pixels and keeps xx71/xx72.
const INDUSTREX_STALE: [u32; 4] = [0x40, 0x50, 0x52, 0x70];
fn industrex_name(e: u32) -> Option<&'static str> {
    Some(match e {
        0x10 => "INDUSTREX version", 0x40 | 0x52 => "INDUSTREX internal data", 0x50 => "INDUSTREX preview image",
        0x70 => "INDUSTREX presentation state (XML)", 0x71 => "INDUSTREX presentation flag", 0x72 => "INDUSTREX display processing", _ => return None,
    })
}
fn latin_trim(el: Option<&Element>) -> String {
    match el.and_then(|e| e.bytes()) { Some(b) => trim_end_nul_space(&latin1(b)).trim_start_matches(' ').to_string(), None => String::new() }
}

#[derive(Clone, Debug, PartialEq)]
pub struct IndustrexInfo { pub creator: String, pub block: u32, pub version: String, pub xml_tag: Option<u32>, pub stale_tags: Vec<u32> }

pub fn industrex_info(ds: &Dataset) -> Option<IndustrexInfo> {
    static CR: OnceLock<Regex> = OnceLock::new();
    let creator_re = re(r"(?i)CSH|CARESTREAM|KODAK|INDUSTREX", &CR);
    for b in 0x10u32..=0xFF {
        let cr = match ds.el.get(&(0x00330000 | b)) { Some(c) => c, None => continue };
        let creator = latin_trim(Some(cr));
        let base = 0x00330000 | (b << 8);
        let has = |x: u32| ds.has(base | x);
        if !creator_re.is_match(&creator) && !(has(0x70) && has(0x72)) { continue; }
        let version = latin_trim(ds.el.get(&(base | 0x10)));
        return Some(IndustrexInfo {
            creator, block: b, version: if version.bytes().all(|c| (0x20..=0x7E).contains(&c)) { version } else { String::new() },
            xml_tag: if has(0x70) { Some(base | 0x70) } else { None },
            stale_tags: INDUSTREX_STALE.iter().filter(|x| has(**x)).map(|x| base | x).collect(),
        });
    }
    None
}
fn xml_esc(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }
fn xml_unesc(s: &str) -> String { s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&") }

pub fn industrex_xml(ds: &Dataset) -> Option<(u32, String)> {
    let ix = industrex_info(ds)?;
    let tag = ix.xml_tag?;
    let b = ds.el.get(&tag)?.bytes()?;
    let text = trim_end_nul_space(&String::from_utf8_lossy(b)).to_string();
    let t = text.trim_start();
    if t.starts_with("<?xml") || t.starts_with("<presentation_state") { Some((tag, text)) } else { None }
}
fn entry_regex(kind: &str, key: &str) -> Regex {
    Regex::new(&format!(r#"(?s)<{kind} KEY="{}"\s*(?:/>|>(.*?)</{kind}>)"#, regex::escape(key))).unwrap()
}
/// Values INDUSTREX keeps in its XML for a DICOM tag, or None when the XML has no entry for it.
pub fn industrex_xml_values(ds: &Dataset, tag: u32) -> Option<Vec<String>> { industrex_xml_entry(ds, &format!("{:04X},{:04X}", tag >> 16, tag & 0xFFFF)) }
/// Any entry of the XML mirror by key, e.g. "ANGLE" (INDUSTREX's viewing rotation) or "0010,0020".
pub fn industrex_xml_entry(ds: &Dataset, key: &str) -> Option<Vec<String>> {
    let (_, text) = industrex_xml(ds)?;
    let key: String = key.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == ',').collect();
    // DICOM fields are <diconde KEY="gggg,eeee">; INDUSTREX's own settings (ANGLE, DEFAULTWL, …) are <non_diconde>.
    let a = entry_regex("diconde", &key).captures(&text);
    let b = entry_regex("non_diconde", &key).captures(&text);
    let m = match (a, b) { (Some(a), Some(b)) => if a.get(0).unwrap().start() <= b.get(0).unwrap().start() { a } else { b }, (Some(a), None) => a, (None, Some(b)) => b, _ => return None };
    let inner = m.get(1).map_or("", |x| x.as_str());
    static V: OnceLock<Regex> = OnceLock::new();
    Some(re(r"(?s)<value>(.*?)</value>|<value\s*/>", &V).captures_iter(inner).map(|c| xml_unesc(c.get(1).map_or("", |x| x.as_str()))).collect())
}
/// Copies the current values of `tags` into existing entries of INDUSTREX's XML mirror, leaving the rest of the
/// XML byte for byte. Returns the tags updated. Tags without an entry are not added.
pub fn sync_industrex_xml(ds: &mut Dataset, tags: &[u32]) -> Vec<u32> {
    let (xml_tag, mut text) = match industrex_xml(ds) { Some(x) => x, None => return Vec::new() };
    let utf8 = charset_is_utf8(ds);
    let mut done = Vec::new();
    for &tag in tags {
        if (tag >> 16) == 0x0033 { continue; }
        let key = format!("{:04X},{:04X}", tag >> 16, tag & 0xFFFF);
        let r = entry_regex("diconde", &key);
        let m = match r.find(&text) { Some(m) => m.range(), None => continue };
        let el = ds.el.get(&tag);
        let raw = match el { Some(e) if e.bytes().is_some() => value_to_text(e, utf8), _ => String::new() };
        let vals: Vec<String> = if el.map_or(false, |e| is_single_text(e.vr.as_str())) { vec![raw] } else { raw.split('\\').map(String::from).collect() };
        let rep = format!("<diconde KEY=\"{key}\">{}</diconde>", vals.iter().map(|v| format!("<value>{}</value>", xml_esc(v))).collect::<String>());
        text.replace_range(m, &rep);
        done.push(tag);
    }
    if !done.is_empty() {
        let vr = ds.el[&xml_tag].vr;
        ds.el.insert(xml_tag, Element { tag: xml_tag, vr, value: Value::Bytes(text.into_bytes()) });
    }
    done
}

#[derive(Clone, Debug, PartialEq)]
pub enum Setting { Num(f64), Text(String) }
#[derive(Clone, Debug, PartialEq)]
pub struct DisplaySettings { pub filter: String, pub settings: Vec<(String, Setting)> }
impl DisplaySettings {
    pub fn get(&self, k: &str) -> Option<&Setting> { self.settings.iter().find(|(n, _)| n == k).map(|(_, v)| v) }
    pub fn num(&self, k: &str) -> Option<f64> { match self.get(k) { Some(Setting::Num(v)) => Some(*v), _ => None } }
}
/// INDUSTREX's display processing (CSH_NDT xx72), e.g. EDGE \ Image Class: HD 1 \ Brightness: 0.0 \ … .
pub fn industrex_display_settings(ds: &Dataset) -> Option<DisplaySettings> {
    let ix = industrex_info(ds)?;
    let s = latin_trim(ds.el.get(&(0x00330000 | (ix.block << 8) | 0x72)));
    let parts: Vec<&str> = s.split('\\').map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() { return None; }
    let mut out = DisplaySettings { filter: String::new(), settings: Vec::new() };
    for p in parts {
        match p.find(':') {
            Some(i) if i > 0 => {
                let (k, v) = (p[..i].trim().to_string(), p[i + 1..].trim());
                let val = match v.parse::<f64>() { Ok(n) if !v.is_empty() && n.is_finite() => Setting::Num(n), _ => Setting::Text(v.to_string()) };
                out.settings.push((k, val));
            }
            _ => if out.filter.is_empty() { out.filter = p.to_string(); },
        }
    }
    Some(out)
}
/// Elements that describe the old pixels and must not travel with an edited image.
pub fn stale_presentation_tags(ds: &Dataset) -> Vec<u32> {
    let mut v = if ds.has(0x00880200) { vec![0x00880200] } else { Vec::new() };
    if let Some(ix) = industrex_info(ds) { v.extend(ix.stale_tags); }
    v
}
/// Like tag_info, but names private elements from the file's own private creators.
pub fn describe_tag(ds: &Dataset, tag: u32) -> TagInfo {
    let mut info = tag_info(tag);
    let (g, e) = (tag >> 16, tag & 0xFFFF);
    if g & 1 == 0 { return info; }
    if (0x10..=0xFF).contains(&e) { info.name = "Private creator".into(); info.dicom_name = info.name.clone(); return info; }
    let creator = latin_trim(ds.el.get(&((g << 16) | (e >> 8))));
    let ix = if g == 0x0033 { industrex_info(ds) } else { None };
    let name = match (&ix, industrex_name(e & 0xFF)) {
        (Some(ix), Some(n)) if ix.block == e >> 8 => n.to_string(),
        _ => if creator.is_empty() { "Private data".into() } else { format!("Private data ({creator})") },
    };
    info.name = name.clone(); info.dicom_name = name;
    info
}

// ---------------------------------------------------------------- derived copies
fn now() -> (String, String) {
    let t = chrono::Local::now();
    (t.format("%Y%m%d").to_string(), t.format("%H%M%S").to_string())
}

#[derive(Default, Clone, Debug)]
pub struct DeriveOptions {
    pub pixels_changed: bool,
    pub description: String,
    pub series_uid: Option<String>,
    pub instance_number: Option<usize>,
}

/// Marks a file as a new instance derived from `source`. The original file is never modified. Returns the
/// tags removed because they described the old pixels.
pub fn derive(file: &mut DicomFile, source: &DicomFile, o: &DeriveOptions) -> Result<Vec<u32>> {
    let (date, time) = now();
    let src_class = { let s = get_string(&source.ds, 0x00080016); if s.is_empty() { get_string(&source.meta, 0x00020002) } else { s } };
    let src_inst = { let s = get_string(&source.ds, 0x00080018); if s.is_empty() { get_string(&source.meta, 0x00020003) } else { s } };
    let ds = &mut file.ds;
    ds.set_text(0x00080018, &new_uid(), Some("UI"))?;
    ds.set_text(0x00080012, &date, Some("DA"))?;
    ds.set_text(0x00080013, &time, Some("TM"))?;
    if let Some(n) = o.instance_number { ds.set_text(0x00200013, &n.to_string(), Some("IS"))?; }
    if let Some(s) = &o.series_uid { ds.set_text(0x0020000E, s, Some("UI"))?; }
    let mut removed = Vec::new();
    if o.pixels_changed {
        let stale = stale_presentation_tags(ds);
        for t in &stale { ds.remove(*t); }
        removed.extend(stale);
        let it = { let s = get_string(ds, 0x00080008); if s.is_empty() { "ORIGINAL\\PRIMARY".to_string() } else { s } };
        let mut parts: Vec<String> = it.split('\\').map(String::from).collect();
        while parts.len() < 2 { parts.push(String::new()); }
        parts[0] = "DERIVED".into(); parts[1] = "SECONDARY".into();
        ds.set_text(0x00080008, &parts.join("\\"), Some("CS"))?;
    }
    if !o.description.is_empty() {
        let prev = get_string(ds, 0x00082111);
        let mut d = fold_text(&format!("{}{}", if prev.is_empty() { String::new() } else { prev + "; " }, o.description), charset_mode(ds));
        if d.chars().count() > 1024 { d = d.chars().take(1021).collect::<String>() + "..."; }
        ds.set_text(0x00082111, &d, Some("ST"))?;
    }
    if !src_inst.is_empty() && (o.pixels_changed || !o.description.is_empty()) {
        let mut item = Dataset::default();
        if !src_class.is_empty() { item.set_text_cs(0x00081150, &src_class, Some("UI"), Charset::Ascii)?; }
        item.set_text_cs(0x00081155, &src_inst, Some("UI"), Charset::Ascii)?;
        let mut items: Vec<Dataset> = ds.el.get(&0x00082112).and_then(|s| s.items()).map(|i| i.iter().filter(|d| get_string(d, 0x00081155) != src_inst).cloned().collect()).unwrap_or_default();
        items.push(item);
        ds.el.insert(0x00082112, Element { tag: 0x00082112, vr: Vr::new("SQ"), value: Value::Items(items) });
    }
    Ok(removed)
}
