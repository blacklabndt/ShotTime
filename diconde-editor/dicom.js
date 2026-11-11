/* DICOM / DICONDE file reading and writing. No dependencies; works in browsers and Node.
   Values are held as little-endian bytes so a file can be written back without loss.
   Output is always Explicit VR Little Endian, except compressed (encapsulated) files whose
   image data is unchanged, which keep their original transfer syntax. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dicom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TS = { IMPLICIT_LE: '1.2.840.10008.1.2', EXPLICIT_LE: '1.2.840.10008.1.2.1', DEFLATED: '1.2.840.10008.1.2.1.99', EXPLICIT_BE: '1.2.840.10008.1.2.2' };
  const TS_NAMES = {
    '1.2.840.10008.1.2': 'Implicit VR Little Endian', '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
    '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian', '1.2.840.10008.1.2.2': 'Explicit VR Big Endian',
    '1.2.840.10008.1.2.4.50': 'JPEG Baseline', '1.2.840.10008.1.2.4.51': 'JPEG Extended', '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
    '1.2.840.10008.1.2.4.70': 'JPEG Lossless SV1', '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless', '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-Lossless',
    '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless', '1.2.840.10008.1.2.4.91': 'JPEG 2000', '1.2.840.10008.1.2.5': 'RLE Lossless',
    '1.2.840.10008.1.2.4.201': 'HTJ2K Lossless', '1.2.840.10008.1.2.4.202': 'HTJ2K Lossless RPCL', '1.2.840.10008.1.2.4.203': 'HTJ2K'
  };
  const UNDEF = 0xFFFFFFFF, ITEM = 0xFFFEE000, ITEM_DELIM = 0xFFFEE00D, SEQ_DELIM = 0xFFFEE0DD, PIXEL = 0x7FE00010;
  const LONG_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV']);
  const STRING_VRS = new Set(['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT']);
  const SINGLE_TEXT = new Set(['LT', 'ST', 'UT', 'UR']); // backslash is ordinary text here
  const NUM = { US: [2, 'Uint16'], SS: [2, 'Int16'], UL: [4, 'Uint32'], SL: [4, 'Int32'], FL: [4, 'Float32'], FD: [8, 'Float64'], SV: [8, 'BigInt64'], UV: [8, 'BigUint64'] };
  const SWAP = { US: 2, SS: 2, OW: 2, AT: 2, UL: 4, SL: 4, FL: 4, OF: 4, OL: 4, FD: 8, OD: 8, SV: 8, UV: 8, OV: 8 };
  const MAX_LEN = { AE: 16, AS: 4, CS: 16, DA: 8, DS: 16, DT: 26, IS: 12, LO: 64, LT: 10240, PN: 64, SH: 16, ST: 1024, TM: 16, UI: 64 };
  const IMPL_UID = '2.25.233198034562290651734618273591028374211', IMPL_NAME = 'DICONDE_EDIT_1';

  // Data dictionary: tag, VR, keyword. Names only help display; explicit-VR files supply their own VR.
  const DICT_SRC = `00020000 UL FileMetaInformationGroupLength|00020001 OB FileMetaInformationVersion|00020002 UI MediaStorageSOPClassUID|00020003 UI MediaStorageSOPInstanceUID|00020010 UI TransferSyntaxUID|00020012 UI ImplementationClassUID|00020013 SH ImplementationVersionName|00020016 AE SourceApplicationEntityTitle
00080005 CS SpecificCharacterSet|00080008 CS ImageType|00080012 DA InstanceCreationDate|00080013 TM InstanceCreationTime|00080016 UI SOPClassUID|00080018 UI SOPInstanceUID|00080020 DA StudyDate|00080021 DA SeriesDate|00080022 DA AcquisitionDate|00080023 DA ContentDate|00080030 TM StudyTime|00080031 TM SeriesTime|00080032 TM AcquisitionTime|00080033 TM ContentTime|00080050 SH AccessionNumber|00080060 CS Modality|00080064 CS ConversionType|00080070 LO Manufacturer|00080080 LO InstitutionName|00080081 ST InstitutionAddress|00080090 PN ReferringPhysicianName|00081010 SH StationName|00081030 LO StudyDescription|0008103E LO SeriesDescription|00081040 LO InstitutionalDepartmentName|00081050 PN PerformingPhysicianName|00081070 PN OperatorsName|00081090 LO ManufacturerModelName|00081150 UI ReferencedSOPClassUID|00081155 UI ReferencedSOPInstanceUID|00082111 ST DerivationDescription|00082112 SQ SourceImageSequence
00100010 PN PatientName|00100020 LO PatientID|00100021 LO IssuerOfPatientID|00100030 DA PatientBirthDate|00100040 CS PatientSex|00101000 LO OtherPatientIDs|00101001 PN OtherPatientNames|00102160 SH EthnicGroup|00104000 LT PatientComments
00140025 ST ComponentManufacturingProcedure|00140028 ST ComponentManufacturer|00140030 DS MaterialThickness|00140032 DS MaterialPipeDiameter|00140034 DS MaterialIsolationDiameter|00140042 ST MaterialGrade|00140044 ST MaterialPropertiesDescription|00140046 LT MaterialNotes|00140050 CS ComponentShape|00140052 CS CurvatureType|00140054 DS OuterDiameter|00140056 DS InnerDiameter|00142002 SQ EvaluatorSequence|00142004 IS EvaluatorNumber|00142006 PN EvaluatorName|00143011 DS InternalDetectorFrameTime|00143012 DS NumberOfFramesIntegrated|00143099 LT CalibrationNotes
00180015 CS BodyPartExamined|00180060 DS KVP|00181000 LO DeviceSerialNumber|00181004 LO PlateID|00181020 LO SoftwareVersions|00181110 DS DistanceSourceToDetector|00181111 DS DistanceSourceToPatient|00181150 IS ExposureTime|00181151 IS XRayTubeCurrent|00181152 IS Exposure|00181164 DS ImagerPixelSpacing|00181400 LO AcquisitionDeviceProcessingDescription
0020000D UI StudyInstanceUID|0020000E UI SeriesInstanceUID|00200010 SH StudyID|00200011 IS SeriesNumber|00200012 IS AcquisitionNumber|00200013 IS InstanceNumber|00200020 CS PatientOrientation|00204000 LT ImageComments
00280002 US SamplesPerPixel|00280004 CS PhotometricInterpretation|00280006 US PlanarConfiguration|00280008 IS NumberOfFrames|00280010 US Rows|00280011 US Columns|00280030 DS PixelSpacing|00280034 IS PixelAspectRatio|00280100 US BitsAllocated|00280101 US BitsStored|00280102 US HighBit|00280103 US PixelRepresentation|00280106 US SmallestImagePixelValue|00280107 US LargestImagePixelValue|00281040 CS PixelIntensityRelationship|00281041 SS PixelIntensityRelationshipSign|00281050 DS WindowCenter|00281051 DS WindowWidth|00281052 DS RescaleIntercept|00281053 DS RescaleSlope|00281054 LO RescaleType|00282110 CS LossyImageCompression|00282112 DS LossyImageCompressionRatio|00282114 CS LossyImageCompressionMethod
00321060 LO RequestedProcedureDescription|00400244 DA PerformedProcedureStepStartDate|00400254 LO PerformedProcedureStepDescription|00080068 CS PresentationIntentType|00080081 ST InstitutionAddress|00080100 SH CodeValue|00080102 SH CodingSchemeDesignator|00080104 LO CodeMeaning|00081048 PN PhysiciansOfRecord|00081060 PN NameOfPhysiciansReadingStudy
00141010 ST ActualEnvironmentalConditions|00141020 DA ExpiryDate|00141040 ST EnvironmentalConditions|001440A0 LO ImageQualityIndicatorType|001440A1 LO ImageQualityIndicatorMaterial|001440A2 LO ImageQualityIndicatorSize|00140101 CS SecondaryApprovalStatus|00140102 DA SecondaryReviewDate|00140103 TM SecondaryReviewTime|00143040 SQ DarkCurrentSequence|00143050 OB DarkCurrentCounts|00143060 SQ GainCorrectionReferenceSequence|00143070 OB AirCounts|00143080 OB BadPixelImage
00180010 LO ContrastBolusAgent|00181153 IS ExposureInuAs|00181160 SH FilterType|00181180 SH CollimatorGridName|00181190 DS FocalSpots|00181260 SH PlateType|00181261 LO PhosphorType|00181402 CS CassetteOrientation|00181403 CS CassetteSize|00181404 US ExposuresOnPlate|00185101 CS ViewPosition|00186000 DS Sensitivity|00187004 CS DetectorType|00187005 CS DetectorConfiguration|00187006 LT DetectorDescription|00187008 LT DetectorMode|0018700A SH DetectorID|0018700C DA DateOfLastDetectorCalibration|0018702A LO DetectorManufacturerName|0018702B LO DetectorManufacturerModelName
00200052 UI FrameOfReferenceUID|00280120 US PixelPaddingValue|00280301 CS BurnedInAnnotation|00324000 LT StudyComments|00380300 LO CurrentPatientLocation|00880200 SQ IconImageSequence|20500020 CS PresentationLUTShape|300E0002 CS ApprovalStatus|300E0004 DA ReviewDate|300E0005 TM ReviewTime|300E0008 PN ReviewerName|7FE00010 OW PixelData`;
  const DICT = new Map();
  DICT_SRC.split(/[|\n]/).forEach(s => { const [t, vr, kw] = s.trim().split(' '); DICT.set(parseInt(t, 16) >>> 0, { vr, keyword: kw }); });
  // DICONDE (ASTM E2339) names for reused DICOM tags, as listed in Carestream's INDUSTREX
  // DICOM/DICONDE Conformance Statement (rev. 10.0, 2017).
  const NDE_NAMES = { 0x00100010: 'Component Name', 0x00100020: 'Component ID Number', 0x00100021: 'Component ID Issuer', 0x00100030: 'Component Manufacturing Date',
    0x00101000: 'Other Component IDs', 0x00101001: 'Other Component Names', 0x00102160: 'Material Name', 0x00104000: 'Component Notes',
    0x00380300: 'Volume Description', 0x00080090: 'Component Owner Name', 0x00081048: 'Inspecting Company Name', 0x00081060: 'Certifying Inspector Name',
    0x00081050: 'Inspector Name', 0x00081070: 'Operator Name', 0x00180015: 'Part Examined', 0x00324000: 'Examination Notes',
    0x00080080: 'Company Name', 0x00080081: 'Company Address', 0x00081040: 'Department', 0x00200020: 'Component Orientation' };
  const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');
  const tagHex = t => `(${hex4(t >>> 16)},${hex4(t & 0xFFFF)})`;
  const words = kw => kw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/\bI Ds\b/g, 'IDs');
  function tagInfo(t) {
    const d = DICT.get(t >>> 0);
    const dicom = d ? words(d.keyword) : ((t >>> 16) & 1 ? 'Private tag' : 'Unknown tag');
    return { vr: d ? d.vr : null, keyword: d ? d.keyword : '', dicomName: dicom, ndeName: NDE_NAMES[t >>> 0] || '', name: NDE_NAMES[t >>> 0] || dicom };
  }
  function parseTag(s) {
    const str = String(s).trim();
    const m = /^\(?\s*([0-9a-f]{4})\s*,?\s*([0-9a-f]{4})\s*\)?$/i.exec(str);
    if (m) return ((parseInt(m[1], 16) << 16) | parseInt(m[2], 16)) >>> 0;
    for (const [t, d] of DICT) if (d.keyword.toLowerCase() === str.toLowerCase()) return t;
    return null;
  }
  function findTagsByText(q) {
    q = q.toLowerCase();
    const out = [];
    for (const [t, d] of DICT) { const i = tagInfo(t); if ((i.name + ' ' + i.dicomName + ' ' + d.keyword + ' ' + tagHex(t)).toLowerCase().includes(q)) out.push(t); }
    return out;
  }

  class DicomError extends Error {}

  function swapBytes(b, size) {
    for (let i = 0; i + size <= b.length; i += size) for (let j = 0; j < size >> 1; j++) { const x = b[i + j]; b[i + j] = b[i + size - 1 - j]; b[i + size - 1 - j] = x; }
    return b;
  }

  class Reader {
    constructor(bytes) { this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.p = 0; this.le = true; }
    need(n) { if (this.p + n > this.b.length) throw new DicomError('File ends unexpectedly (truncated or not a DICOM file).'); }
    u16() { this.need(2); const v = this.dv.getUint16(this.p, this.le); this.p += 2; return v; }
    u32() { this.need(4); const v = this.dv.getUint32(this.p, this.le); this.p += 4; return v; }
    tag() { const g = this.u16(), e = this.u16(); return ((g << 16) | e) >>> 0; }
    bytes(n) { this.need(n); const v = this.b.slice(this.p, this.p + n); this.p += n; return v; }
  }

  function newDataset() { return { el: new Map() }; }

  function readDataset(r, explicit, end, untilItemDelim, stopGroup) {
    const ds = newDataset();
    while (r.p < end) {
      const start = r.p;
      if (stopGroup != null && r.p + 2 <= end && r.dv.getUint16(r.p, true) !== stopGroup) break;
      const tag = r.tag();
      if (tag === ITEM_DELIM) { r.u32(); if (untilItemDelim) return ds; continue; }
      if (tag === SEQ_DELIM) { r.u32(); continue; }
      let vr, len;
      if (explicit && (tag >>> 16) !== 0xFFFE) {
        r.need(2);
        vr = String.fromCharCode(r.b[r.p], r.b[r.p + 1]);
        if (/^[A-Z]{2}$/.test(vr)) {
          r.p += 2;
          if (LONG_VRS.has(vr)) { r.p += 2; len = r.u32(); } else len = r.u16();
        } else { vr = (tagInfo(tag).vr) || 'UN'; len = r.u32(); }
      } else {
        len = r.u32();
        vr = tagInfo(tag).vr || 'UN';
      }
      if (vr === 'US or SS') vr = 'US';
      const el = { tag, vr };
      if (vr === 'SQ' || (len === UNDEF && vr === 'UN' && tag !== PIXEL)) {
        const itemsExplicit = vr === 'SQ' ? explicit : false;
        const savedLe = r.le; if (vr === 'UN') r.le = true;
        el.vr = 'SQ'; el.items = readSequence(r, itemsExplicit, len);
        r.le = savedLe;
      } else if (tag === PIXEL && len === UNDEF) {
        el.vr = 'OB'; el.fragments = [];
        for (;;) {
          const t = r.tag(), l = r.u32();
          if (t === SEQ_DELIM) break;
          if (t !== ITEM) throw new DicomError('Damaged compressed image data.');
          el.fragments.push(r.bytes(l));
        }
      } else {
        if (len === UNDEF) throw new DicomError(`Unsupported undefined length at ${tagHex(tag)}.`);
        el.value = r.bytes(len);
        if (!r.le && SWAP[vr]) swapBytes(el.value, SWAP[vr]);
      }
      if (r.p <= start) throw new DicomError('Parser made no progress.');
      ds.el.set(tag, el);
    }
    return ds;
  }

  function readSequence(r, explicit, len) {
    const end = len === UNDEF ? r.b.length : r.p + len, items = [];
    while (r.p < end) {
      const t = r.tag(), l = r.u32();
      if (t === SEQ_DELIM) break;
      if (t !== ITEM) throw new DicomError(`Damaged sequence item at byte ${r.p - 8}.`);
      items.push(l === UNDEF ? readDataset(r, explicit, r.b.length, true) : readDataset(r, explicit, r.p + l, false));
    }
    return items;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return new Uint8Array(require('zlib').inflateRawSync(bytes));
  }

  async function parse(input) {
    // A plain Uint8Array view, so slice() copies (Node Buffer.slice does not).
    const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    const r = new Reader(bytes);
    const hasPreamble = bytes.length >= 132 && bytes[128] === 0x44 && bytes[129] === 0x49 && bytes[130] === 0x43 && bytes[131] === 0x4D;
    let meta = newDataset(), ts = TS.IMPLICIT_LE;
    if (hasPreamble) {
      r.p = 132;
      meta = readDataset(r, true, bytes.length, false, 0x0002);
      ts = getString(meta, 0x00020010) || TS.EXPLICIT_LE;
    } else {
      if (bytes.length < 8) throw new DicomError('Not a DICOM file.');
      // No preamble: guess the encoding from the first element.
      const vr = String.fromCharCode(bytes[4], bytes[5]);
      ts = /^[A-Z]{2}$/.test(vr) ? TS.EXPLICIT_LE : TS.IMPLICIT_LE;
      const g = r.dv.getUint16(0, true);
      if (g === 0x0002) { meta = readDataset(r, true, bytes.length, false, 0x0002); ts = getString(meta, 0x00020010) || ts; }
      else if (g > 0x7FE0 || g === 0) throw new DicomError('Not a DICOM file.');
    }
    let body = r;
    if (ts === TS.DEFLATED) { body = new Reader(await inflateRaw(bytes.subarray(r.p))); }
    if (ts === TS.EXPLICIT_BE) body.le = false;
    const explicit = ts !== TS.IMPLICIT_LE;
    const ds = readDataset(body, explicit, body.b.length, false);
    if (!ds.el.size) throw new DicomError('No DICOM data found in this file.');
    return { meta, ds, transferSyntax: ts, encapsulated: !!(ds.el.get(PIXEL) && ds.el.get(PIXEL).fragments) };
  }

  // ---- value conversion ----
  // true = UTF-8, false = Latin-1 (or another declared set), 'ascii' = no Specific Character Set (default repertoire).
  function charsetMode(ds) { return !ds || !ds.el.has(0x00080005) || !getStringRaw(ds.el.get(0x00080005)) ? 'ascii' : charsetIsUtf8(ds); }
  function getStringRaw(el) { return el && el.value ? bytesToLatin1(el.value).replace(/[\0 ]+$/, '') : ''; }
  // Replaces characters the file's character set cannot hold (used for text the editor writes itself).
  function foldText(s, mode) {
    if (mode === true) return s;
    s = s.replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
    if (mode === 'ascii') s = s.replace(/\u00B0/g, ' deg').replace(/\u00D7/g, 'x');
    const max = mode === 'ascii' ? 127 : 255;
    return s.replace(/[\s\S]/g, ch => (ch.charCodeAt(0) > max ? '?' : ch));
  }
  function charsetIsUtf8(ds) { const cs = ds && ds.el.get(0x00080005); return !!cs && /ISO_IR 192/.test(bytesToLatin1(cs.value)); }
  function bytesToLatin1(b) { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; }
  function decodeText(b, utf8) {
    if (utf8 && typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('windows-1252').decode(b);
    return bytesToLatin1(b);
  }
  function encodeText(s, utf8) {
    if (utf8 === true) return new TextEncoder().encode(s);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (utf8 === 'ascii' && c > 127) throw new DicomError(`"${s[i]}" needs a character set: this file has no Specific Character Set (0008,0005), so only plain ASCII is allowed. Set it to ISO_IR 100 (Latin-1) or ISO_IR 192 (UTF-8) first.`);
      if (c > 255) throw new DicomError(`"${s[i]}" cannot be stored in this file's character set.`);
      out[i] = c;
    }
    return out;
  }
  function trimValue(s, vr) { s = s.replace(/\0+$/, ''); return SINGLE_TEXT.has(vr) ? s.replace(/ +$/, '') : s.split('\\').map(v => v.replace(/^ +| +$/g, '')).join('\\'); }

  function editable(vr) { return STRING_VRS.has(vr) || !!NUM[vr] || vr === 'AT'; }

  function valueToText(el, utf8) {
    if (el.items) return `${el.items.length} item${el.items.length === 1 ? '' : 's'}`;
    if (el.fragments) return `Compressed image data, ${el.fragments.length} fragment(s)`;
    const b = el.value || new Uint8Array(0);
    if (STRING_VRS.has(el.vr)) return trimValue(decodeText(b, utf8 && el.vr !== 'UI'), el.vr);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (NUM[el.vr]) {
      const [n, fn] = NUM[el.vr], out = [];
      for (let i = 0; i + n <= b.length; i += n) out.push(String(dv['get' + fn](i, true)));
      return out.join('\\');
    }
    if (el.vr === 'AT') { const out = []; for (let i = 0; i + 4 <= b.length; i += 4) out.push(tagHex(((dv.getUint16(i, true) << 16) | dv.getUint16(i + 2, true)) >>> 0)); return out.join('\\'); }
    return `Binary data, ${b.length.toLocaleString('en-US')} bytes`;
  }

  // Returns an error message, or '' when the text is acceptable for the VR.
  function validate(vr, text) {
    if (NUM[vr]) {
      if (text.trim() === '') return '';
      for (const v of text.split('\\')) {
        const s = v.trim();
        if (vr === 'FL' || vr === 'FD') { if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return `"${s}" is not a number.`; continue; }
        if (!/^[-+]?\d+$/.test(s)) return `"${s}" is not a whole number.`;
        const n = Number(s), lim = { US: [0, 65535], SS: [-32768, 32767], UL: [0, 4294967295], SL: [-2147483648, 2147483647] }[vr];
        if (lim && (n < lim[0] || n > lim[1])) return `${s} is outside ${lim[0]}–${lim[1]}.`;
      }
      return '';
    }
    if (vr === 'AT') { for (const v of text.split('\\')) if (v.trim() && parseTag(v) == null) return `"${v}" is not a tag like (0010,0010).`; return ''; }
    if (!STRING_VRS.has(vr)) return 'This value cannot be edited as text.';
    if (/[\r\n]/.test(text) && !['LT', 'ST', 'UT'].includes(vr)) return 'Line breaks are only allowed in long text fields.';
    const vals = SINGLE_TEXT.has(vr) ? [text] : text.split('\\');
    for (const v of vals) {
      if (v === '') continue;
      const max = MAX_LEN[vr];
      if (vr === 'PN') { if (v.split('=').some(g => g.length > 64)) return 'Each name group must be 64 characters or fewer.'; }
      else if (max && v.length > max && !['DA', 'TM', 'DT'].includes(vr)) return `Each value must be ${max} characters or fewer (${v.length} given).`;
      switch (vr) {
        case 'DA': if (!/^\d{8}$/.test(v) || !validDate(v)) return 'Use a date like 20261111 (YYYYMMDD).'; break;
        case 'TM': if (!/^([01]\d|2[0-3])([0-5]\d([0-5]\d(\.\d{1,6})?)?)?$/.test(v)) return 'Use a time like 143000 (HHMMSS).'; break;
        case 'DT': if (!/^\d{4}(\d{2}(\d{2}(\d{2}(\d{2}(\d{2}(\.\d{1,6})?)?)?)?)?)?([+-]\d{4})?$/.test(v)) return 'Use a date-time like 20261111143000.'; break;
        case 'DS': if (!/^ *[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)? *$/.test(v)) return `"${v}" is not a decimal number.`; break;
        case 'IS': if (!/^ *[-+]?\d+ *$/.test(v) || Math.abs(Number(v)) > 2147483647) return `"${v}" is not a whole number.`; break;
        case 'UI': if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/.test(v)) return 'A UID is digits separated by dots.'; break;
        case 'CS': if (!/^[A-Z0-9 _]*$/.test(v)) return 'Code strings use capital letters, digits, spaces and underscores.'; break;
        case 'AS': if (!/^\d{3}[DWMY]$/.test(v)) return 'Use an age like 005Y.'; break;
      }
    }
    return '';
  }
  function validDate(s) { const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8); const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; }

  function textToBytes(vr, text, utf8) {
    if (vr === 'CS') text = text.toUpperCase();
    const err = validate(vr, text);
    if (err) throw new DicomError(err);
    if (NUM[vr]) {
      if (text.trim() === '') return new Uint8Array(0);
      const [n, fn] = NUM[vr], vals = text.split('\\'), b = new Uint8Array(n * vals.length), dv = new DataView(b.buffer);
      vals.forEach((v, i) => dv['set' + fn](i * n, fn.startsWith('Big') ? BigInt(v.trim()) : Number(v), true));
      return b;
    }
    if (vr === 'AT') {
      const vals = text.split('\\').filter(v => v.trim()), b = new Uint8Array(4 * vals.length), dv = new DataView(b.buffer);
      vals.forEach((v, i) => { const t = parseTag(v); dv.setUint16(i * 4, t >>> 16, true); dv.setUint16(i * 4 + 2, t & 0xFFFF, true); });
      return b;
    }
    return encodeText(text, vr === 'UI' ? 'ascii' : utf8);
  }

  function getElement(ds, tag) { return ds.el.get(tag >>> 0) || null; }
  function getString(ds, tag) { const el = getElement(ds, tag); return el && el.value ? valueToText(el, charsetIsUtf8(ds)) : ''; }
  function getNumber(ds, tag, index = 0) { const s = getString(ds, tag).split('\\')[index]; return s === undefined || s.trim() === '' ? null : Number(s); }
  // Sets (creating if needed) an element from text. vr defaults to the existing VR, then the dictionary.
  function setText(ds, tag, text, vr, rootDs) {
    tag >>>= 0;
    const el = ds.el.get(tag);
    vr = vr || (el && el.vr) || tagInfo(tag).vr;
    if (!vr) throw new DicomError(`Choose a VR for ${tagHex(tag)}.`);
    const value = textToBytes(vr, String(text), charsetMode(rootDs || ds));
    ds.el.set(tag, { tag, vr, value });
    return ds.el.get(tag);
  }
  function remove(ds, tag) { return ds.el.delete(tag >>> 0); }

  function newUID() {
    const b = new Uint8Array(16);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : require('crypto').webcrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0F) | 0x40; b[8] = (b[8] & 0x3F) | 0x80; // RFC 4122 v4, as PS3.5 B.2 expects for 2.25 UIDs
    let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
    return '2.25.' + n.toString();
  }

  // ---- writing ----
  class Writer {
    constructor() { this.chunks = []; this.len = 0; }
    push(b) { this.chunks.push(b); this.len += b.length; }
    u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.push(b); }
    u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.push(b); }
    tag(t) { this.u16(t >>> 16); this.u16(t & 0xFFFF); }
    ascii(s) { this.push(Uint8Array.from(s, c => c.charCodeAt(0))); }
    out() { const o = new Uint8Array(this.len); let p = 0; for (const c of this.chunks) { o.set(c, p); p += c.length; } return o; }
  }
  function padded(el) {
    const v = el.value || new Uint8Array(0);
    if (!(v.length & 1)) return v;
    const o = new Uint8Array(v.length + 1); o.set(v); o[v.length] = (STRING_VRS.has(el.vr) && el.vr !== 'UI') ? 0x20 : 0; return o;
  }
  function writeDataset(w, ds) {
    [...ds.el.keys()].sort((a, b) => a - b).forEach(t => { if ((t & 0xFFFF) !== 0 || (t >>> 16) === 0x0002) writeElement(w, ds.el.get(t)); });
  }
  function writeElement(w, el) {
    w.tag(el.tag);
    if (el.items) {
      w.ascii('SQ'); w.u16(0); w.u32(UNDEF);
      for (const it of el.items) { w.tag(ITEM); w.u32(UNDEF); writeDataset(w, it); w.tag(ITEM_DELIM); w.u32(0); }
      w.tag(SEQ_DELIM); w.u32(0); return;
    }
    if (el.fragments) {
      w.ascii('OB'); w.u16(0); w.u32(UNDEF);
      for (const f of el.fragments) { const p = f.length & 1 ? padded({ vr: 'OB', value: f }) : f; w.tag(ITEM); w.u32(p.length); w.push(p); }
      w.tag(SEQ_DELIM); w.u32(0); return;
    }
    const v = padded(el);
    w.ascii(el.vr);
    if (LONG_VRS.has(el.vr)) { w.u16(0); w.u32(v.length); }
    else { if (v.length > 0xFFFF) throw new DicomError(`${tagHex(el.tag)} is too long for VR ${el.vr}.`); w.u16(v.length); }
    w.push(v);
  }

  function buildMeta(file, ts) {
    const meta = newDataset(), ds = file.ds, old = file.meta || newDataset();
    meta.el.set(0x00020001, { tag: 0x00020001, vr: 'OB', value: new Uint8Array([0, 1]) });
    setText(meta, 0x00020002, getString(ds, 0x00080016) || getString(old, 0x00020002) || '1.2.840.10008.5.1.4.1.1.7', 'UI');
    setText(meta, 0x00020003, getString(ds, 0x00080018) || getString(old, 0x00020003) || newUID(), 'UI');
    setText(meta, 0x00020010, ts, 'UI');
    setText(meta, 0x00020012, IMPL_UID, 'UI');
    setText(meta, 0x00020013, IMPL_NAME, 'SH');
    const ae = getString(old, 0x00020016); if (ae) setText(meta, 0x00020016, ae, 'AE');
    const body = new Writer(); writeDataset(body, meta);
    return { meta, groupLength: body.len };
  }

  function write(file) {
    const px = file.ds.el.get(PIXEL);
    const keepEncapsulated = !!(px && px.fragments);
    const ts = keepEncapsulated ? file.transferSyntax : TS.EXPLICIT_LE;
    const { meta, groupLength } = buildMeta(file, ts);
    meta.el.set(0x00020000, { tag: 0x00020000, vr: 'UL', value: new Uint8Array(new Uint32Array([groupLength]).buffer) });
    const w = new Writer();
    w.push(new Uint8Array(128)); w.ascii('DICM');
    writeDataset(w, meta);
    writeDataset(w, file.ds);
    return w.out();
  }

  function clone(x) {
    if (typeof structuredClone === 'function') return structuredClone(x);
    throw new DicomError('structuredClone unavailable');
  }

  // ---- image access ----
  function imageError(file) { return getImage(file).error || ''; }
  function getImage(file) {
    const ds = file.ds, px = ds.el.get(PIXEL);
    if (!px) return { error: 'This file has no image data.' };
    if (px.fragments) return { error: `The image is compressed (${TS_NAMES[file.transferSyntax] || file.transferSyntax}). Metadata can be edited, but image tools need an uncompressed file.`, compressed: true };
    const rows = getNumber(ds, 0x00280010), cols = getNumber(ds, 0x00280011);
    const spp = getNumber(ds, 0x00280002) || 1, ba = getNumber(ds, 0x00280100) || 16;
    const bs = getNumber(ds, 0x00280101) || ba, pr = getNumber(ds, 0x00280103) || 0;
    const frames = Math.max(1, getNumber(ds, 0x00280008) || 1);
    const photometric = getString(ds, 0x00280004) || 'MONOCHROME2';
    if (!rows || !cols) return { error: 'Image size (Rows/Columns) is missing.' };
    if (spp !== 1 || !/^MONOCHROME[12]$/.test(photometric)) return { error: 'Only greyscale images can be processed. Metadata can still be edited.' };
    if (![8, 16, 32].includes(ba)) return { error: `${ba}-bit images are not supported by the image tools.` };
    const n = rows * cols, bpp = ba / 8;
    if (px.value.length < n * frames * bpp) return { error: 'Image data is shorter than the image size says.' };
    const Ctor = { 8: pr ? Int8Array : Uint8Array, 16: pr ? Int16Array : Uint16Array, 32: pr ? Int32Array : Uint32Array }[ba];
    const min = pr ? -(2 ** (bs - 1)) : 0, max = pr ? 2 ** (bs - 1) - 1 : 2 ** bs - 1;
    const out = [];
    for (let f = 0; f < frames; f++) {
      const a = new Ctor(n); new Uint8Array(a.buffer).set(px.value.subarray(f * n * bpp, (f + 1) * n * bpp));
      if (bs < ba) {
        const mask = 2 ** bs - 1;
        for (let i = 0; i < n; i++) { let v = a[i] & mask; if (pr && v > max) v -= 2 ** bs; a[i] = v; }
      }
      out.push(a);
    }
    const num = t => { const v = getNumber(ds, t); return v == null || !isFinite(v) ? null : v; };
    return { rows, cols, frames: out, bitsAllocated: ba, bitsStored: bs, signed: !!pr, photometric, min, max,
      slope: num(0x00281053) ?? 1, intercept: num(0x00281052) ?? 0, windowCenter: num(0x00281050), windowWidth: num(0x00281051) };
  }

  function setImage(file, img, opts = {}) {
    const ds = file.ds, n = img.rows * img.cols, bpp = img.bitsAllocated / 8;
    const bytes = new Uint8Array(n * bpp * img.frames.length);
    img.frames.forEach((a, f) => bytes.set(new Uint8Array(a.buffer, a.byteOffset, n * bpp), f * n * bpp));
    setText(ds, 0x00280010, String(img.rows), 'US');
    setText(ds, 0x00280011, String(img.cols), 'US');
    if (img.frames.length > 1 || ds.el.has(0x00280008)) setText(ds, 0x00280008, String(img.frames.length), 'IS');
    remove(ds, 0x00280106); remove(ds, 0x00280107); // stale after editing; optional attributes
    if (opts.swapSpacing) for (const t of [0x00280030, 0x00181164]) { const s = getString(ds, t).split('\\'); if (s.length === 2) setText(ds, t, `${s[1]}\\${s[0]}`); }
    ds.el.set(PIXEL, { tag: PIXEL, vr: img.bitsAllocated > 8 ? 'OW' : 'OB', value: bytes });
  }


  // Carestream INDUSTREX private block in group 0033 (Conformance Statement 7.1.13.1): xx10 version (DS),
  // xx40/xx50 internal data (OB), xx71 presentation image, xx72 display filter. The creator string is not
  // published, so a block is recognised by a Carestream-like creator or by the presentation elements.
  const INDUSTREX_CREATOR = /CSH|CARESTREAM|KODAK|INDUSTREX/i;
  const INDUSTREX_NAMES = { 0x10: 'INDUSTREX version', 0x40: 'INDUSTREX internal data', 0x50: 'INDUSTREX internal data', 0x71: 'INDUSTREX presentation image', 0x72: 'INDUSTREX display filter' };
  const INDUSTREX_STALE = [0x40, 0x50, 0x71, 0x72];
  const latinTrim = el => (el && el.value ? bytesToLatin1(el.value).replace(/[\0 ]+$/, '').replace(/^ +/, '') : '');
  function industrexInfo(ds) {
    for (let b = 0x10; b <= 0xFF; b++) {
      const cr = ds.el.get((0x00330000 | b) >>> 0);
      if (!cr) continue;
      const creator = latinTrim(cr), base = (0x00330000 | (b << 8)) >>> 0, has = x => ds.el.has((base | x) >>> 0);
      if (!INDUSTREX_CREATOR.test(creator) && !has(0x71) && !has(0x72)) continue;
      const version = latinTrim(ds.el.get((base | 0x10) >>> 0));
      return { creator, block: b, version: /^[\x20-\x7E]*$/.test(version) ? version : '', staleTags: INDUSTREX_STALE.filter(has).map(x => (base | x) >>> 0) };
    }
    return null;
  }
  // Elements that describe the old pixels and must not travel with an edited image.
  function stalePresentationTags(ds) { const ix = industrexInfo(ds); return (ds.el.has(0x00880200) ? [0x00880200] : []).concat(ix ? ix.staleTags : []); }
  // Like tagInfo, but names private elements from the file's own private creators.
  function describeTag(ds, tag) {
    const info = tagInfo(tag), g = tag >>> 16, e = tag & 0xFFFF;
    if (!(g & 1) || !ds) return info;
    if (e >= 0x10 && e <= 0xFF) return Object.assign({}, info, { name: 'Private creator', dicomName: 'Private creator' });
    const creator = latinTrim(ds.el.get(((g << 16) | (e >> 8)) >>> 0));
    const ix = g === 0x0033 ? industrexInfo(ds) : null;
    const name = ix && ix.block === e >> 8 && INDUSTREX_NAMES[e & 0xFF] ? INDUSTREX_NAMES[e & 0xFF] : `Private data${creator ? ' (' + creator + ')' : ''}`;
    return Object.assign({}, info, { name, dicomName: name });
  }

  function now() {
    const d = new Date(), p = (v, n = 2) => String(v).padStart(n, '0');
    return { date: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`, time: `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` };
  }

  // Marks a file as a new instance derived from `source`. The original file is never modified.
  function derive(file, source, opts = {}) {
    const ds = file.ds, srcDs = source.ds, t = now();
    const srcClass = getString(srcDs, 0x00080016) || getString(source.meta, 0x00020002);
    const srcInst = getString(srcDs, 0x00080018) || getString(source.meta, 0x00020003);
    setText(ds, 0x00080018, newUID(), 'UI');
    setText(ds, 0x00080012, t.date, 'DA'); setText(ds, 0x00080013, t.time, 'TM');
    if (opts.instanceNumber != null) setText(ds, 0x00200013, String(opts.instanceNumber), 'IS');
    if (opts.seriesUID) setText(ds, 0x0020000E, opts.seriesUID, 'UI');
    if (opts.pixelsChanged) {
      const stale = stalePresentationTags(ds);
      stale.forEach(t => ds.el.delete(t));
      if (Array.isArray(opts.removed)) opts.removed.push(...stale);
      const it = (getString(ds, 0x00080008) || 'ORIGINAL\\PRIMARY').split('\\');
      it[0] = 'DERIVED'; it[1] = 'SECONDARY';
      setText(ds, 0x00080008, it.join('\\'), 'CS');
    }
    if (opts.description) {
      const prev = getString(ds, 0x00082111);
      let d = foldText((prev ? prev + '; ' : '') + opts.description, charsetMode(ds));
      if (d.length > 1024) d = d.slice(0, 1021) + '...';
      setText(ds, 0x00082111, d, 'ST');
    }
    if (srcInst && (opts.pixelsChanged || opts.description)) {
      const item = newDataset();
      if (srcClass) setText(item, 0x00081150, srcClass, 'UI');
      setText(item, 0x00081155, srcInst, 'UI');
      const seq = ds.el.get(0x00082112);
      const items = seq && seq.items ? seq.items.filter(i => getString(i, 0x00081155) !== srcInst) : [];
      ds.el.set(0x00082112, { tag: 0x00082112, vr: 'SQ', items: items.concat([item]) });
    }
    return file;
  }

  return { TS, TS_NAMES, PIXEL, DicomError, DICT, parse, write, clone, tagInfo, tagHex, parseTag, findTagsByText, validate, editable, valueToText,
    textToBytes, getElement, charsetMode, foldText, industrexInfo, stalePresentationTags, describeTag, getString, getNumber, setText, remove, newUID, getImage, imageError, setImage, derive, charsetIsUtf8, newDataset, IMPL_UID };
});
