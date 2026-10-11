# Offline QC interpretation trial — 2026-10-09

## Google Gemma 3n comparison

User authorized Google Gemma next. Gemma-3n-E4B-it Q4_K_M matched **11/20** original cases and **5/12** frozen additional cases, versus Qwen4B 13/20 and 10/12, and Phi4 Mini 10/20 and 7/12. Same harness, short prompt, three examples, schema and runtime settings; no Gemma-specific prompt tuning. This includes the inherited `/no_think` suffix, which is not a Gemma-specific instruction. Scores compare configurations, not optimal model capability. The additional set is the previously frozen corpus, not newly authored for this model.

Gemma correctly handled the additional fractional-size phrase that confused Qwen and Phi. However, it frequently dropped supplied schedules or placed XH in the fitting-type field, misclassified weld/fitting groups, invented quantity 1 for a percentage context, and produced edit targets `"null"` or `"context.lastMtId"` when no target existed. Some failures were unnecessary clarification or incomplete extraction rather than invented values. It is not suitable for automatic application.

Desktop original-set median 936.5 ms, range 450–16,580 ms; first request 16,580 ms and complex MT-correction request 5,483 ms. Additional-set median 975.5 ms, range 415–1,467 ms. Loading and transcription excluded; handset performance untested. No production app, APK, list or Android integration changes.

Model source: https://huggingface.co/unsloth/gemma-3n-E4B-it-GGUF ; upstream: https://huggingface.co/google/gemma-3n-E4B-it . Pinned revision `90fa8b0e431faeae50c305828bc260d6f71720e1`, filename `gemma-3n-E4B-it-Q4_K_M.gguf`, 4,539,054,208 bytes (4.54 GB). SHA-256 verified against LFS metadata: `43b489bb77a81bda85180e7c490d40ad7f1d5c2ce654c9b05e15e104bd3c777e`. E4B refers to effective size; the download is substantially larger than the tested Qwen/Phi files.

Artifacts under `build/offline-ai-trial`: `model-gemma.gguf`, `results-gemma.json`, `results-gemma-heldout.json`, `trial-gemma.log`, `trial-gemma-heldout.log`, `server-gemma.log`. Same localhost-only llama.cpp b11429 server, stopped after completion. Qwen4B remains the strongest tested configuration on this small synthetic corpus; none warrants automatic list insertion.

## Microsoft Phi-4 Mini comparison

User authorized testing Microsoft Phi-4-mini-instruct. The Unsloth Q4_K_M quantization matched **10/20** original cases and **7/12** previously frozen held-out cases. Qwen3-4B-Instruct-2507 matched 13/20 and 10/12 respectively under the same harness. No Phi-specific prompt tuning was performed; the prompt, three examples, JSON schema, temperature and runtime settings were retained, including the inherited `/no_think` suffix. Results compare these tested configurations, not the models' maximum attainable performance. The second set was not newly authored for Phi and should not be presented as an independent new corpus.

Phi was quicker in this desktop run: original-case median 507.5 ms (197–3,918 ms, with the first request at 3,918 ms); held-out median 524 ms (190–838 ms). These exclude model loading and speech recognition and do not predict phone latency.

Substantive failures included MT fittings classified as XF, missing spoken schedules/WIDs, confusing quantity with size, and taking `example-row` from a demonstration as a delete target when none was supplied. Both Phi and Qwen misread “one two and a half inch” in the held-out case. Some failed full matches were milder, such as unnecessary clarification after correctly applying a schedule correction or an extra field on a delete. Do not treat aggregate full-match scores as a general safety rate.

Recommendation: Phi is not an improvement for this QC configuration despite faster desktop responses. Keep the app unchanged. Do not allow demonstrations, model-generated IDs or review flags to bypass deterministic target validation. A different model family or task-specific training remains an experiment, not a guaranteed fix.

Model source: https://huggingface.co/unsloth/Phi-4-mini-instruct-GGUF ; upstream: https://huggingface.co/microsoft/Phi-4-mini-instruct . Pinned revision `78eb92a46fc37e6b524df991ed9aca9bc6aa7b80`, file `Phi-4-mini-instruct-Q4_K_M.gguf`, 2,491,874,272 bytes. SHA-256 verified against repository metadata: `88c00229914083cd112853aab84ed51b87bdf6b9ce42f532d8c85c7c63b1730a`.

Artifacts under `build/offline-ai-trial`: `model-phi.gguf`, `results-phi.json`, `results-phi-heldout.json`, `trial-phi.log`, `trial-phi-heldout.log`, `server-phi.log`. Same localhost-only llama.cpp b11429 server as earlier; stopped after testing. No production code, APK or saved lists changed.

## Stronger-model follow-up

User authorized a stronger-model test. Qwen3-4B-Instruct-2507 Q4_K_M fully matched **13/20** original development cases with the unchanged short prompt and three examples (the 1.7B model matched 6/20 with that same prompt; its best earlier prompt matched 7/20). It matched **10/12** additional hand-authored held-out cases written before running the stronger model, with no prompt tuning. These small synthetic sets are feasibility evidence, not a production accuracy estimate.

Download: 2,497,281,120 bytes (2.497 GB / 2.326 GiB), `unsloth/Qwen3-4B-Instruct-2507-GGUF`, pinned revision `a06e946bb6b655725eafa393f4a9745d460374c9`. SHA-256 verified against repository LFS metadata: `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`. Source: https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF . Same llama.cpp runtime, server flags, schema and temperature as below.

Desktop request time: original cases 518–1,744 ms, median 1,002 ms; held-out cases 448–1,590 ms, median 1,041 ms. Loading/startup and transcription are excluded; these are not phone measurements. The server was bound to loopback and stopped after testing.

The stronger model handled natural order, fitting aliases, explicit corrections, mixed sizes, unknown WID and ambiguous size substantially better. However, it still invented quantity 1 and schedule STD when absent, created an extra CN from comma-separated shorthand, retained a malformed CN without review, and sometimes failed XS-to-XH normalization. On the held-out fraction case, “one two and a half inch” became two 1 1/2-inch welds rather than one 2 1/2-inch weld. An unknown delete target became the literal string "null" despite a review flag. Schema compliance and a review flag alone cannot make these outputs safe to apply.

Recommendation: promising for reviewable suggestions, not automatic list insertion. Keep deterministic field normalization, required-field and target-ID validation, and explicit user confirmation before applying model proposals. A larger field-recorded corpus and handset latency/RAM/battery tests remain necessary before shipping. No production app changes, downloader, Android model integration or APK build were made.

Artifacts: `build/offline-ai-trial/results-4b.json`, `results-4b-heldout.json`, `trial-4b.log`, `trial-4b-heldout.log`, and `server-4b.log`. Frozen fresh fixtures: `scripts/offline-ai-heldout.json`. Harness now accepts `TRIAL_MODEL`, `TRIAL_OUTPUT` and optional `TRIAL_CASES` environment variables; defaults preserve the original trial. Run the harness once with the default cases, then with `TRIAL_CASES` pointing to the held-out JSON, using distinct output filenames. Model binary retained as `build/offline-ai-trial/model-4b.gguf` for reuse.

## Result

Do not ship this configuration. The 1.7B model is not sufficiently reliable for QC extraction, even as an automatic fallback. The optional-download approach remains feasible; this trial does not establish that all small models fail or that a larger model will succeed.

No production assets, saved QC lists, networking permissions, or APK were changed for this trial. Proposals were evaluated in an isolated script only. All inference used a localhost server; no customer list or audio was sent to an external inference provider.

## Reproducible artifacts

- Harness: `scripts/offline-ai-trial.cjs` (final short prompt, three illustrative examples, 20 synthetic transcripts and expected proposals).
- Original prompt: `build/offline-ai-trial/results.json` (2/20 full matches).
- Original prompt plus examples: `build/offline-ai-trial/results-fewshot.json` (7/20 full matches).
- Short prompt plus examples: `build/offline-ai-trial/results-short.json` (6/20 full matches).
- Runtime/server logs and binary/model downloads: `build/offline-ai-trial/`.

An initial attempt ran before server readiness and received loading errors. It was excluded and replaced by the completed original-prompt run; the harness now checks health before evaluating cases.

## Model and runtime

Unsloth quantization of Qwen3-1.7B, Q4_K_M, downloaded at pinned Hugging Face revision `d7f544eead698dbd1f15126ef60b45a1e1933222`:

https://huggingface.co/unsloth/Qwen3-1.7B-GGUF

Model size: 1,107,409,472 bytes (1.107 GB / 1.031 GiB). SHA-256 verified against the repository's LFS metadata: `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897`.

llama.cpp official Windows Vulkan x64 release b11429, selected through the stable v0.6.0 release's nightly-tag pointer. ZIP size 33,337,769 bytes; verified GitHub asset SHA-256 `1bfe78ad9168b79fa02bf67f6af9f5e17a966d824d77238517f7bef12ac73b36`.

Server: `llama-server.exe -m model.gguf --host 127.0.0.1 --port 18765 -c 4096 -np 1 -ngl 99 --no-webui --reasoning off`. Temperature 0, max output 900 tokens, thinking disabled, JSON-schema constrained responses. The Windows Vulkan package was used, not Ollama; Ollama was not installed. This is a model/runtime feasibility probe, not an Ollama benchmark or an Android implementation.

## Scope and scoring

Hand-authored development cases cover ordinary shorthand, natural word order, mixed weld groups, MT aliases and corrections, fractions, explicit same-spool context, omitted quantities, hypothetical explicit quantity defaults, percentage jobs, garbled CN, ambiguous WID, missing schedule, background conversation and edits. The default-quantity field is hypothetical trial context, not an implemented job feature.

Full match requires expected review status, expected groups and field values, and exact edit target/action. Unknown-field cases additionally require retaining a partial item with the uncertain field null. Thus a safe refusal can fail the usefulness score; 7/20 must not be described as a general safety/accuracy rate. Some failures only concern normalization or unnecessary clarification; others are substantive. No independent held-out corpus was used, and prompt changes were evaluated on the same development set.

Baseline parser outputs are included in each result. They use the existing parser's default field requirements, while this experiment requires all extraction fields and supports hypothetical context keys. Edit cases did not supply baseline model rows. These differences prevent a fair aggregate head-to-head accuracy claim. Inspect individual shared cases instead.

## Findings

- Examples substantially changed behavior, demonstrating prompt sensitivity.
- In the short-prompt run, natural-order and pair-of-welds examples had correct item fields but unnecessary review flags.
- Failures included WOL classified as XF, schedule XS placed in fitting type, a garbled CN truncated to CN-XS and marked complete, string "null" rather than JSON null, and target "null" invented for an edit with no target.
- A complex mixed weld/MT correction partially extracted the intended groups but added a fabricated XF fitting type.
- JSON-schema compliance does not establish factual extraction correctness.
- Short-prompt desktop request times ranged from 365 to 1,231 ms, median approximately 562 ms, with warm model/prompt caches. Original run's first measured request took 19.5 seconds; server startup also took roughly 12 seconds. These are desktop observations, not phone latency predictions. Timing includes response checking and baseline parsing.

## Next experiment

Compare a stronger quantized model (roughly 3–4B) with a fresh held-out set, or a model specifically trained for extraction. Keep normalization, required-field checks, supported fitting types and valid target IDs in deterministic app code. Never allow the model to allocate XF/MT numbers or commit edits directly. Only after acceptable held-out accuracy should we implement the optional downloader and Android runtime, then benchmark latency, RAM, thermals and battery on actual supported phones. Retain normal QC entry if the model is absent, interrupted or unsupported.

Current base APK remains v1.95 at 197,799,518 bytes. Base APK plus this model is about 1.305 GB before Android runtime/installed overhead; no model was bundled into the APK.
